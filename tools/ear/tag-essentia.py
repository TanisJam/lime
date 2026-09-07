#!/usr/bin/env python3
"""
LIME "ear" #2 — genre tagging with Essentia's genre_discogs400.

MuQ-MuLan scores an open label set by embedding a sentence; this one is a
closed 400-style taxonomy trained on 3.3M Discogs tracks. That is the whole
point of running both: a supervised head with calibrated probabilities makes a
different kind of mistake than a zero-shot text match, and the reference corpus
of human music says which mistake we can live with.

The 400 styles are "Top---Style" pairs, so a candidate genre is scored by
aggregating the styles mapped to it (GENRE_SETS below). A candidate that maps
to nothing is a hard error, never a silent zero: a candidate that can never win
turns the run into a rigged comparison the same way a single-candidate manifest
does.

It writes the SAME report shape as tools/ear/tag.py and judge.py --blind, so
tools/judge/matrix.mjs scores all three without changes.

Aggregating a genre from its styles is not free of bias, and the bias runs both
ways: `max` and `sum` over the 106 Electronic styles beat the 15 Funk ones the
way a longer lottery ticket wins more often, while `mean` favours the small
sets — Ambient is six styles, and left uncalibrated it swallowed seven of
LIME's twelve genres. So the raw scores are z-scored per genre down the batch
before anything is ranked, and that is what makes the columns comparable at all.

Calibrating down the batch assumes the batch is roughly class-balanced. A full
render is; a SWEEP is not — sixty-four variants of one genre would centre that
genre's column on zero and delete the signal being measured. So a balanced run
also writes its per-genre mean and spread, and an unbalanced one applies that
instead of computing its own: fit the normaliser on balanced data, apply it to
new data. Pass --raw to see the uncalibrated ranking.

The 400-dim profile of every clip is cached next to the manifest, so comparing
aggregators costs no inference.

Usage:
    /data/ai/ear/venv-essentia/bin/python tools/ear/tag-essentia.py <manifest.json> [--aggregate=mean]

Aggregators: mean (default), max, sum, top3, argmax (winner-take-all over all 400).
--calibration=<file.json> applies a saved calibration; a balanced run writes one.

Output: <out_dir>/report-essentia.json (or report-essentia-maest.json) next to the manifest.
"""

import collections
import hashlib
import json
import os
import re
import sys
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np
from essentia.standard import (
    MonoLoader,
    TensorflowPredict2D,
    TensorflowPredictEffnetDiscogs,
    TensorflowPredictMAEST,
)

MODEL_DIR = Path(os.environ.get("EAR_MODELS", "/data/ai/ear/models/essentia"))
EMBEDDING_PB = MODEL_DIR / "discogs-effnet-bs64-1.pb"
CLASSIFIER_PB = MODEL_DIR / "genre_discogs400-discogs-effnet-1.pb"
CLASSIFIER_JSON = MODEL_DIR / "genre_discogs400-discogs-effnet-1.json"
# MAEST carries the same 400-style head inside the transformer, so it needs no
# separate classifier and lands in exactly the same label space. The 20s window
# is the largest that fits a 22s clip without padding it with silence.
MAEST_PB = MODEL_DIR / "discogs-maest-20s-pw-2.pb"
BACKENDS = ("effnet", "maest")
SAMPLE_RATE = 16000

# Rock styles that read as metal or hard rock rather than as rock.
METAL = {
    "Atmospheric Black Metal", "Black Metal", "Crust", "Death Metal", "Deathcore",
    "Deathrock", "Depressive Black Metal", "Doom Metal", "Folk Metal",
    "Funeral Doom Metal", "Funk Metal", "Goregrind", "Gothic Metal", "Grindcore",
    "Hard Rock", "Hardcore", "Heavy Metal", "Melodic Death Metal",
    "Melodic Hardcore", "Metalcore", "Noisecore", "Nu Metal", "Post-Metal",
    "Power Metal", "Power Violence", "Progressive Metal", "Sludge Metal",
    "Speed Metal", "Stoner Rock", "Technical Death Metal", "Thrash", "Viking Metal",
}

# Electronic styles with no beat, which is what LIME calls Ambient.
AMBIENT = {"Ambient", "Dark Ambient", "Drone", "New Age", "Berlin-School", "Dungeon Synth"}

# Discogs cross-tags a handful of styles under Electronic that belong to another
# LIME genre. Excluded so the sets stay disjoint and no clip can win twice.
ELECTRONIC_FOREIGN = AMBIENT | {"Hip Hop", "Latin", "Neofolk", "Modern Classical"}

# Discogs files these under Jazz, but they are Latin music by any musical
# definition and by LIME's own use of the word — its `latin` StylePack is
# clave and bossa. Reassigned on that ground, not because of a score.
JAZZ_THAT_IS_LATIN = {"Bossa Nova", "Latin Jazz", "Afro-Cuban Jazz"}

COUNTRY = {"Country", "Bluegrass", "Hillbilly", "Honky Tonk", "Cajun"}


def _top3(values: np.ndarray) -> float:
    return float(np.mean(np.sort(values)[-3:]))


# `argmax` is handled separately: it needs the whole 400-dim profile, not one
# genre's slice, because the winner is the single loudest style overall.
AGGREGATORS = {
    "mean": lambda v: float(np.mean(v)),
    "max": lambda v: float(np.max(v)),
    "sum": lambda v: float(np.sum(v)),
    "top3": _top3,
    "argmax": None,
}


def build_genre_sets(classes: list[str]) -> dict[str, set[str]]:
    """Map each LIME genre key to the Discogs styles that count as it.

    Boundaries are the taxonomy's own wherever it has an opinion, with the one
    documented exception of JAZZ_THAT_IS_LATIN.
    """
    by_top: dict[str, set[str]] = {}
    for full in classes:
        top, _, style = full.partition("---")
        by_top.setdefault(top, set()).add(style)

    def pick(top: str, styles: set[str] | None = None, without: set[str] | None = None) -> set[str]:
        chosen = by_top.get(top, set()) if styles is None else (styles & by_top.get(top, set()))
        if without:
            chosen = chosen - without
        return {f"{top}---{s}" for s in chosen}

    sets = {
        "ambient": pick("Electronic", AMBIENT),
        "blues": pick("Blues"),
        "classical": pick("Classical"),
        "country": pick("Folk, World, & Country", COUNTRY) | pick("Rock", {"Country Rock"}),
        "electronic": pick("Electronic", without=ELECTRONIC_FOREIGN),
        "folk": pick("Folk, World, & Country"),
        "funk": pick("Funk / Soul"),
        "hiphop": pick("Hip Hop"),
        "jazz": pick("Jazz", without=JAZZ_THAT_IS_LATIN),
        "latin": (
            pick("Latin")
            | pick("Jazz", JAZZ_THAT_IS_LATIN)
            | pick("Electronic", {"Latin"})
        ),
        "metal": pick("Rock", METAL),
        "pop": pick("Pop"),
        "rock": pick("Rock", without=METAL),
    }
    sets["rock_or_pop"] = sets["rock"] | sets["pop"]
    return sets


# Ordered: the first pattern that matches the candidate text wins, so the
# compound labels used by the reference corpus are tested before the plain ones.
CANDIDATE_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^metal\b|^metal or hard rock"), "metal"),
    (re.compile(r"^rock or pop\b"), "rock_or_pop"),
    (re.compile(r"^country\b"), "country"),
    (re.compile(r"^classical\b"), "classical"),
    (re.compile(r"^jazz\b"), "jazz"),
    (re.compile(r"^latin\b"), "latin"),
    (re.compile(r"^electronic\b"), "electronic"),
    (re.compile(r"^funk\b|^r&b\b"), "funk"),
    (re.compile(r"^hip.?hop\b"), "hiphop"),
    (re.compile(r"^ambient\b"), "ambient"),
    (re.compile(r"^blues\b"), "blues"),
    (re.compile(r"^folk\b"), "folk"),
    (re.compile(r"^pop\b"), "pop"),
    (re.compile(r"^rock\b"), "rock"),
]


def map_candidate(candidate: str) -> str | None:
    text = candidate.strip().lower()
    for pattern, key in CANDIDATE_RULES:
        if pattern.search(text):
            return key
    return None


def maest_profile(model, audio: np.ndarray) -> np.ndarray:
    """Mean sigmoid over MAEST's patches. Its head emits logits, not scores."""
    logits = np.array(model(audio)).reshape(-1, 400)
    return 1.0 / (1.0 + np.exp(-logits.mean(axis=0)))


def load_profiles(
    out_dir: Path, clips: list[dict], n_classes: int, backend: str
) -> dict[str, np.ndarray]:
    """Return one 400-dim activation profile per clip, computing what is missing.

    Inference dominates the runtime and the profile does not depend on the
    candidate set or the aggregator, so it is cached — per backend, since the
    two models put different numbers in the same 400 slots.

    The key is a hash of the audio, not the file name. Re-rendering a genre
    writes new audio to the same names, and a name-keyed cache would hand back
    the old profile and report that the change did nothing.
    """
    cache_path = out_dir / f"essentia-profiles-{backend}.npz"
    stored: dict[str, np.ndarray] = {}
    if cache_path.exists():
        with np.load(cache_path) as data:
            stored = {k: data[k] for k in data.files if data[k].shape == (n_classes,)}

    def key(clip: dict) -> str:
        digest = hashlib.blake2b(
            (out_dir / clip["file"]).read_bytes(), digest_size=16
        ).hexdigest()
        return f"{clip['file']}:{digest}"

    keys = {clip["file"]: key(clip) for clip in clips}
    cached = {k: v for k, v in stored.items() if k in set(keys.values())}
    missing = [c for c in clips if keys[c["file"]] not in cached]
    if missing:
        print(f"Computing {len(missing)} {backend} profile(s) ({len(clips) - len(missing)} cached)")
        if backend == "maest":
            maest = TensorflowPredictMAEST(
                graphFilename=str(MAEST_PB), output="PartitionedCall/Identity"
            )
            predict = lambda audio: maest_profile(maest, audio)
        else:
            embedder = TensorflowPredictEffnetDiscogs(
                graphFilename=str(EMBEDDING_PB), output="PartitionedCall:1"
            )
            classifier = TensorflowPredict2D(
                graphFilename=str(CLASSIFIER_PB),
                input="serving_default_model_Placeholder",
                output="PartitionedCall:0",
            )
            # One row per patch of audio; the clip's profile is their mean.
            predict = lambda audio: np.mean(classifier(embedder(audio)), axis=0)

        for i, clip in enumerate(missing, 1):
            wav_path = (out_dir / clip["file"]).resolve()
            audio = MonoLoader(filename=str(wav_path), sampleRate=SAMPLE_RATE, resampleQuality=4)()
            cached[keys[clip["file"]]] = predict(audio)
            print(f"  [{i}/{len(missing)}] {clip['file'][:60]}", flush=True)
        np.savez_compressed(cache_path, **cached)

    return {clip["file"]: cached[keys[clip["file"]]] for clip in clips}


def main() -> int:
    argv = sys.argv[1:]
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2

    aggregate = next((a.split("=", 1)[1] for a in argv if a.startswith("--aggregate=")), "mean")
    if aggregate not in AGGREGATORS:
        print(
            f"ERROR: --aggregate must be one of {', '.join(AGGREGATORS)}, got {aggregate!r}",
            file=sys.stderr,
        )
        return 2

    backend = next((a.split("=", 1)[1] for a in argv if a.startswith("--backend=")), "effnet")
    if backend not in BACKENDS:
        print(f"ERROR: --backend must be one of {', '.join(BACKENDS)}, got {backend!r}", file=sys.stderr)
        return 2

    calibrate = "--raw" not in argv
    calibration_arg = next(
        (a.split("=", 1)[1] for a in argv if a.startswith("--calibration=")), None
    )

    manifest_path = Path(args[0]).resolve()
    manifest = json.loads(manifest_path.read_text())
    out_dir = manifest_path.parent
    clips = manifest["clips"]

    candidates = sorted(
        manifest.get("candidates")
        or {c.get("genreName") or c["genre"] for c in clips}
    )
    # Same guard as tag.py: one candidate makes argmax report 100% by construction.
    if len(candidates) < 2:
        print(
            f"ERROR: only {len(candidates)} candidate label ({candidates}).\n"
            "Judge against the full candidate set — render all genres, or declare\n"
            "`candidates` in the manifest.",
            file=sys.stderr,
        )
        return 2

    classes = json.loads(CLASSIFIER_JSON.read_text())["classes"]
    class_index = {name: i for i, name in enumerate(classes)}
    genre_sets = build_genre_sets(classes)

    # Resolve every candidate up front. An unmapped candidate would score 0.0
    # forever and quietly hand its clips to somebody else.
    columns: dict[str, np.ndarray] = {}
    unmapped = []
    for candidate in candidates:
        key = map_candidate(candidate)
        styles = genre_sets.get(key) if key else None
        if not styles:
            unmapped.append(candidate)
            continue
        columns[candidate] = np.array(sorted(class_index[s] for s in styles), dtype=np.int64)
    if unmapped:
        print(
            "ERROR: no Discogs styles mapped to: " + ", ".join(repr(c) for c in unmapped) + "\n"
            "Add a rule to CANDIDATE_RULES / GENRE_SETS before trusting this run.",
            file=sys.stderr,
        )
        return 2

    print(
        f"{len(clips)} clip(s), {len(candidates)} candidates, chance = {1/len(candidates):.0%}, "
        f"aggregate = {aggregate}"
    )

    profiles = load_profiles(out_dir, clips, len(classes), backend)

    reduce = AGGREGATORS[aggregate]

    raw = []
    for clip in clips:
        profile = profiles[clip["file"]]
        if aggregate == "argmax":
            winner = int(np.argmax(profile))
            # One style takes the clip; every genre scores its own share of it,
            # so ties and near-misses stay visible in the ranking.
            raw.append({c: (1.0 if winner in set(idx.tolist()) else float(np.mean(profile[idx])))
                        for c, idx in columns.items()})
        else:
            raw.append({c: reduce(profile[idx]) for c, idx in columns.items()})

    unscaled = [dict(r) for r in raw]
    calibration: dict[str, list[float]] = {}
    if calibrate and calibration_arg:
        saved = json.loads(Path(calibration_arg).read_text())
        missing = [c for c in candidates if c not in saved]
        # Silently falling back to this batch would be the exact failure the
        # saved calibration exists to prevent, and it would not look like one.
        if missing:
            print(
                f"ERROR: {calibration_arg} has no calibration for: {', '.join(missing)}.\n"
                "Produce it from a class-balanced run over the same candidates.",
                file=sys.stderr,
            )
            return 2
        calibration = saved

    if calibrate:
        # Per-genre z-score. A genre whose styles simply score high on
        # everything stops winning by default; only a clip that is unusually
        # that genre does. The centre and spread come from a balanced run when
        # one is supplied, and from this batch otherwise.
        for c in candidates:
            column = np.array([r[c] for r in raw])
            centre, spread = (
                calibration[c] if calibration else (float(column.mean()), float(column.std()))
            )
            for r, v in zip(raw, column):
                r[c] = 0.0 if spread == 0 else float((v - centre) / spread)

    results = []
    for i, (clip, sims) in enumerate(zip(clips, raw), 1):
        profile = profiles[clip["file"]]
        ranked = sorted(sims.items(), key=lambda p: p[1], reverse=True)
        best, runner = ranked[0], ranked[1]

        # Phrased exactly like the blind judge's answer so one scorer reads all three.
        verdict = (
            f"1. BEST MATCH: {best[0]}\n"
            f"2. RUNNER-UP: {runner[0]}\n"
            f"3. SCORES: " + ", ".join(f"{c}={s:.4f}" for c, s in ranked)
        )
        top_styles = sorted(
            ((classes[j], float(profile[j])) for j in range(len(classes))),
            key=lambda p: p[1],
            reverse=True,
        )[:5]
        results.append({
            **clip,
            "verdict": verdict,
            "scores": sims,
            "topStyles": dict(top_styles),
        })

        truth = clip.get("truth") or clip.get("genreName") or clip["file"]
        mark = "OK" if best[0] == truth else "  "
        print(f"[{i}/{len(clips)}] {mark} {clip['file'][:38]:38} → {best[0].split(' (')[0]}", flush=True)

    suffix = "" if backend == "effnet" else f"-{backend}"

    # A balanced run is the only one entitled to define the normaliser, so only
    # a balanced run writes one. "Balanced" here means every candidate is the
    # truth for the same number of clips.
    if calibrate and not calibration:
        per_class = collections.Counter(
            (c.get("truth") or c.get("genreName") or c["genre"]) for c in clips
        )
        if set(per_class) == set(candidates) and len(set(per_class.values())) == 1:
            stats = {}
            for c in candidates:
                column = np.array([r[c] for r in unscaled])
                stats[c] = [float(column.mean()), float(column.std())]
            path = out_dir / f"essentia-calibration{suffix}.json"
            path.write_text(json.dumps(stats, indent=2, ensure_ascii=False))
            print(f"Balanced batch — wrote {path}")

    (out_dir / f"report-essentia{suffix}.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))

    md = ["# LIME ear report — Essentia genre_discogs400\n"]
    for r in results:
        md.append(f"## {r.get('truth') or r.get('genreName')} (`{r['file']}`)")
        md.append("")
        md.append(r["verdict"])
        md.append("")
        md.append("Top Discogs styles: " + ", ".join(f"{k} ({v:.3f})" for k, v in r["topStyles"].items()))
        md.append("")
    (out_dir / f"report-essentia{suffix}.md").write_text("\n".join(md))

    print(f"\nWrote {out_dir/f'report-essentia{suffix}.md'} and report-essentia{suffix}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
