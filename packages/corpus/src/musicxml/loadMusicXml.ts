import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import type { CorpusMeta, CorpusScore } from "../ir.js";
import { parseMusicXml } from "./parseMusicXml.js";

/** Read the root MusicXML text out of a compressed `.mxl` container. */
export function extractMxl(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const decode = (u8: Uint8Array) => new TextDecoder("utf-8").decode(u8);

  // The container manifest names the root score file.
  const container = entries["META-INF/container.xml"];
  if (container) {
    const m = /full-path\s*=\s*"([^"]+)"/.exec(decode(container));
    if (m && entries[m[1]!]) return decode(entries[m[1]!]!);
  }
  // Fallback: first .xml/.musicxml entry outside META-INF.
  for (const name of Object.keys(entries)) {
    if (name.startsWith("META-INF/")) continue;
    if (/\.(xml|musicxml)$/i.test(name)) return decode(entries[name]!);
  }
  throw new Error("extractMxl: no MusicXML entry found in .mxl archive");
}

/** Load a MusicXML file (`.xml`, `.musicxml`, or compressed `.mxl`) into IR. */
export function loadMusicXmlFile(
  path: string,
  options: { id: string; meta: Omit<CorpusMeta, "key"> },
): CorpusScore {
  const bytes = readFileSync(path);
  const xml = path.toLowerCase().endsWith(".mxl")
    ? extractMxl(new Uint8Array(bytes))
    : new TextDecoder("utf-8").decode(bytes);
  return parseMusicXml(xml, options);
}
