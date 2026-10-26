import { catchUpPrompt } from "./prompts";
import { checkClaim } from "./ground";
import { contentStems } from "./text";
import type { Llm, Source } from "./types";

export interface CatchUpItem {
  point: string;
  quote: string;
  segIds: number[];
}
export interface CatchUp {
  range: [number, number];
  items: CatchUpItem[];
  held: number;
  method: "gemma+code" | "extractive";
}

export function rangeIds(range: [number, number]): number[] {
  const [a, b] = range;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** No-model fallback: pick the segments in the range that carry the most repeated content words. */
export function extractiveCatchUp(src: Source, range: [number, number], max = 4): CatchUp {
  const segs = rangeIds(range).map((i) => src.segments[i]).filter(Boolean);
  const freq = new Map<string, number>();
  for (const s of segs) for (const w of new Set(contentStems(s.text))) freq.set(w, (freq.get(w) ?? 0) + 1);
  const scored = segs
    .map((s) => {
      const w = contentStems(s.text);
      const score = w.reduce((a, x) => a + (freq.get(x) ?? 0), 0) / Math.sqrt(w.length || 1);
      return { s, score };
    })
    .filter((x) => x.s.text.split(/\s+/).length >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.s.id - b.s.id);
  return {
    range,
    held: 0,
    method: "extractive",
    items: scored.map(({ s }) => ({ point: s.text, quote: s.text, segIds: [s.id] })),
  };
}

/** Gemma summarises only the missed range; every point must quote from inside that range. */
export async function catchUp(src: Source, range: [number, number], llm: Llm): Promise<CatchUp> {
  const ids = rangeIds(range);
  const within = new Set(ids);
  const raw = (await llm(catchUpPrompt(src, ids))) as { items?: { quote?: unknown; point?: unknown }[] };
  const items: CatchUpItem[] = [];
  let held = 0;
  for (const it of raw.items ?? []) {
    const quote = typeof it.quote === "string" ? it.quote.trim() : "";
    const point = typeof it.point === "string" ? it.point.trim() : "";
    const v = quote && point ? checkClaim(src, point, quote, within) : null;
    if (v?.ok) items.push({ point, quote, segIds: v.segIds });
    else held++;
  }
  return { range, items, held, method: "gemma+code" };
}
