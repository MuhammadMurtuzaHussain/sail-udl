import { checkClaim, findQuote, evidenceText } from "./ground";
import { SECTIONS, SYSTEM, type SectionSpec } from "./prompts";
import { norm, numbersIn, support, wordCount } from "./text";
import { sourceNumbers } from "./ground";
import type {
  AudioLine, Example, Held, HoldReason, Kit, Llm, MapEdge, MapNode, Point, ProjectIdea, QuizItem, SectionId, Source,
} from "./types";

type Raw = Record<string, unknown>;
const arr = (x: unknown): Raw[] => (Array.isArray(x) ? x.filter((v): v is Raw => !!v && typeof v === "object") : []);
const s = (x: unknown): string => (typeof x === "string" ? x.trim() : "");
const sArr = (x: unknown): string[] => (Array.isArray(x) ? x.map(s).filter(Boolean) : []);

export function emptyKit(model: string): Kit {
  return {
    model,
    points: [], map: { nodes: [], edges: [] }, quiz: [], examples: [], audio: [], projects: [], held: [],
    proposed: { points: 0, map: 0, quiz: 0, examples: 0, audio: 0, projects: 0 },
  };
}

class Ctx {
  constructor(public kit: Kit, public src: Source) {}
  hold(section: SectionId, reason: HoldReason, item: string) {
    this.kit.held.push({ section, reason, item: item.slice(0, 140) });
  }
}

/** Deterministic shuffle so the correct answer is not always where the model likes to put it. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Numbers-only check for illustrative sections (examples, projects): quote must exist, no invented numbers. */
function anchorOnly(c: Ctx, section: SectionId, quote: string, texts: string[], label: string): number[] | null {
  const segIds = findQuote(c.src, quote);
  if (!segIds) return c.hold(section, "quote-not-found", label), null;
  const nums = sourceNumbers(c.src);
  if (texts.some((t) => numbersIn(t).some((n) => !nums.has(n)))) return c.hold(section, "invented-number", label), null;
  return segIds;
}

const validators: Record<SectionId, (c: Ctx, raw: Raw) => void> = {
  points(c, raw) {
    const items = arr(raw.items);
    c.kit.proposed.points = items.length;
    for (const it of items) {
      const text = s(it.idea), quote = s(it.quote);
      if (!text || !quote) { c.hold("points", "malformed", text || quote); continue; }
      const v = checkClaim(c.src, text, quote);
      if (!v.ok) { c.hold("points", v.reason, text); continue; }
      if (c.kit.points.some((p) => norm(p.text) === norm(text))) { c.hold("points", "duplicate", text); continue; }
      c.kit.points.push({ id: c.kit.points.length, text, quote, segIds: v.segIds } satisfies Point);
    }
  },

  map(c, raw) {
    const nodes = arr(raw.nodes), edges = arr(raw.edges);
    c.kit.proposed.map = nodes.length + edges.length;
    const byLabel = new Map<string, MapNode>();
    for (const n of nodes) {
      const label = s(n.label), quote = s(n.quote);
      if (!label || !quote || wordCount(label) > 6) { c.hold("map", "malformed", label || quote); continue; }
      const v = checkClaim(c.src, label, quote);
      if (!v.ok) { c.hold("map", v.reason, label); continue; }
      if (byLabel.has(norm(label))) { c.hold("map", "duplicate", label); continue; }
      const node: MapNode = { id: `n${byLabel.size + 1}`, label, quote, segIds: v.segIds };
      byLabel.set(norm(label), node);
    }
    const seen = new Set<string>();
    for (const e of edges) {
      const from = byLabel.get(norm(s(e.from))), to = byLabel.get(norm(s(e.to)));
      const relation = s(e.relation), quote = s(e.quote);
      const desc = `${s(e.from)} -${relation}-> ${s(e.to)}`;
      if (!from || !to || from === to) { c.hold("map", "dangling-edge", desc); continue; }
      if (!relation || !quote) { c.hold("map", "malformed", desc); continue; }
      const v = checkClaim(c.src, relation, quote);
      // A relation is a short verb phrase, so only the quote itself is required to be real.
      if (!v.ok && v.reason !== "unsupported-claim") { c.hold("map", v.reason, desc); continue; }
      const segIds = findQuote(c.src, quote)!;
      const key = `${from.id}|${to.id}`;
      if (seen.has(key)) { c.hold("map", "duplicate", desc); continue; }
      seen.add(key);
      c.kit.map.edges.push({ from: from.id, to: to.id, label: relation, quote, segIds } satisfies MapEdge);
    }
    c.kit.map.nodes = [...byLabel.values()];
  },

  quiz(c, raw) {
    const items = arr(raw.items);
    c.kit.proposed.quiz = items.length;
    for (const it of items) {
      const question = s(it.question), correct = s(it.correct), quote = s(it.quote);
      const wrong = sArr(it.wrong);
      const label = question || quote;
      if (!question || !correct || !quote || !s(it.explanation)) { c.hold("quiz", "malformed", label); continue; }
      const opts = [correct, ...wrong];
      const distinct = new Set(opts.map(norm));
      if (wrong.length !== 3 || distinct.size !== 4 || [...distinct].some((o) => !o)) { c.hold("quiz", "malformed", label); continue; }
      const v = checkClaim(c.src, correct, quote, undefined, 0.25);
      if (!v.ok) { c.hold("quiz", v.reason, label); continue; }
      const nums = sourceNumbers(c.src);
      if ([question, s(it.explanation)].some((t) => numbersIn(t).some((n) => !nums.has(n)))) { c.hold("quiz", "invented-number", label); continue; }
      // The answer must be provable from the quote, so a distractor must not be better supported than it.
      const ev = evidenceText(c.src, v.segIds);
      if (wrong.some((w) => support(w, ev) > support(correct, ev))) { c.hold("quiz", "unsupported-claim", label); continue; }
      const shuffled = seededShuffle(opts, question);
      c.kit.quiz.push({
        question, options: shuffled, answer: shuffled.indexOf(correct), explanation: s(it.explanation), quote, segIds: v.segIds,
      } satisfies QuizItem);
    }
  },

  examples(c, raw) {
    const items = arr(raw.items);
    c.kit.proposed.examples = items.length;
    for (const it of items) {
      const title = s(it.title), scenario = s(it.scenario), steps = sArr(it.steps), quote = s(it.quote);
      if (!title || !scenario || steps.length < 2) { c.hold("examples", "malformed", title || quote); continue; }
      const segIds = anchorOnly(c, "examples", quote, [title, scenario, ...steps], title);
      if (segIds) c.kit.examples.push({ title, scenario, steps, quote, segIds } satisfies Example);
    }
  },

  audio(c, raw) {
    const items = arr(raw.lines);
    c.kit.proposed.audio = items.length;
    for (const it of items) {
      const text = s(it.line), quote = s(it.quote);
      if (!text || !quote) { c.hold("audio", "malformed", text || quote); continue; }
      const v = checkClaim(c.src, text, quote);
      if (!v.ok) { c.hold("audio", v.reason, text); continue; }
      const speaker = norm(s(it.speaker)) === "ben" ? "Ben" : "Ana";
      c.kit.audio.push({ speaker, text, quote, segIds: v.segIds } satisfies AudioLine);
    }
  },

  projects(c, raw) {
    const items = arr(raw.items);
    c.kit.proposed.projects = items.length;
    for (const it of items) {
      const title = s(it.title), brief = s(it.brief), quote = s(it.quote);
      if (!title || !brief) { c.hold("projects", "malformed", title || quote); continue; }
      const segIds = anchorOnly(c, "projects", quote, [title, brief], title);
      if (segIds) c.kit.projects.push({ title, brief, quote, segIds } satisfies ProjectIdea);
    }
  },
};

export interface GenerateOpts {
  model: string;
  /** Called after each section has been generated and validated. */
  onSection?: (id: SectionId, kit: Kit, ms: number) => void;
  sections?: SectionSpec[];
}

export async function generateKit(src: Source, llm: Llm, opts: GenerateOpts): Promise<Kit> {
  const kit = emptyKit(opts.model);
  const ctx = new Ctx(kit, src);
  for (const spec of opts.sections ?? SECTIONS) {
    const t0 = Date.now();
    try {
      const raw = (await llm({ system: SYSTEM, user: spec.user(src), schema: spec.schema })) as Raw;
      validators[spec.id](ctx, raw ?? {});
    } catch (e) {
      (kit.errors ??= {})[spec.id] = e instanceof Error ? e.message : String(e);
    }
    opts.onSection?.(spec.id, structuredClone(kit), Date.now() - t0);
  }
  return kit;
}

export function heldSummary(held: Held[]): Record<HoldReason, number> {
  const out = { "quote-not-found": 0, "unsupported-claim": 0, "invented-number": 0, malformed: 0, "dangling-edge": 0, duplicate: 0 };
  for (const h of held) out[h.reason]++;
  return out;
}
