import { useEffect, useMemo, useRef, useState } from "react";
import type { CatchUp } from "../core/catchup";
import type { Grade } from "../core/grade";
import { streak, udlCoverage, type Progress } from "../core/progress";
import type { Grounded, Kit, Source } from "../core/types";

export interface Env {
  src: Source;
  kit: Kit;
  live: boolean;
  cite: (g: Grounded | null) => void;
  progress: Progress;
  setProgress: (p: Progress) => void;
  goto: (tab: string) => void;
  viewed: Set<string>;
  recordQuiz: (correct: boolean[]) => void;
}

export const Cite = ({ g, env, label = "source" }: { g: Grounded; env: Env; label?: string }) => (
  <button className="cite" title={`"${g.quote}"`} onClick={() => env.cite(g)}>
    {label} ↖
  </button>
);

const Quote = ({ g }: { g: Grounded }) => <blockquote className="q">“{g.quote}”</blockquote>;

export function Summary({ env }: { env: Env }) {
  const { points } = env.kit;
  if (!points.length) return <p className="muted">No key ideas survived validation.</p>;
  return (
    <div>
      <h2>Plain-language summary</h2>
      <p className="muted small">Each idea is tied to a quote in your material. Press “source” to see where.</p>
      {points.map((p) => (
        <div className="point" key={p.id}>
          <div style={{ flex: 1 }}>
            <div>{p.text}</div>
          </div>
          <Cite g={p} env={env} />
        </div>
      ))}
    </div>
  );
}

export function ConceptMap({ env }: { env: Env }) {
  const { nodes, edges } = env.kit.map;
  const [sel, setSel] = useState<string | null>(null);
  const W = 760, H = 460;
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    const order = [...nodes].sort((a, b) => a.segIds[0] - b.segIds[0]);
    order.forEach((n, i) => {
      const a = (i / Math.max(order.length, 1)) * Math.PI * 2 - Math.PI / 2;
      m.set(n.id, { x: W / 2 + Math.cos(a) * 285, y: H / 2 + Math.sin(a) * 175 });
    });
    return m;
  }, [nodes]);
  if (!nodes.length) return <p className="muted">No concept map nodes survived validation.</p>;
  const node = nodes.find((n) => n.id === sel);
  const edgeSel = edges.filter((e) => e.from === sel || e.to === sel);
  return (
    <div>
      <h2>Concept map</h2>
      <p className="muted small">Select a concept to see its supporting quote and highlight it in your material.</p>
      <svg className="map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Concept map of the material">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#7a97a8" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!;
          const on = sel && (e.from === sel || e.to === sel);
          return (
            <g key={i} opacity={sel && !on ? 0.2 : 1} onClick={() => env.cite(e)} style={{ cursor: "pointer" }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7a97a8" strokeWidth={on ? 2.5 : 1.4} markerEnd="url(#arr)" />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} fontSize="11" textAnchor="middle" fill="#7a97a8" style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 4 }}>
                {e.label}
              </text>
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const w = Math.max(90, n.label.length * 7.4 + 22);
          const on = sel === n.id;
          return (
            <g key={n.id} tabIndex={0} role="button" aria-label={n.label}
               onClick={() => { setSel(n.id); env.cite(n); }}
               onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (setSel(n.id), env.cite(n))}
               style={{ cursor: "pointer" }} opacity={sel && !on && !edgeSel.some((e) => e.from === n.id || e.to === n.id) ? 0.35 : 1}>
              <rect x={p.x - w / 2} y={p.y - 17} width={w} height={34} rx={17} fill={on ? "#1f8a8a" : "var(--panel)"} stroke="#1f8a8a" strokeWidth="2" />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13" fontWeight="600" style={{ fill: on ? "#fff" : "var(--ink)" }}>{n.label}</text>
            </g>
          );
        })}
      </svg>
      {node && <Quote g={node} />}
    </div>
  );
}

function useSpeech() {
  const [idx, setIdx] = useState(-1);
  const stop = () => { window.speechSynthesis?.cancel(); setIdx(-1); };
  useEffect(() => stop, []);
  return { idx, setIdx, stop };
}

export function Audio({ env }: { env: Env }) {
  const { audio } = env.kit;
  const { idx, setIdx, stop } = useSpeech();
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const play = () => {
    stop();
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    audio.forEach((l, i) => {
      const u = new SpeechSynthesisUtterance(l.text);
      u.voice = voices[l.speaker === "Ben" ? 1 % Math.max(voices.length, 1) : 0] ?? null;
      u.pitch = l.speaker === "Ben" ? 0.85 : 1.1;
      u.onstart = () => setIdx(i);
      if (i === audio.length - 1) u.onend = () => setIdx(-1);
      window.speechSynthesis.speak(u);
    });
  };
  if (!audio.length) return <p className="muted">No audio script lines survived validation.</p>;
  return (
    <div>
      <h2>Audio-style script</h2>
      <p className="muted small">Two voices walk through the material. Played with your browser's built-in speech, nothing leaves your machine.</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn sea" onClick={play} disabled={!supported}>▶ Play</button>
        <button className="btn ghost" onClick={stop}>■ Stop</button>
        {!supported && <span className="muted small">Speech synthesis not available in this browser; read along instead.</span>}
      </div>
      {audio.map((l, i) => (
        <div key={i} className={`audio-line ${idx === i ? "on" : ""}`}>
          <b>{l.speaker}:</b> {l.text} <Cite g={l} env={env} label="↖" />
        </div>
      ))}
    </div>
  );
}

export function Examples({ env }: { env: Env }) {
  const { examples } = env.kit;
  if (!examples.length) return <p className="muted">No worked examples survived validation.</p>;
  return (
    <div>
      <h2>Worked examples</h2>
      <p className="notice">Illustrations. Code checks that the idea they build on is quoted from your material and that no new numbers were introduced; the scenarios themselves are the model's.</p>
      {examples.map((x, i) => (
        <div className="card" key={i} style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>{x.title}</h3>
            <Cite g={x} env={env} label="idea in source" />
          </div>
          <p>{x.scenario}</p>
          <ol>{x.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
        </div>
      ))}
    </div>
  );
}

export function CatchUpPanel({ env, range, run, result, busy, err }: {
  env: Env; range: [number, number] | null; run: () => void; result: CatchUp | null; busy: boolean; err: string;
}) {
  return (
    <div>
      <h2>Catch me up</h2>
      <p className="muted">Zoned out or lost your connection? In the material on the left, click the first line you missed, then shift-click the last. SAIL summarises only that part.</p>
      <div className="row">
        <button className="btn sea" disabled={!range || busy} onClick={run}>
          {busy ? <><span className="spin" />Catching up…</> : range ? `Catch me up on lines ${range[0] + 1}–${range[1] + 1}` : "Pick the missed lines first"}
        </button>
      </div>
      {err && <div className="err">{err}</div>}
      {result && (
        <div style={{ marginTop: 12 }}>
          <p className="small muted">
            {result.method === "gemma+code"
              ? `Written by Gemma, every point quoted from inside the lines you picked (${result.held} held).`
              : "Extractive: the most central sentences from your range, verbatim. Start Ollama for a written summary."}
          </p>
          {result.items.length === 0 && <p>Nothing in that range could be verified. Try a longer range.</p>}
          {result.items.map((it, i) => (
            <div className="point" key={i}>
              <div style={{ flex: 1 }}>{it.point}</div>
              <Cite g={it} env={env} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Quiz({ env }: { env: Env }) {
  const { quiz } = env.kit;
  const [picked, setPicked] = useState<(number | null)[]>(() => quiz.map(() => null));
  const done = picked.every((p) => p !== null);
  const recorded = useRef(false);
  useEffect(() => {
    if (done && quiz.length && !recorded.current) {
      recorded.current = true;
      env.recordQuiz(quiz.map((q, i) => picked[i] === q.answer));
    }
  }, [done]); // eslint-disable-line
  if (!quiz.length) return <p className="muted">No quiz questions survived validation.</p>;
  const score = picked.filter((p, i) => p === quiz[i].answer).length;
  return (
    <div>
      <h2>Quiz</h2>
      <p className="muted small">Every question is backed by a quote; the correct answer must be better supported by it than any wrong option.</p>
      {quiz.map((q, i) => (
        <div className="card" key={i} style={{ marginBottom: 12 }}>
          <h3>{i + 1}. {q.question}</h3>
          {q.options.map((o, j) => {
            const shown = picked[i] !== null;
            const cls = shown ? (j === q.answer ? "right" : j === picked[i] ? "wrong" : "") : "";
            return (
              <button key={j} className={`opt ${cls}`} disabled={shown} onClick={() => setPicked(picked.map((p, k) => (k === i ? j : p)))}>
                {o}
              </button>
            );
          })}
          {picked[i] !== null && (
            <div>
              <p>{picked[i] === q.answer ? "✔ " : "✘ "}{q.explanation} <Cite g={q} env={env} /></p>
              <Quote g={q} />
            </div>
          )}
        </div>
      ))}
      {done && <p><b>Score: {score} / {quiz.length}</b></p>}
      <button className="btn ghost" onClick={() => { setPicked(quiz.map(() => null)); recorded.current = false; }}>Try again</button>
    </div>
  );
}

export function ExplainBack({ env, grade, run, busy, err }: {
  env: Env; grade: Grade | null; run: (a: string) => void; busy: boolean; err: string;
}) {
  const [text, setText] = useState("");
  const pts = env.kit.points;
  return (
    <div>
      <h2>Explain it back</h2>
      <p className="muted">Close the other tabs, then explain the material in your own words, as if teaching a friend. SAIL checks which key ideas you covered.</p>
      <textarea className="paste" style={{ minHeight: 140 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Your explanation" placeholder="In my own words…" />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sea" disabled={busy || text.trim().split(/\s+/).length < 5 || !pts.length} onClick={() => run(text)}>
          {busy ? <><span className="spin" />Checking…</> : env.live ? "Check with Gemma" : "Check (offline matching)"}
        </button>
      </div>
      {err && <div className="err">{err}</div>}
      {grade && (
        <div style={{ marginTop: 14 }}>
          <div className="bar" aria-label="coverage"><i style={{ width: `${grade.coverage * 100}%` }} /></div>
          <p><b>{grade.covered.length} of {pts.length} key ideas covered.</b>{" "}
            <span className="muted small">
              {grade.method === "gemma+code"
                ? `Judged by Gemma; code rejected ${grade.rejected} claim${grade.rejected === 1 ? "" : "s"} it could not find in your text.`
                : "Judged by word overlap (no model). Paraphrases may be under-counted."}
            </span>
          </p>
          {pts.map((p) => {
            const c = grade.covered.find((x) => x.id === p.id);
            return (
              <div className="point" key={p.id}>
                <span>{c ? "✔" : "○"}</span>
                <div style={{ flex: 1 }}>
                  {p.text}
                  {c?.evidence && <blockquote className="q">You wrote: “{c.evidence}”</blockquote>}
                  {!c && <blockquote className="q">From your material: “{p.quote}”</blockquote>}
                </div>
                {!c && <Cite g={p} env={env} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Projects({ env }: { env: Env }) {
  const { projects } = env.kit;
  if (!projects.length) return <p className="muted">No project prompts survived validation.</p>;
  return (
    <div>
      <h2>Show it your way</h2>
      <p className="muted">Pick one way to show what you know. Not everyone demonstrates learning with a quiz.</p>
      <div className="grid2">
        {projects.map((p) => {
          const on = env.progress.projectPicked === p.title;
          return (
            <button key={p.title} className="mode" aria-pressed={on} onClick={() => env.setProgress({ ...env.progress, projectPicked: p.title })}>
              <h3>{p.title}</h3>
              <div>{p.brief}</div>
              <div className="small muted" style={{ marginTop: 6 }}>{on ? "Chosen ✔" : "Choose this"}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const MODES = [
  { id: "quickwin", name: "Quick win", blurb: "A two-minute round and you are done." },
  { id: "curiosity", name: "Curiosity", blurb: "A question to chase, then check the source." },
  { id: "teach", name: "Teach it", blurb: "Explain it aloud like you are the lecturer." },
  { id: "streak", name: "Streak", blurb: "Keep a daily run going, however small." },
] as const;

export function ProgressPanel({ env }: { env: Env }) {
  const p = env.progress;
  const u = udlCoverage(p, env.viewed);
  const edge = env.kit.map.edges[0];
  const label = (id: string) => env.kit.map.nodes.find((n) => n.id === id)?.label ?? id;
  const s = streak(p);
  return (
    <div>
      <h2>Progress & motivation</h2>
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="card"><h3>Quiz</h3>{p.quiz.attempts ? `Best ${p.quiz.best}/${p.quiz.total} in ${p.quiz.attempts} attempt${p.quiz.attempts > 1 ? "s" : ""}` : "Not tried yet"}
          <div className="bar"><i style={{ width: `${p.quiz.total ? (p.quiz.best / p.quiz.total) * 100 : 0}%` }} /></div></div>
        <div className="card"><h3>Explain-back</h3>{p.explain.attempts ? `Best ${Math.round(p.explain.best * 100)}% of key ideas, ${p.explain.attempts} attempt${p.explain.attempts > 1 ? "s" : ""}` : "Not tried yet"}
          <div className="bar"><i style={{ width: `${p.explain.best * 100}%` }} /></div></div>
        <div className="card"><h3>Streak</h3>{s} day{s === 1 ? "" : "s"}<div className="small muted">{p.days.length} active day{p.days.length === 1 ? "" : "s"} on this material</div></div>
      </div>
      <p className="small muted">
        Ways you have used so far: {u.representation} of 5 ways to take in the material, {u.expression} of 3 ways to show it. More than one is the point of UDL.
        Progress is stored only in this browser.
      </p>
      <h3>What keeps you going?</h3>
      <div className="grid2">
        {MODES.map((m) => (
          <button key={m.id} className="mode" aria-pressed={p.motivation === m.id} onClick={() => env.setProgress({ ...p, motivation: m.id })}>
            <b>{m.name}</b><div className="small muted">{m.blurb}</div>
          </button>
        ))}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        {p.motivation === "quickwin" && <><b>Your two-minute round:</b> answer the first three quiz questions. <button className="btn ghost" onClick={() => env.goto("quiz")}>Start</button></>}
        {p.motivation === "curiosity" && (edge
          ? <><b>Chase this:</b> in one sentence, why does “{label(edge.from)}” {edge.label} “{label(edge.to)}”? Then check <Cite g={edge} env={env} />.</>
          : <>No map connections survived validation to build a question from.</>)}
        {p.motivation === "teach" && <><b>Teach it:</b> explain the topic to an imaginary friend, aloud, and see how many ideas you hit. <button className="btn ghost" onClick={() => env.goto("explain")}>Open explain-back</button></>}
        {p.motivation === "streak" && <><b>Streak mode:</b> any quiz round or explain-back today keeps your run at {Math.max(s, 1)}+ day{s > 1 ? "s" : ""}.</>}
      </div>
    </div>
  );
}
