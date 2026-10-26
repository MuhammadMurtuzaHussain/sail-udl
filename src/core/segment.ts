import type { Segment, Source } from "./types";

export const MAX_SOURCE_CHARS = 12000;

const TURN = /^\s*(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*)?([A-Z][\p{L}.'’ -]{0,30}):\s+(.*)$/u;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(])/).map((s) => s.trim()).filter(Boolean);
  // Fold very short fragments ("Okay.") into the previous sentence so they stay quotable.
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && p.split(/\s+/).length < 3) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

/** Split pasted text into numbered, individually citable segments. */
export function parseSource(raw: string): Source {
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.trimEnd());
  const nonEmpty = lines.filter((l) => l.trim());
  const turnLines = nonEmpty.filter((l) => TURN.test(l)).length;
  const kind = turnLines >= 3 && turnLines >= nonEmpty.length * 0.5 ? "transcript" : "notes";

  const segments: Segment[] = [];
  let line = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    line++;
    let body = l.trim();
    let speaker: string | undefined;
    let time: string | undefined;
    if (kind === "transcript") {
      const m = TURN.exec(l);
      if (m) {
        time = m[1];
        speaker = m[2].trim();
        body = m[3].trim();
      }
    } else {
      body = body.replace(BULLET, "");
    }
    for (const s of sentences(body)) {
      segments.push({ id: segments.length, text: s, line, speaker, time });
    }
  }
  return { raw, kind, segments };
}

/** Render segments for a prompt, one per line, with ids so the model can point at them. */
export function renderForPrompt(src: Source, ids?: number[]): string {
  const want = ids ? new Set(ids) : null;
  return src.segments
    .filter((s) => !want || want.has(s.id))
    .map((s) => `[${s.id}]${s.speaker ? " " + s.speaker + ":" : ""} ${s.text}`)
    .join("\n");
}
