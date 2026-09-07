#!/usr/bin/env python3
"""
LIME "ear" — late fusion of every available ear.

Three instruments listen to the same clips: MuQ-MuLan (zero-shot, open label
set), Essentia genre_discogs400 on EfficientNet, and the same head on MAEST.
On the human reference corpus they score 24, 31 and 30 out of 72 — but at least
one of them is right on 44 of those 72. They are not a better and a worse ear;
they are deaf in different places, and all the headroom is in combining them.

The fusion is deliberately free of tunable parameters and of choices. Each ear's
scores for a clip are z-scored across the candidates — the only way to compare a
cosine similarity with a mean sigmoid probability — and the z-scores are added.
Every ear present is used; there is no weight, no temperature, no threshold and
no subset to pick, so there is nothing here that can be quietly fitted to the
corpus it is measured on. Choosing the subset was tried on one stratified half
of the reference corpus and the winner did not survive the other half, which is
exactly why the rule is "use them all".

`--method=rrf` is the same idea over ranks (reciprocal rank fusion), kept as a
check: if the two methods disagree a lot, one ear's outliers are driving the
z-scores.

It writes the SAME report shape as tag.py and judge.py --blind, so
tools/judge/matrix.mjs scores it without changes.

Usage:
    python3 tools/ear/fuse.py <out_dir> [--ears=muq,effnet,maest] [--method=zscore|rrf] [--flat]

Reads <out_dir>/report-{ear}.json for each ear; writes report-fused.json/.md.
"""

import json
import statistics
import sys
from pathlib import Path

RRF_K = 60  # The constant from the original RRF paper, not tuned here.

EAR_REPORTS = {
    "muq": "report-ear.json",
    "effnet": "report-essentia.json",
    "maest": "report-essentia-maest.json",
}

# Adding one z-score per ear treats them as independent witnesses, and two of
# them are not: EfficientNet and MAEST share the Discogs taxonomy, the training
# data and the classification head. They answer the same on 60% of the reference
# corpus against 37% for either against MuQ-MuLan, and they share 19 wrong
# answers against 12-14. So they vote once, as a family, and the vote is split
# between them. Pass --flat to add every ear separately instead.
FAMILIES = {"muq": ["muq"], "essentia": ["effnet", "maest"]}


def z_scores(scores: dict[str, float]) -> dict[str, float]:
    values = list(scores.values())
    mean = statistics.fmean(values)
    # A flat ear has nothing to say about this clip; contribute zero rather
    # than dividing by zero and inventing a winner.
    spread = statistics.pstdev(values)
    if spread == 0:
        return {c: 0.0 for c in scores}
    return {c: (v - mean) / spread for c, v in scores.items()}


def rrf_scores(scores: dict[str, float]) -> dict[str, float]:
    order = sorted(scores, key=lambda c: scores[c], reverse=True)
    return {c: 1.0 / (RRF_K + rank) for rank, c in enumerate(order, 1)}


def main() -> int:
    argv = sys.argv[1:]
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2

    grouped = "--flat" not in argv
    method = next((a.split("=", 1)[1] for a in argv if a.startswith("--method=")), "zscore")
    if method not in ("zscore", "rrf"):
        print(f"ERROR: --method must be zscore or rrf, got {method!r}", file=sys.stderr)
        return 2
    normalise = z_scores if method == "zscore" else rrf_scores

    out_dir = Path(args[0]).resolve()
    wanted = next((a.split("=", 1)[1].split(",") for a in argv if a.startswith("--ears=")), None)

    reports: dict[str, dict[str, dict]] = {}
    for ear, filename in EAR_REPORTS.items():
        if wanted is not None and ear not in wanted:
            continue
        path = out_dir / filename
        if not path.exists():
            # An explicitly named ear must be there; an implicit one may not be.
            if wanted is not None:
                print(f"ERROR: missing {path}", file=sys.stderr)
                return 2
            continue
        reports[ear] = {r["file"]: r for r in json.loads(path.read_text())}

    unknown = [e for e in (wanted or []) if e not in EAR_REPORTS]
    if unknown:
        print(f"ERROR: unknown ear(s) {unknown}; known: {', '.join(EAR_REPORTS)}", file=sys.stderr)
        return 2
    if len(reports) < 2:
        print(
            f"ERROR: found {len(reports)} ear report(s) in {out_dir}. Run at least two ears "
            "on this manifest first.",
            file=sys.stderr,
        )
        return 2

    sizes = {ear: len(r) for ear, r in reports.items()}
    files = sorted(set.intersection(*(set(r) for r in reports.values())))
    # Fusing a partial overlap would score a different clip set than the ears
    # did, and the numbers would stop being comparable.
    if len(set(sizes.values())) != 1 or len(files) != next(iter(sizes.values())):
        print(
            f"ERROR: ear reports disagree on clips ({sizes}, shared {len(files)}). "
            "Re-run every ear on the same manifest.",
            file=sys.stderr,
        )
        return 2

    ears = list(reports)
    results = []
    unanimous = 0
    for file in files:
        records = {ear: reports[ear][file] for ear in ears}
        candidate_sets = [frozenset(r["scores"]) for r in records.values()]
        if len(set(candidate_sets)) != 1:
            print(f"ERROR: {file} was judged against different candidate sets.", file=sys.stderr)
            return 2

        groups = (
            [[e for e in fam if e in records] for fam in FAMILIES.values()]
            if grouped
            else [[ear] for ear in ears]
        )
        fused: dict[str, float] = {}
        for group in groups:
            if not group:
                continue
            for ear in group:
                for candidate, value in normalise(records[ear]["scores"]).items():
                    fused[candidate] = fused.get(candidate, 0.0) + value / len(group)

        ranked = sorted(fused.items(), key=lambda p: p[1], reverse=True)
        best, runner = ranked[0], ranked[1]

        heard = {
            ear: r["verdict"].split("\n")[0].split("BEST MATCH:", 1)[1].strip()
            for ear, r in records.items()
        }
        unanimous += len(set(heard.values())) == 1

        verdict = (
            f"1. BEST MATCH: {best[0]}\n"
            f"2. RUNNER-UP: {runner[0]}\n"
            f"3. SCORES: " + ", ".join(f"{c}={s:.4f}" for c, s in ranked)
        )
        first = records[ears[0]]
        clip = {k: v for k, v in first.items() if k not in ("verdict", "scores", "topStyles")}
        results.append({**clip, "verdict": verdict, "scores": fused, "ears": heard})

    (out_dir / "report-fused.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))

    md = [f"# LIME ear report — {' + '.join(ears)} fused ({method})\n"]
    for r in results:
        md.append(f"## {r.get('truth') or r.get('genreName')} (`{r['file']}`)")
        md.append("")
        md.append(r["verdict"])
        md.append("")
        md.append("Ears: " + ", ".join(f"{e} → {v}" for e, v in r["ears"].items()))
        md.append("")
    (out_dir / "report-fused.md").write_text("\n".join(md))

    print(f"{len(results)} clip(s) fused by {method} over {', '.join(ears)}; "
          f"all agreed on {unanimous}.")
    print(f"Wrote {out_dir/'report-fused.md'} and report-fused.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
