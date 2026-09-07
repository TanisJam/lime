#!/usr/bin/env python3
"""
LIME "ear" — late fusion of MuQ-MuLan and Essentia genre_discogs400.

On the human reference corpus the two instruments score 24/72 and 32/72, but at
least one of them is right on 42/72. They are not a better and a worse ear;
they are deaf in different places — Essentia hears classical and metal, MuQ-MuLan
hears latin. All that headroom lives in combining them, not in picking one.

The fusion is deliberately free of tunable parameters. Each ear's scores for a
clip are z-scored across the candidates — which is the only way to compare a
cosine similarity with a mean sigmoid probability — and the two z-scores are
added. There is no weight, no temperature and no threshold, so there is nothing
here that can be quietly fitted to the corpus it is measured on.

`--method=rrf` is the same idea over ranks instead of scores (reciprocal rank
fusion), kept as a check: if the two methods disagree a lot, the z-scores are
being driven by one ear's outliers.

It writes the SAME report shape as tag.py and judge.py --blind, so
tools/judge/matrix.mjs scores it without changes.

Usage:
    python3 tools/ear/fuse.py <out_dir> [--method=zscore|rrf]

Reads <out_dir>/report-ear.json and report-essentia.json.
Writes <out_dir>/report-fused.json and report-fused.md.
"""

import json
import statistics
import sys
from pathlib import Path

RRF_K = 60  # The constant from the original RRF paper, not tuned here.


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

    method = next((a.split("=", 1)[1] for a in argv if a.startswith("--method=")), "zscore")
    if method not in ("zscore", "rrf"):
        print(f"ERROR: --method must be zscore or rrf, got {method!r}", file=sys.stderr)
        return 2
    normalise = z_scores if method == "zscore" else rrf_scores

    out_dir = Path(args[0]).resolve()
    reports = {}
    for name, filename in (("muq", "report-ear.json"), ("essentia", "report-essentia.json")):
        path = out_dir / filename
        if not path.exists():
            print(f"ERROR: missing {path}. Run both ears on this manifest first.", file=sys.stderr)
            return 2
        reports[name] = {r["file"]: r for r in json.loads(path.read_text())}

    muq, essentia = reports["muq"], reports["essentia"]
    files = [f for f in muq if f in essentia]
    if not files:
        print("ERROR: the two reports share no clips.", file=sys.stderr)
        return 2
    if len(files) != len(muq) or len(files) != len(essentia):
        # Fusing a partial overlap would score a different clip set than either
        # ear did, and the three numbers would stop being comparable.
        print(
            f"ERROR: reports disagree on clips — muq {len(muq)}, essentia {len(essentia)}, "
            f"shared {len(files)}. Re-run both on the same manifest.",
            file=sys.stderr,
        )
        return 2

    results = []
    agreed = 0
    for file in files:
        a, b = muq[file], essentia[file]
        candidates = set(a["scores"]) & set(b["scores"])
        if candidates != set(a["scores"]) or candidates != set(b["scores"]):
            print(f"ERROR: {file} was judged against different candidate sets.", file=sys.stderr)
            return 2

        za, zb = normalise(a["scores"]), normalise(b["scores"])
        fused = {c: za[c] + zb[c] for c in candidates}
        ranked = sorted(fused.items(), key=lambda p: p[1], reverse=True)
        best, runner = ranked[0], ranked[1]

        top = lambda r: r["verdict"].split("\n")[0].split("BEST MATCH:", 1)[1].strip()
        agreed += top(a) == top(b)

        verdict = (
            f"1. BEST MATCH: {best[0]}\n"
            f"2. RUNNER-UP: {runner[0]}\n"
            f"3. SCORES: " + ", ".join(f"{c}={s:.4f}" for c, s in ranked)
        )
        clip = {k: v for k, v in a.items() if k not in ("verdict", "scores")}
        results.append({
            **clip,
            "verdict": verdict,
            "scores": fused,
            "ears": {"muq": top(a), "essentia": top(b)},
        })

    (out_dir / "report-fused.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))

    md = [f"# LIME ear report — MuQ-MuLan + Essentia fused ({method})\n"]
    for r in results:
        md.append(f"## {r.get('truth') or r.get('genreName')} (`{r['file']}`)")
        md.append("")
        md.append(r["verdict"])
        md.append("")
        md.append(f"Ears: MuQ-MuLan → {r['ears']['muq']}, Essentia → {r['ears']['essentia']}")
        md.append("")
    (out_dir / "report-fused.md").write_text("\n".join(md))

    print(f"{len(results)} clip(s) fused by {method}; the two ears agreed on {agreed}.")
    print(f"Wrote {out_dir/'report-fused.md'} and report-fused.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
