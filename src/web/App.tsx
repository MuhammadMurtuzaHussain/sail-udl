import { useCallback, useEffect, useMemo, useState } from "react";
import { extractiveCatchUp, type CatchUp } from "../core/catchup";
import { lexicalGrade, type Grade } from "../core/grade";
import { emptyProgress, recordExplain, recordQuiz, touch, type Progress } from "../core/progress";
import { MAX_SOURCE_CHARS, parseSource } from "../core/segment";
import type { Grounded, Held, Kit, SectionId } from "../core/types";
import lectureText from "../../samples/lecture.txt?raw";
import notesText from "../../samples/notes.txt?raw";
import lectureKit from "../../samples/lecture.kit.json";
import notesKit from "../../samples/notes.kit.json";
import { Audio, CatchUpPanel, ConceptMap, ExplainBack, Examples, Projects, ProgressPanel, Quiz, Summary, type Env } from "./panels";

const SAMPLES = [
  { id: "lecture", name: "Sample: lecture transcript", text: lectureText, kit: lectureKit as unknown as Kit },
  { id: "notes", name: "Sample: HTTP caching notes", text: notesText, kit: notesKit as unknown as Kit },
];

const TABS: { id: string; label: string; group: string; count?: (k: Kit) => number }[] = [
  { id: "summary", label: "Summary", group: "Take it in", count: (k) => k.points.length },
  { id: "map", label: "Concept map", group: "Take it in", count: (k) => k.map.nodes.length },
  { id: "audio", label: "Audio script", group: "Take it in", count: (k) => k.audio.length },
  { id: "examples", label: "Worked examples", group: "Take it in", count: (k) => k.examples.length },
  { id: "catchup", label: "Catch me up", group: "Take it in" },
  { id: "quiz", label: "Quiz", group: "Show what you know", count: (k) => k.quiz.length },
  { id: "explain", label: "Explain it back", group: "Show what you know" },
  { id: "project", label: "Project", group: "Show what you know", count: (k) => k.projects.length },
  { id: "progress", label: "Progress", group: "Keep going" },
];

const SECTION_ORDER: SectionId[] = ["points", "map", "quiz", "examples", "audio", "projects"];

function hash(s: string) {
  let h = 5381;
  for (const c of s) h = (h * 33) ^ c.charCodeAt(0);
  return (h >>> 0).toString(36);
}
const load = (k: string): Progress => {
  try { return { ...emptyProgress(), ...JSON.parse(localStorage.getItem(k) ?? "{}") }; } catch { return emptyProgress(); }
};

export function App() {
  const [text, setText] = useState(SAMPLES[0].text);
  const [sampleId, setSampleId] = useState<string | null>("lecture");
  const [kit, setKit] = useState<Kit | null>(SAMPLES[0].kit);
  const [status, setStatus] = useState<{ up: boolean; hasModel: boolean; model: string } | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [done, setDone] = useState<SectionId[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(() => (TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : "summary"));
  const [cited, setCited] = useState<Grounded | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [catchUpRes, setCatchUpRes] = useState<CatchUp | null>(null);
  const [catchBusy, setCatchBusy] = useState(false);
  const [catchErr, setCatchErr] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [gradeErr, setGradeErr] = useState("");
  const [viewed, setViewed] = useState<Set<string>>(new Set(["summary"]));
  const key = "sail:" + hash(text);
  const [progress, setProgressRaw] = useState<Progress>(() => load(key));

  const src = useMemo(() => parseSource(text), [text]);
  const live = !!status?.up && status.hasModel;
  const isSample = sampleId !== null;

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => setProgressRaw(load(key)), [key]);
  useEffect(() => { setViewed((v) => new Set(v).add(tab)); }, [tab]);

  const setProgress = useCallback((p: Progress) => {
    const t = touch(p);
    setProgressRaw(t);
    try { localStorage.setItem(key, JSON.stringify(t)); } catch { /* storage unavailable */ }
  }, [key]);

  function resetKitState() {
    setCited(null); setRange(null); setAnchor(null); setCatchUpRes(null); setGrade(null); setError("");
  }

  function pickSample(id: string) {
    const s = SAMPLES.find((x) => x.id === id)!;
    setText(s.text); setSampleId(id); setKit(s.kit); setDone([]); resetKitState();
  }

  async function generate() {
    setError(""); resetKitState(); setDone([]); setSampleId(null);
    setBusy("Reading your material…");
    setKit(null);
    try {
      const res = await fetch("/api/kit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Server said ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.type === "section") {
            setKit(m.kit); setDone((x) => [...x, m.id]);
            const next = SECTION_ORDER[SECTION_ORDER.indexOf(m.id) + 1];
            setBusy(next ? `Gemma is writing: ${next}…` : "Finishing…");
          } else if (m.type === "error") throw new Error(m.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function runCatchUp() {
    if (!range) return;
    setCatchBusy(true); setCatchErr(""); setCatchUpRes(null);
    try {
      if (live) {
        const r = await fetch("/api/catchup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, range }) });
        if (!r.ok) throw new Error((await r.json()).error);
        setCatchUpRes(await r.json());
      } else setCatchUpRes(extractiveCatchUp(src, range));
      setProgress({ ...progress, catchUps: progress.catchUps + 1 });
    } catch (e) {
      setCatchErr(`Model unavailable (${e instanceof Error ? e.message : e}); showing the extractive version.`);
      setCatchUpRes(extractiveCatchUp(src, range));
    } finally { setCatchBusy(false); }
  }

  async function runGrade(answer: string) {
    if (!kit) return;
    setGradeBusy(true); setGradeErr(""); setGrade(null);
    let g: Grade;
    try {
      if (!live) throw new Error("offline");
      const r = await fetch("/api/grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ points: kit.points, answer }) });
      if (!r.ok) throw new Error((await r.json()).error);
      g = await r.json();
    } catch (e) {
      if (live) setGradeErr(`Model unavailable (${e instanceof Error ? e.message : e}); used offline word matching instead.`);
      g = lexicalGrade(kit.points, answer);
    }
    setGrade(g);
    setProgress(recordExplain(progress, g.coverage));
    setGradeBusy(false);
  }

  function onSeg(i: number, shift: boolean) {
    setCited(null);
    if (shift && anchor !== null) {
      setRange([Math.min(anchor, i), Math.max(anchor, i)]);
      setTab("catchup");
    } else { setAnchor(i); setRange([i, i]); }
  }

  const citedSet = new Set(cited?.segIds ?? []);
  const env: Env | null = kit && {
    src, kit, live, cite: (g) => { setCited(g); if (g) document.getElementById(`seg-${g.segIds[0]}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); },
    progress, setProgress, goto: setTab, viewed,
    recordQuiz: (c) => setProgress(recordQuiz(progress, c)),
  };

  const tooLong = text.length > MAX_SOURCE_CHARS;
  const tooShort = text.trim().split(/\s+/).length < 30;
  const canLive = live && !tooLong && !tooShort;
  const generating = !!busy;

  return (
    <>
      <header className="top">
        <h1>⚓ SAIL</h1>
        <span className="tag">Supported AI Learning: one set of material, many ways in, many ways to show what you know.</span>
        {status === null && <span className="chip demo">Demo mode · no local server</span>}
        {status && !live && <span className="chip demo">Demo mode · {status.up ? `ollama pull ${status.model}` : "Ollama not running"}</span>}
        {live && <span className="chip live">● {status!.model} via Ollama · local</span>}
      </header>
      <main>
        <section className="card" aria-label="Your material">
          <h2>Your material</h2>
          <div className="row" style={{ marginBottom: 10 }}>
            <label className="small muted" htmlFor="smp">Load</label>
            <select id="smp" value={sampleId ?? ""} onChange={(e) => e.target.value && pickSample(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
              <option value="">Your own text</option>
              {SAMPLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {kit && isSample || (kit && !generating && !error && done.length === SECTION_ORDER.length) ? (
            <>
              <div className="source" aria-label="Material split into citable lines">
                {src.segments.map((s) => (
                  <button key={s.id} id={`seg-${s.id}`}
                    className={`seg ${citedSet.has(s.id) ? "cited" : ""} ${range && s.id >= range[0] && s.id <= range[1] && !cited ? "missed" : ""} ${anchor === s.id ? "anchor" : ""}`}
                    onClick={(e) => onSeg(s.id, e.shiftKey)} title="Click to start a missed range; shift-click to end it">
                    {s.speaker && <span className="who">{s.speaker}</span>}
                    {s.time && <span className="t">{s.time}</span>}
                    {s.text}
                  </button>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn ghost" onClick={() => { setSampleId(null); setKit(null); setDone([]); resetKitState(); }}>Edit / paste new</button>
                {range && <button className="btn ghost" onClick={() => { setRange(null); setAnchor(null); }}>Clear missed range</button>}
              </div>
              <p className="small muted">Highlighted lines are the evidence for whatever you last clicked “source” on.</p>
            </>
          ) : (
            <>
              <textarea className="paste" value={text} onChange={(e) => { setText(e.target.value); setSampleId(null); }} aria-label="Paste notes or a transcript" placeholder="Paste lecture notes, or a lecture/meeting transcript (lines like “[00:12] Dr. Lee: …” work well)." disabled={generating} />
              <p className="small muted">{text.length.toLocaleString()} / {MAX_SOURCE_CHARS.toLocaleString()} characters · stays on this machine</p>
              {tooLong && <div className="err">Too long for this MVP. Trim to {MAX_SOURCE_CHARS.toLocaleString()} characters.</div>}
              {!live && <div className="notice">Generating a new kit needs local Ollama with <code>gemma4:e4b</code>. Until then, try the bundled samples above.</div>}
              <button className="btn" disabled={!canLive || generating} onClick={generate}>
                {generating ? <><span className="spin" />{busy}</> : "Build my study kit"}
              </button>
              {error && <div className="err">{error}</div>}
            </>
          )}
        </section>

        <section className="card" aria-label="Study kit">
          {!env ? (
            <div>
              <h2>Your study kit</h2>
              <p className="muted">Paste material and build a kit. You will get it in several formats (summary, concept map, audio script, examples), several ways to show what you learned (quiz, explain-back, project), and a progress tracker.</p>
              {generating && <p><span className="spin" />{busy}</p>}
            </div>
          ) : (
            <>
              {isSample && (
                <div className="notice">Bundled sample. This kit was precomputed with <b>{kit!.model}</b> through the same pipeline and validators, so it works without a model.</div>
              )}
              {generating && <div className="notice"><span className="spin" />{busy} (sections appear as they pass validation)</div>}
              <div className="tabs" role="tablist">
                {["Take it in", "Show what you know", "Keep going"].map((g) => (
                  <div key={g} style={{ display: "contents" }}>
                    <span className="group">{g}</span>
                    {TABS.filter((t) => t.group === g).map((t) => (
                      <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
                        {t.label}{t.count && <span className="n">{t.count(kit!)}</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              {tab === "summary" && <Summary env={env} />}
              {tab === "map" && <ConceptMap env={env} />}
              {tab === "audio" && <Audio env={env} />}
              {tab === "examples" && <Examples env={env} />}
              {tab === "catchup" && <CatchUpPanel env={env} range={range} run={runCatchUp} result={catchUpRes} busy={catchBusy} err={catchErr} />}
              {tab === "quiz" && <Quiz key={kit!.quiz.map((q) => q.question).join("|")} env={env} />}
              {tab === "explain" && <ExplainBack env={env} grade={grade} run={runGrade} busy={gradeBusy} err={gradeErr} />}
              {tab === "project" && <Projects env={env} />}
              {tab === "progress" && <ProgressPanel env={env} />}
              <HeldPanel held={kit!.held} proposed={kit!.proposed} errors={kit!.errors} />
            </>
          )}
        </section>
      </main>
    </>
  );
}

function HeldPanel({ held, proposed, errors }: { held: Held[]; proposed: Kit["proposed"]; errors?: Kit["errors"] }) {
  const total = Object.values(proposed).reduce((a, b) => a + b, 0);
  return (
    <details className="held">
      <summary>Held by code: {held.length} of {total} model items were dropped</summary>
      <p className="small muted">Gemma proposes, code checks that each quote exists in your material, that wording is backed by it and that no numbers were invented. Anything that fails is held, never shown as fact.</p>
      {errors && Object.entries(errors).map(([k, v]) => <div className="err" key={k}>{k}: {v}</div>)}
      <ul>{held.map((h, i) => <li key={i}><span className="reason">{h.reason}</span><b>{h.section}</b> · {h.item}</li>)}</ul>
      {!held.length && <p className="small">Nothing held in this kit.</p>}
    </details>
  );
}
