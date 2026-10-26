import { gradePrompt } from "./prompts";
import { norm, support, wordCount } from "./text";
import type { Llm, Point } from "./types";

export interface Grade {
  covered: { id: number; evidence: string }[];
  missed: number[];
  /** 0..1 share of key ideas covered. */
  coverage: number;
  method: "gemma+code" | "lexical";
  /** Model claims the code refused (evidence not in the learner's text, or no word overlap). */
  rejected: number;
}

const OVERLAP = 0.34;

/** Offline grading: an idea counts as covered when enough of its content words appear in the answer. */
export function lexicalGrade(points: Point[], answer: string): Grade {
  const covered = points
    .filter((p) => support(p.text, answer) >= OVERLAP)
    .map((p) => ({ id: p.id, evidence: "" }));
  return finish(points, covered, "lexical", 0);
}

function finish(points: Point[], covered: Grade["covered"], method: Grade["method"], rejected: number): Grade {
  const ids = new Set(covered.map((c) => c.id));
  return {
    covered,
    missed: points.filter((p) => !ids.has(p.id)).map((p) => p.id),
    coverage: points.length ? ids.size / points.length : 0,
    method,
    rejected,
  };
}

/**
 * Gemma judges, code guarantees: the model says which ideas the learner covered and must quote the
 * learner's own words as evidence. Code rejects any claim whose evidence is not in the answer or
 * shares no content words with the idea, so the model can never award credit for text that is not there.
 */
export async function gradeExplainBack(points: Point[], answer: string, llm: Llm): Promise<Grade> {
  if (wordCount(answer) < 5) return finish(points, [], "gemma+code", 0);
  const req = gradePrompt(points, answer);
  const raw = (await llm(req)) as { covered?: { id?: unknown; evidence?: unknown }[] };
  const ans = norm(answer);
  const seen = new Set<number>();
  const covered: Grade["covered"] = [];
  let rejected = 0;
  for (const c of raw.covered ?? []) {
    const p = points.find((x) => x.id === c.id);
    const ev = typeof c.evidence === "string" ? c.evidence.trim() : "";
    if (!p || seen.has(p.id) || !ev || !ans.includes(norm(ev)) || support(p.text, ev) < 0.2) {
      rejected++;
      continue;
    }
    seen.add(p.id);
    covered.push({ id: p.id, evidence: ev });
  }
  return finish(points, covered, "gemma+code", rejected);
}
