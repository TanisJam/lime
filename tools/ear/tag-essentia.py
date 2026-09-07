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
before anything is ranked. That needs a roughly class-balanced batch, which
every LIME manifest is by construction, and it is what makes the columns
comparable at all. Pass --raw to see the uncalibrated ranking.

The 400-dim profile of every clip is cached next to the manifest, so comparing
aggregators costs no inference.

Usage:
    /data/ai/ear/venv-essentia/bin/python tools/ear/tag-essentia.py <manifest.json> [--aggregate=mean]

Aggregators: mean (default), max, sum, top3, argmax (winner-take-all over all 400).

Output: <out_dir>/report-essentia.json and report-essentia.md next to the manifest.
"""

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
)

MODEL_DIR = Path(os.environ.get("EAR_MODELS", "/data/ai/ear/models/essentia"))
EMBEDDING_PB = MODEL_DIR / "discogs-effnet-bs64-1.pb"
CLASSIFIER_PB = MODEL_DIR / "genre_discogs400-discogs-effnet-1.pb"
CLASSIFIER_JSON = MODEL_DIR / "genre_discogs400-discogs-effnet-1.json"
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


def load_profiles(out_dir: Path, clips: list[dict], n_classes: int) -> dict[str, np.ndarray]:
    """Return one 400-dim activation profile per clip, computing what is missing.

    Inference dominates the runtime and the profile does not depend on the
    candidate set or the aggregator, so it is cached. The cache is keyed by
    file name and silently ignored when the shape no longer matches.
    """
    cache_path = out_dir / "essentia-profiles.npz"
    cached: dict[str, np.ndarray] = {}
    if cache_path.exists():
        with np.load(cache_path) as data:
            cached = {k: data[k] for k in data.files if data[k].shape == (n_classes,)}

    missing = [c for c in clips if c["file"] not in cached]
    if missing:
        print(f"Computing {len(missing)} profile(s) ({len(clips) - len(missing)} cached)")
        embedder = TensorflowPredictEffnetDiscogs(
            graphFilename=str(EMBEDDING_PB), output="PartitionedCall:1"
        )
        classifier = TensorflowPredict2D(
            graphFilename=str(CLASSIFIER_PB),
            input="serving_default_model_Placeholder",
            output="PartitionedCall:0",
        )
        for i, clip in enumerate(missing, 1):
            wav_path = (out_dir / clip["file"]).resolve()
            audio = MonoLoader(filename=str(wav_path), sampleRate=SAMPLE_RATE, resampleQuality=4)()
            # One row per patch of audio; the clip's profile is their mean.
            cached[clip["file"]] = np.mean(classifier(embedder(audio)), axis=0)
            print(f"  [{i}/{len(missing)}] {clip['file'][:60]}", flush=True)
        np.savez_compressed(cache_path, **cached)

    return cached


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

    calibrate = "--raw" not in argv

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

    profiles = load_profiles(out_dir, clips, len(classes))

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

    if calibrate:
        # Per-genre z-score down the batch. A genre whose styles simply score
        # high on everything stops winning by default; only a clip that is
        # unusually that genre *for this batch* does.
        for c in candidates:
            column = np.array([r[c] for r in raw])
            centre, spread = float(column.mean()), float(column.std())
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

    (out_dir / "report-essentia.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))

    md = ["# LIME ear report — Essentia genre_discogs400\n"]
    for r in results:
        md.append(f"## {r.get('truth') or r.get('genreName')} (`{r['file']}`)")
        md.append("")
        md.append(r["verdict"])
        md.append("")
        md.append("Top Discogs styles: " + ", ".join(f"{k} ({v:.3f})" for k, v in r["topStyles"].items()))
        md.append("")
    (out_dir / "report-essentia.md").write_text("\n".join(md))

    print(f"\nWrote {out_dir/'report-essentia.md'} and report-essentia.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
