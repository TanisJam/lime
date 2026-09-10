/**
 * ab-page.mjs — turn a rendered blind A/B test into one self-contained HTML page.
 *
 * `ab-listen.mjs` produces the test: rendered, loudness-matched, shuffled clips
 * plus a `PROMPT.md` and an `ANSWER-KEY.json`. It leaves answering it to a
 * terminal loop over `ffplay`, which is fine at a desk and useless anywhere else.
 * This turns the same directory into a single portable file — clips embedded,
 * so it works by double-click, offline, on a phone.
 *
 * Two properties are preserved from the command-line version, because they are
 * what makes the test worth anything:
 *
 *   1. **The key stays shut.** Clip labels come from the answer key with the
 *      parenthetical stripped. For `bass-syncopation` that reduces
 *      "pushed (current default, ear-confirmed)" to "pushed" and
 *      "grounded (matches the measured reference)" to "grounded" — the
 *      perceptual words, without the identity that lives in the parentheses.
 *      The full key is behind a confirmation button, not in the markup.
 *   2. **Answers survive a refresh.** They are kept in localStorage and shown
 *      as one line in the PROMPT.md format, so a session can be interrupted.
 *
 * Usage:
 *   node tools/judge/ab-page.mjs                          # every variant found
 *   node tools/judge/ab-page.mjs --variant=bass-syncopation
 *   node tools/judge/ab-page.mjs --embed=wav              # default: mp3 (smaller)
 *   node tools/judge/ab-page.mjs --open                   # xdg-open the result
 *
 * Output: `tools/judge/out/ab/<variant>/listen.html`
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AB_ROOT = join(HERE, "out", "ab");

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const has = (name) => process.argv.includes(`--${name}`);

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Minimal markdown, enough for PROMPT.md: headings, paragraphs, bold, italics,
 * inline code. Deliberately not a dependency — the input is a file this repo
 * writes itself.
 */
function mdToHtml(src) {
  const inline = (t) =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      blocks.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };

  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 1, 6);
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks.join("\n");
}

/**
 * The perceptual pole this clip's variant represents, with the identity-bearing
 * parenthetical removed. "pushed (current default, ear-confirmed)" -> "pushed".
 */
function poleLabel(label) {
  return String(label)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mimeFor(file) {
  if (file.endsWith(".mp3")) return "audio/mpeg";
  if (file.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

/** Resolve the audio file for a clip, preferring the requested format. */
function clipFile(dir, clipName, prefer) {
  const stem = clipName.replace(/\.[^.]+$/, "");
  const order = prefer === "wav" ? ["wav", "mp3"] : ["mp3", "wav"];
  for (const ext of order) {
    const p = join(dir, `${stem}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

function buildPage(dir, variantName, prefer) {
  const key = JSON.parse(readFileSync(join(dir, "ANSWER-KEY.json"), "utf8"));
  const promptSrc = readFileSync(join(dir, "PROMPT.md"), "utf8");

  // Read the rationale separately: it names which variant the measurements
  // favour, so it renders only inside the revealed key block.
  const rationalePath = join(dir, "RATIONALE.md");
  const rationaleSrc = existsSync(rationalePath) ? readFileSync(rationalePath, "utf8") : null;

  // Distinct perceptual poles, in first-seen order, identity stripped.
  const poles = [];
  for (const c of key.clips) {
    const p = poleLabel(c.variant);
    if (p && !poles.includes(p)) poles.push(p);
  }
  let chips = poles.length === 2 ? poles : null;
  if (!chips) {
    console.warn(
      `  ! ${variantName}: expected 2 distinct poles after stripping parentheses, ` +
        `got ${JSON.stringify(poles)} — falling back to generic chips.`,
    );
  }

  let embeddedBytes = 0;
  const cards = key.clips.map((c, i) => {
    const file = clipFile(dir, c.clip, prefer);
    if (!file) throw new Error(`no audio for ${c.clip} in ${dir}`);
    const b64 = readFileSync(file).toString("base64");
    embeddedBytes += b64.length;
    const n = i + 1;
    const options = (chips ?? ["A", "B"])
      .map(
        (p) =>
          `<button type="button" class="chip" data-clip="${n}" data-value="${esc(p)}">${esc(p)}</button>`,
      )
      .join("\n          ");
    return `
        <article class="clip" data-clip="${n}">
          <div class="clip-head">
            <span class="num">${String(n).padStart(2, "0")}</span>
            <span class="seed">seed ${esc(c.seed)}</span>
            <span class="verdict" data-verdict="${n}"></span>
          </div>
          <audio controls preload="metadata" src="data:${mimeFor(file)};base64,${b64}"></audio>
          <div class="chips" role="group" aria-label="Clip ${n} judgement">
          ${options}
            <button type="button" class="chip chip-ind" data-clip="${n}" data-value="indistinct">indistinct</button>
            <button type="button" class="chip chip-keep" data-clip="${n}" data-value="keep">&#9733; keep</button>
          </div>
          <input type="text" class="note" data-note="${n}" placeholder="notes (optional)" />
        </article>`;
  });

  const keyRows = key.clips
    .map(
      (c, i) =>
        `<tr><td>${String(i + 1).padStart(2, "0")}</td><td>${esc(c.variant)}</td><td>${esc(c.seed)}</td></tr>`,
    )
    .join("\n          ");

  // Everything below the key. Withheld until reveal because it names the
  // measurement-preferred variant and this is a preference test.
  const rationaleBlock = rationaleSrc ? mdToHtml(rationaleSrc) : "";
  const totalMb = (embeddedBytes / 1024 / 1024).toFixed(1);
  const storeKey = `lime-ab-${variantName}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Blind A/B — ${esc(key.genre)} · ${esc(variantName)}</title>
<style>
  :root {
    --bg: #0e1116; --panel: #161b22; --line: #262c36; --ink: #e6edf3;
    --dim: #8b949e; --accent: #7ee787; --accent-dim: #2ea043; --warn: #e3b341;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 32px 20px 120px;
  }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; margin: 32px 0 10px; }
  .sub { color: var(--dim); font-size: 13px; margin-bottom: 24px; }
  .q { font-size: 17px; border-left: 2px solid var(--accent); padding-left: 14px; margin: 0 0 20px; }
  .prompt { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 4px 18px 14px; }
  .prompt h2, .prompt h3 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); }
  .prompt p { margin: 10px 0; }
  .prompt code { background: #0b0f14; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; font-size: 13px; overflow-wrap: anywhere; }
  .warn {
    background: #241f11; border: 1px solid #4d3d15; color: var(--warn);
    border-radius: 10px; padding: 12px 16px; margin: 24px 0; font-size: 14px;
  }
  .clip {
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 12px;
  }
  .clip.answered { border-color: var(--accent-dim); }
  .clip-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .num { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .seed { color: var(--dim); font-size: 12px; }
  .verdict { margin-left: auto; font-size: 12px; color: var(--accent); }
  audio { width: 100%; height: 34px; margin-bottom: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    background: #0b0f14; color: var(--ink); border: 1px solid var(--line);
    border-radius: 999px; padding: 5px 13px; font: inherit; font-size: 13px; cursor: pointer;
  }
  .chip:hover { border-color: #3b434f; }
  .chip.on { background: var(--accent-dim); border-color: var(--accent); color: #04170a; font-weight: 600; }
  .chip-keep.on { background: #6b5a1a; border-color: var(--warn); color: #fff3cd; }
  .note {
    width: 100%; margin-top: 10px; background: #0b0f14; color: var(--ink);
    border: 1px solid var(--line); border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 13px;
  }
  .answer {
    position: fixed; left: 0; right: 0; bottom: 0; background: #0b0f14ee;
    border-top: 1px solid var(--line); padding: 12px 20px; backdrop-filter: blur(8px);
  }
  .answer-inner { max-width: 720px; margin: 0 auto; display: flex; gap: 10px; align-items: center; }
  .answer code {
    flex: 1; min-width: 0; font-size: 13px; color: var(--accent);
    overflow-x: auto; white-space: nowrap;
  }
  button.act {
    background: var(--accent-dim); color: #04170a; border: 0; border-radius: 7px;
    padding: 8px 14px; font: inherit; font-weight: 600; font-size: 13px; cursor: pointer;
    white-space: nowrap;
  }
  button.act.ghost { background: transparent; color: var(--dim); border: 1px solid var(--line); font-weight: 400; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; table-layout: fixed; }
  th, td {
    text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  th:nth-child(1), td:nth-child(1) { width: 3.5em; }
  th:nth-child(3), td:nth-child(3) { width: 4.5em; }
  th { color: var(--dim); font-weight: 500; }
  #key[hidden] { display: none; }
  @media (max-width: 560px) {
    .answer code { white-space: normal; }
    .answer-inner { flex-wrap: wrap; }
    .answer code { flex-basis: 100%; }
  }
</style>
</head>
<body>
<main>
  <h1>Blind A/B — ${esc(key.genre)}</h1>
  <div class="sub">variant <code>${esc(variantName)}</code> · ${key.clips.length} clips · loudness-matched</div>

  <div class="prompt">
${mdToHtml(promptSrc)}
  </div>

  <div class="warn">
    <strong>Answer before you reveal.</strong> Knowing which clip is the fix is
    enough to hear it as better — that is the whole reason this is blind. The key
    stays hidden until you press reveal, and reveal asks first.
  </div>

  <h2>Clips</h2>
${cards.join("\n")}

  <h2>Answer key</h2>
  <p class="sub">Do not open this until your list above is complete.</p>
  <button class="act ghost" id="reveal">Reveal the key</button>
  <div id="key" hidden>
    <table>
      <thead><tr><th>Clip</th><th>Variant</th><th>Seed</th></tr></thead>
      <tbody>
          ${keyRows}
      </tbody>
    </table>
  </div>

  <div id="rationale" hidden>
${rationaleBlock}
  </div>
</main>

<div class="answer">
  <div class="answer-inner">
    <code id="line">—</code>
    <button class="act" id="copy">Copy</button>
    <button class="act ghost" id="reset">Reset</button>
  </div>
</div>

<script>
  const N = ${key.clips.length};
  const STORE = ${JSON.stringify(storeKey)};
  let state = {};
  try { state = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { state = {}; }

  const persist = () => localStorage.setItem(STORE, JSON.stringify(state));

  function render() {
    for (let i = 1; i <= N; i++) {
      const s = state[i] || { value: null, keep: false, note: "" };
      const card = document.querySelector('[data-clip="' + i + '"].clip');
      card.classList.toggle("answered", !!s.value);
      for (const chip of card.querySelectorAll(".chip")) {
        const v = chip.dataset.value;
        const on = v === "keep" ? s.keep : (v === s.value && !s.keep);
        chip.classList.toggle("on", on);
      }
      const note = card.querySelector(".note");
      if (note !== document.activeElement) note.value = s.note || "";
      const parts = [];
      if (s.value) parts.push(s.value);
      if (s.keep) parts.push("keep");
      card.querySelector(".verdict").textContent = parts.join(" ");
    }
    const line = [];
    for (let i = 1; i <= N; i++) {
      const s = state[i];
      if (!s || !s.value) continue;
      line.push(i + " " + s.value + (s.keep ? " keep" : ""));
    }
    document.getElementById("line").textContent = line.length ? line.join(", ") : "—";
  }

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const i = Number(chip.dataset.clip);
      const v = chip.dataset.value;
      const s = state[i] || { value: null, keep: false, note: "" };
      if (v === "keep") s.keep = !s.keep;
      else s.value = s.value === v ? null : v;
      state[i] = s;
      persist();
      render();
    });
  });

  document.querySelectorAll(".note").forEach((inp) => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.note);
      const s = state[i] || { value: null, keep: false, note: "" };
      s.note = inp.value;
      state[i] = s;
      persist();
    });
  });

  document.getElementById("copy").addEventListener("click", async (e) => {
    const text = document.getElementById("line").textContent;
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = "Copied";
    } catch {
      e.target.textContent = "Select it";
    }
    setTimeout(() => (e.target.textContent = "Copy"), 1400);
  });

  document.getElementById("reset").addEventListener("click", () => {
    if (!confirm("Clear every answer on this page?")) return;
    state = {};
    persist();
    render();
  });

  document.getElementById("reveal").addEventListener("click", (e) => {
    const answered = Object.values(state).filter((s) => s && s.value).length;
    const msg = answered < N
      ? "You have answered " + answered + " of " + N + " clips. Reveal anyway?"
      : "Reveal the key?";
    if (!confirm(msg)) return;
    document.getElementById("key").hidden = false;
    const rat = document.getElementById("rationale");
    if (rat) rat.hidden = false;
    e.target.hidden = true;
  });

  render();
</script>
</body>
</html>
`;
}

function main() {
  if (!existsSync(AB_ROOT)) {
    console.error(`No rendered tests at ${AB_ROOT} — run tools/judge/ab-listen.mjs first.`);
    process.exit(1);
  }
  const only = arg("variant", null);
  const prefer = arg("embed", "mp3");

  const dirs = readdirSync(AB_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !only || name === only);

  if (!dirs.length) {
    console.error(only ? `No rendered test named "${only}".` : "No rendered tests found.");
    process.exit(1);
  }

  const written = [];
  for (const name of dirs) {
    const dir = join(AB_ROOT, name);
    if (!existsSync(join(dir, "ANSWER-KEY.json"))) {
      console.warn(`  ! skipping ${name}: no ANSWER-KEY.json`);
      continue;
    }
    const html = buildPage(dir, name, prefer);
    const out = join(dir, "listen.html");
    writeFileSync(out, html);
    written.push(out);
    console.log(`  ${name}: ${statSync(out).size / 1024 / 1024 > 1
      ? (statSync(out).size / 1024 / 1024).toFixed(1) + " MB"
      : Math.round(statSync(out).size / 1024) + " KB"} -> ${out}`);
  }

  if (!written.length) process.exit(1);

  if (has("open")) {
    try {
      execFileSync("xdg-open", [written[0]], { stdio: "ignore", detached: true });
    } catch {
      console.warn("  (could not open a browser; open the file above by hand)");
    }
  }
  console.log("");
}

main();
