/** Small learning-progress tracker. Pure functions over a plain object so it can live in localStorage. */
export interface Progress {
  quiz: { attempts: number; best: number; total: number; lastCorrect: boolean[] };
  explain: { attempts: number; best: number; history: number[] };
  catchUps: number;
  projectPicked: string | null;
  motivation: "quickwin" | "curiosity" | "teach" | "streak";
  days: string[]; // ISO dates with any activity
}

export const emptyProgress = (): Progress => ({
  quiz: { attempts: 0, best: 0, total: 0, lastCorrect: [] },
  explain: { attempts: 0, best: 0, history: [] },
  catchUps: 0,
  projectPicked: null,
  motivation: "quickwin",
  days: [],
});

const today = (d = new Date()) => d.toISOString().slice(0, 10);

export function touch(p: Progress, d = new Date()): Progress {
  const t = today(d);
  return p.days.includes(t) ? p : { ...p, days: [...p.days, t].sort() };
}

export function recordQuiz(p: Progress, correct: boolean[], d = new Date()): Progress {
  const score = correct.filter(Boolean).length;
  return touch(
    { ...p, quiz: { attempts: p.quiz.attempts + 1, best: Math.max(p.quiz.best, score), total: correct.length, lastCorrect: correct } },
    d,
  );
}

export function recordExplain(p: Progress, coverage: number, d = new Date()): Progress {
  return touch(
    { ...p, explain: { attempts: p.explain.attempts + 1, best: Math.max(p.explain.best, coverage), history: [...p.explain.history, coverage].slice(-10) } },
    d,
  );
}

/** Consecutive active days ending today or yesterday. */
export function streak(p: Progress, d = new Date()): number {
  const set = new Set(p.days);
  let n = 0;
  const cur = new Date(d);
  if (!set.has(today(cur))) cur.setDate(cur.getDate() - 1);
  while (set.has(today(cur))) {
    n++;
    cur.setDate(cur.getDate() - 1);
  }
  return n;
}

/** Which UDL "means" the learner has used so far: representation, expression, engagement. */
export function udlCoverage(p: Progress, viewed: Set<string>) {
  return {
    representation: ["summary", "map", "audio", "examples", "catchup"].filter((k) => viewed.has(k) || (k === "catchup" && p.catchUps > 0)).length,
    expression: [p.quiz.attempts > 0, p.explain.attempts > 0, p.projectPicked !== null].filter(Boolean).length,
    engagement: p.days.length > 0 ? 1 : 0,
  };
}
