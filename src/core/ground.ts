import { norm, numbersIn, support, wordCount } from "./text";
import type { Source } from "./types";

export const MIN_QUOTE_WORDS = 4;
export const SUPPORT_THRESHOLD = 0.3;
export const EVIDENCE_WINDOW = 2;

interface Index {
  joined: string;
  starts: number[]; // start offset of each segment in `joined`
  ends: number[];
  numbers: Set<string>;
}

const cache = new WeakMap<object, Index>();

function indexOf(src: Source): Index {
  const hit = cache.get(src);
  if (hit) return hit;
  let joined = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const s of src.segments) {
    const n = norm(s.text);
    starts.push(joined.length);
    joined += n;
    ends.push(joined.length);
    joined += " ";
  }
  const idx = { joined, starts, ends, numbers: new Set(numbersIn(src.segments.map((s) => s.text).join(" "))) };
  cache.set(src, idx);
  return idx;
}

function findFragment(idx: Index, frag: string): [number, number] | null {
  let from = 0;
  for (;;) {
    const i = idx.joined.indexOf(frag, from);
    if (i < 0) return null;
    const before = i === 0 || idx.joined[i - 1] === " ";
    const after = i + frag.length === idx.joined.length || idx.joined[i + frag.length] === " ";
    if (before && after) return [i, i + frag.length];
    from = i + 1;
  }
}

/**
 * quote-or-hold: the quote must appear verbatim (modulo case/punctuation) in the source.
 * Ellipses are allowed between fragments. Returns the ids of the segments it touches, or null.
 * `within` restricts matches to a subset of segments (used for catch-up ranges).
 */
export function findQuote(src: Source, quote: string, within?: Set<number>): number[] | null {
  const frags = quote
    .split(/\.{3}|…/)
    .map((f) => norm(f))
    .filter(Boolean);
  if (!frags.length || frags.length > 3) return null;
  if (wordCount(frags.join(" ")) < MIN_QUOTE_WORDS) return null;
  const idx = indexOf(src);
  const ids = new Set<number>();
  for (const f of frags) {
    const span = findFragment(idx, f);
    if (!span) return null;
    for (let i = 0; i < idx.starts.length; i++) {
      if (idx.starts[i] < span[1] && idx.ends[i] > span[0]) ids.add(i);
    }
  }
  const out = [...ids].sort((a, b) => a - b);
  if (within && !out.every((i) => within.has(i))) return null;
  return out;
}

/** Text of the quoted segments plus a small window of neighbours each side: the evidence a claim may draw on. */
export function evidenceText(src: Source, segIds: number[]): string {
  const lo = Math.max(0, Math.min(...segIds) - EVIDENCE_WINDOW);
  const hi = Math.min(src.segments.length - 1, Math.max(...segIds) + EVIDENCE_WINDOW);
  return src.segments.slice(lo, hi + 1).map((s) => s.text).join(" ");
}

export function sourceNumbers(src: Source): Set<string> {
  return indexOf(src).numbers;
}

export type Verdict =
  | { ok: true; segIds: number[] }
  | { ok: false; reason: "quote-not-found" | "unsupported-claim" | "invented-number" };

/**
 * Full check for one generated claim:
 *  1. its quote is in the source,
 *  2. the claim's content words are backed by the quote's neighbourhood,
 *  3. every number in the claim occurs in the source.
 */
export function checkClaim(src: Source, claim: string, quote: string, within?: Set<number>, threshold = SUPPORT_THRESHOLD): Verdict {
  const segIds = findQuote(src, quote, within);
  if (!segIds) return { ok: false, reason: "quote-not-found" };
  const nums = sourceNumbers(src);
  if (numbersIn(claim).some((n) => !nums.has(n))) return { ok: false, reason: "invented-number" };
  if (support(claim, evidenceText(src, segIds)) < threshold) return { ok: false, reason: "unsupported-claim" };
  return { ok: true, segIds };
}
