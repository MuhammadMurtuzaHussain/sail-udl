/**
 * Measured eval on the two bundled samples with the real local model.
 *   npm run eval            -> N live runs per sample (default 3), saves raw model output + results
 *   npm run eval -- --replay -> re-validates the saved raw output with the current validators (no model)
 * Run 0 of each sample is also written to samples/<name>.kit.json (the bundled demo kit).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gradeExplainBack, lexicalGrade } from "../src/core/grade";
import { checkClaim, findQuote } from "../src/core/ground";
import { generateKit, heldSummary } from "../src/core/kit";
import { DEFAULT_MODEL, ollamaLlm, ollamaStatus } from "../src/core/ollama";
import { parseSource } from "../src/core/segment";
import type { Kit, Llm, SectionId } from "../src/core/types";

const RUNS = Number(process.env.RUNS ?? 3);
const replay = process.argv.includes("--replay");
const NAMES = ["lecture", "notes"] as const;
const SECTIONS: SectionId[] = ["points", "map", "quiz", "examples", "audio", "projects"];
type Raw = { user: string; out: unknown }[];

const sources = Object.fromEntries(NAMES.map((n) => [n, parseSource(readFileSync(`samples/${n}.txt`, "utf8"))]));

function recording(live: Llm, log: Raw): Llm {
  return async (req) => {
    const out = await live(req);
    log.push({ user: req.user, out });
    return out;
  };
}
function replaying(log: Raw): Llm {
  const q = [...log];
  return async (req) => {
    const i = q.findIndex((x) => x.user === req.user);
    if (i < 0) throw new Error("no recorded response");
    return q.splice(i, 1)[0].out;
  };
}

const kitsByName: Record<string, Kit[]> = {};
const timings: Record<string, number[]> = {};
if (!replay) {
  const st = await ollamaStatus();
  if (!st.up || !st.hasModel) throw new Error(`Need Ollama running with ${DEFAULT_MODEL}`);
}
for (const name of NAMES) {
  kitsByName[name] = [];
  timings[name] = [];
  for (let r = 0; r < RUNS; r++) {
    const file = `eval/runs/${name}-${r}.json`;
    let log: Raw = [];
    let llm: Llm;
    if (replay) { log = JSON.parse(readFileSync(file, "utf8")).raw; llm = replaying(log); }
    else llm = recording(ollamaLlm(), log);
    const t0 = Date.now();
    const kit = await generateKit(sources[name], llm, { model: DEFAULT_MODEL });
    const ms = replay ? JSON.parse(readFileSync(file, "utf8")).ms : Date.now() - t0;
    kitsByName[name].push(kit);
    timings[name].push(ms);
    if (!replay) {
      writeFileSync(file, JSON.stringify({ model: DEFAULT_MODEL, ms, raw: log }));
      if (r === 0) writeFileSync(`samples/${name}.kit.json`, JSON.stringify(kit, null, 2) + "\n");
    }
    console.log(name, r, `${Math.round(ms / 1000)}s`, JSON.stringify(heldSummary(kit.held)));
  }
}

// 1. Model output vs validators
const totals = { proposed: 0, kept: 0, held: 0, quoteMissing: 0 };
const bySection: Record<string, { proposed: number; kept: number }> = Object.fromEntries(SECTIONS.map((s) => [s, { proposed: 0, kept: 0 }]));
const reasons: Record<string, number> = {};
const kept = (k: Kit): Record<SectionId, number> => ({
  points: k.points.length, map: k.map.nodes.length + k.map.edges.length, quiz: k.quiz.length,
  examples: k.examples.length, audio: k.audio.length, projects: k.projects.length,
});
for (const ks of Object.values(kitsByName)) for (const k of ks) {
  const kc = kept(k);
  for (const s of SECTIONS) { bySection[s].proposed += k.proposed[s]; bySection[s].kept += kc[s]; }
  for (const h of k.held) { reasons[h.reason] = (reasons[h.reason] ?? 0) + 1; }
}
for (const s of SECTIONS) { totals.proposed += bySection[s].proposed; totals.kept += bySection[s].kept; }
totals.held = totals.proposed - totals.kept;
totals.quoteMissing = reasons["quote-not-found"] ?? 0;

// 2. Adversarial corruption of KEPT items: the validator must reject every corrupted claim.
const adv: Record<string, { n: number; rejected: number }> = {
  "quote swapped for a real quote from the other sample": { n: 0, rejected: 0 },
  "one word in the quote changed": { n: 0, rejected: 0 },
  "invented number added to the claim": { n: 0, rejected: 0 },
  "claim replaced by an unrelated claim from the other sample": { n: 0, rejected: 0 },
};
const keys = Object.keys(adv);
for (const name of NAMES) {
  const other = NAMES.find((n) => n !== name)!;
  const otherPoints = kitsByName[other][0].points;
  for (const k of kitsByName[name]) {
    const src = sources[name];
    k.points.forEach((p, i) => {
      const alien = otherPoints[i % Math.max(otherPoints.length, 1)];
      if (!alien) return;
      const words = p.quote.split(" ");
      const mid = Math.floor(words.length / 2);
      const mutated = [...words.slice(0, mid), words[mid] + "zz", ...words.slice(mid + 1)].join(" ");
      const trials: [string, boolean][] = [
        [keys[0], !checkClaim(src, p.text, alien.quote).ok],
        [keys[1], !checkClaim(src, p.text, mutated).ok],
        [keys[2], !checkClaim(src, p.text + " This happens in 47 percent of cases.", p.quote).ok],
        [keys[3], !checkClaim(src, alien.text, p.quote).ok],
      ];
      for (const [k2, rej] of trials) { adv[k2].n++; adv[k2].rejected += rej ? 1 : 0; }
    });
  }
}

// 3. Explain-back sanity on the lecture kit: three hand-written learner answers.
const lecKit = kitsByName.lecture[0];
const answers = {
  "full answer": "Rereading feels productive but isn't. Better techniques: retrieval practice means closing the book and recalling what you studied. Spaced practice means short sessions over several days instead of cramming. Interleaving means mixing different problem types in one session so you learn to choose the method. Elaboration means explaining ideas in your own words and connecting them to what you know. All of them feel harder but that difficulty is useful for memory.",
  "half answer": "You should test yourself by closing the book and recalling things, and spread your study over several days instead of cramming.",
  "off-topic answer": "The lecture was about assignment deadlines and the weather in Cork, and I thought the portal was slow on Friday.",
};
const grading: Record<string, { gemma: number | null; lexical: number; rejected: number | null }> = {};
for (const [label, a] of Object.entries(answers)) {
  const lex = lexicalGrade(lecKit.points, a).coverage;
  let g: { coverage: number; rejected: number } | null = null;
  if (!replay) g = await gradeExplainBack(lecKit.points, a, ollamaLlm());
  grading[label] = { gemma: g ? g.coverage : null, lexical: lex, rejected: g ? g.rejected : null };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const results = {
  model: DEFAULT_MODEL,
  runsPerSample: RUNS,
  generatedAt: new Date().toISOString(),
  secondsPerKit: Object.fromEntries(NAMES.map((n) => [n, Math.round(mean(timings[n]) / 1000)])),
  modelItems: { ...totals, keepRate: +(totals.kept / totals.proposed).toFixed(3), reasons },
  bySection,
  validatorAdversarial: adv,
  explainBackSanity: { keyIdeasInKit: lecKit.points.length, ...grading },
};
if (!replay || !existsSync("eval/results.json")) writeFileSync("eval/results.json", JSON.stringify(results, null, 2) + "\n");
else writeFileSync("eval/results.replay.json", JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
