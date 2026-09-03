#!/usr/bin/env bash
#
# Download the non-commercial LIME corpus datasets into packages/corpus/data/.
# These carry non-commercial / research licenses — the files stay local (the
# data/ directory is git-ignored). LIME only ships DERIVED statistics.
#
# GigaMIDI is intentionally skipped: it needs git-lfs (not installed) plus a
# HuggingFace account. Install git-lfs and use huggingface_hub to add it.

set -u
DATA="$(cd "$(dirname "$0")/.." && pwd)/data"
log() { echo "[$(date +%H:%M:%S)] $*"; }

# --- EMOPIA (CC BY-NC-SA 4.0) — pop piano, 4-quadrant emotion labels, ~5.5MB ---
log "EMOPIA: downloading (~5.5MB)..."
if curl -fL --retry 3 --max-time 600 -o "$DATA/emopia/EMOPIA_1.0.zip" \
    "https://zenodo.org/api/records/5090631/files/EMOPIA_1.0.zip/content"; then
  (cd "$DATA/emopia" && unzip -o -q EMOPIA_1.0.zip) && log "EMOPIA: done"
else
  log "EMOPIA: FAILED"
fi

# --- VGMIDI (research/non-commercial) — game soundtrack, valence-arousal ---
log "VGMIDI: cloning..."
rm -rf "$DATA/vgmidi/repo"
if git clone --depth 1 https://github.com/lucasnfe/vgmidi.git "$DATA/vgmidi/repo"; then
  log "VGMIDI: done"
else
  log "VGMIDI: FAILED"
fi

# --- Lakh clean_midi subset (research-only) — multi-instrument, ~234MB ---
log "LAKH clean_midi: downloading (~234MB)..."
if curl -fL --retry 3 --max-time 3600 -o "$DATA/lakh/clean_midi.tar.gz" \
    "http://hog.ee.columbia.edu/craffel/lmd/clean_midi.tar.gz"; then
  (cd "$DATA/lakh" && tar xzf clean_midi.tar.gz) && log "LAKH: done"
else
  log "LAKH: FAILED"
fi

log "GigaMIDI: SKIPPED (needs git-lfs + HuggingFace account)."
log "ALL DONE"
