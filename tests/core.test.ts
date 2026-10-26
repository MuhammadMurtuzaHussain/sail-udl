import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catchUp, extractiveCatchUp } from "../src/core/catchup";
import { gradeExplainBack, lexicalGrade } from "../src/core/grade";
import { checkClaim, findQuote } from "../src/core/ground";
import { generateKit } from "../src/core/kit";
import { emptyProgress, recordExplain, recordQuiz, streak } from "../src/core/progress";
import { parseSource } from "../src/core/segment";
import type { Llm, Point } from "../src/core/types";

const lecture = parseSource(readFileSync("samples/lecture.txt", "utf8"));
const notes = parseSource(readFileSync("samples/notes.txt", "utf8"));

describe("segmenting", () => {
  it("parses transcripts into speaker/time segments", () => {
    expect(lecture.kind).toBe("transcript");
    const s = lecture.segments[0];
    expect(s.speaker).toBe("Dr. Okafor");
    expect(s.time).toBe("00:00");
    expect(s.text.startsWith("Welcome back")).toBe(true);
    expect(lecture.segments.some((x) => x.speaker === "Priya")).toBe(true);
  });
  it("parses bullet notes and strips markers", () => {
    expect(notes.kind).toBe("notes");
    expect(notes.segments.every((s) => !/^[-*•]/.test(s.text))).toBe(true);
    expect(notes.segments.length).toBeGreaterThan(8);
  });
});

describe("quote-or-hold", () => {
  const q = "Retrieval practice means closing the book and trying to recall what you just studied";
  it("accepts a verbatim quote and reports its segment", () => {
    const ids = findQuote(lecture, q)!;
    expect(ids.length).toBe(1);
    expect(lecture.segments[ids[0]].text).toContain("Retrieval practice means");
  });
  it("ignores case and punctuation", () => {
    expect(findQuote(lecture, "RETRIEVAL practice means closing the book, and trying to recall what you just studied!")).not.toBeNull();
  });
  it("accepts ellipsis between real fragments", () => {
    expect(findQuote(lecture, "Retrieval practice means closing the book ... shows you exactly what to revisit")).not.toBeNull();
  });
  it("rejects altered, invented and too-short quotes", () => {
    expect(findQuote(lecture, "Retrieval practice means opening the book and trying to recall what you just studied")).toBeNull();
    expect(findQuote(lecture, "Spaced repetition was invented in 1885 by Hermann Ebbinghaus")).toBeNull();
    expect(findQuote(lecture, "Retrieval practice")).toBeNull();
  });
  it("does not match inside a word", () => {
    expect(findQuote(lecture, "ing practice means closing the")).toBeNull();
  });
  it("respects a range restriction", () => {
    const ids = findQuote(lecture, q)!;
    expect(findQuote(lecture, q, new Set(ids))).not.toBeNull();
    expect(findQuote(lecture, q, new Set([0]))).toBeNull();
  });
  it("holds invented numbers and unsupported claims", () => {
    expect(checkClaim(lecture, "Review on day one, day three and day nine.", "review on day one, again on day three, and again on day seven")).toMatchObject({ ok: true });
    expect(checkClaim(lecture, "Reviews happen on days 1, 3 and 9.", "review on day one, again on day three, and again on day seven")).toMatchObject({ ok: false, reason: "invented-number" });
    expect(checkClaim(lecture, "Photosynthesis converts sunlight into chemical energy in chloroplasts.", "review on day one, again on day three, and again on day seven")).toMatchObject({ ok: false, reason: "unsupported-claim" });
  });
});

const goodQuote = "Retrieval practice means closing the book and trying to recall what you just studied";
describe("kit generation", () => {
  it("keeps grounded items and holds the rest, with reasons", async () => {
    const calls: string[] = [];
    const l: Llm = async ({ user, schema }) => {
      const props = Object.keys((schema as { properties: object }).properties);
      calls.push(props[0]);
      if (props[0] === "items" && user.includes("most important ideas")) {
        return { items: [
          { quote: goodQuote, idea: "Retrieval practice means closing the book and trying to recall what you studied." },
          { quote: "Memory palaces were used by ancient Greek orators", idea: "Ancient orators used memory palaces." },
          { quote: goodQuote, idea: "Retrieval practice was proven in 2019 to double exam scores." },
          { quote: "", idea: "no quote" },
        ] };
      }
      if (user.includes("multiple-choice")) {
        return { items: [
          { quote: goodQuote, question: "What is retrieval practice?", correct: "Closing the book and trying to recall what you studied", wrong: ["Rereading notes", "Highlighting text", "Copying slides"], explanation: "It means recalling." },
          { quote: goodQuote, question: "Bad", correct: "Closing the book and trying to recall what you studied", wrong: ["Same", "Same", "Other"], explanation: "x" },
        ] };
      }
      if (user.includes("concept map")) {
        return {
          nodes: [
            { quote: goodQuote, label: "Retrieval practice" },
            { quote: "The second technique is spaced practice", label: "Spaced practice" },
            { quote: "invented sentence about nothing at all", label: "Ghost" },
          ],
          edges: [
            { quote: "The second technique is spaced practice", from: "Retrieval practice", to: "Spaced practice", relation: "comes before" },
            { quote: goodQuote, from: "Retrieval practice", to: "Ghost", relation: "needs" },
          ],
        };
      }
      return { items: [], lines: [], nodes: [], edges: [] };
    };
    const kit = await generateKit(lecture, l, { model: "fake" });
    expect(kit.points).toHaveLength(1);
    const reasons = kit.held.filter((h) => h.section === "points").map((h) => h.reason).sort();
    expect(reasons).toEqual(["invented-number", "malformed", "quote-not-found"]);
    expect(kit.quiz).toHaveLength(1);
    expect(kit.quiz[0].options).toHaveLength(4);
    expect(kit.quiz[0].options[kit.quiz[0].answer]).toBe("Closing the book and trying to recall what you studied");
    expect(kit.held.some((h) => h.section === "quiz" && h.reason === "malformed")).toBe(true);
    expect(kit.map.nodes.map((n) => n.label)).toEqual(["Retrieval practice", "Spaced practice"]);
    expect(kit.map.edges).toHaveLength(1);
    expect(kit.held.some((h) => h.reason === "dangling-edge")).toBe(true);
  });
  it("records a section error instead of throwing", async () => {
    const kit = await generateKit(lecture, async () => { throw new Error("boom"); }, { model: "fake" });
    expect(kit.errors?.points).toBe("boom");
    expect(kit.points).toEqual([]);
  });
});

const pts: Point[] = [
  { id: 0, text: "Retrieval practice means recalling material with the book closed.", quote: goodQuote, segIds: [2] },
  { id: 1, text: "Spaced practice splits study into sessions over several days.", quote: "x", segIds: [5] },
];

describe("explain-back grading", () => {
  const answer = "You should close the book and recall things you studied, that is retrieval practice.";
  it("lexical grading credits overlapping ideas only", () => {
    const g = lexicalGrade(pts, answer);
    expect(g.covered.map((c) => c.id)).toEqual([0]);
    expect(g.missed).toEqual([1]);
  });
  it("rejects model credit whose evidence is not in the learner's text", async () => {
    const llm: Llm = async () => ({ covered: [
      { id: 0, evidence: "close the book and recall things you studied" },
      { id: 1, evidence: "spread sessions over several days" }, // not written by learner
      { id: 7, evidence: "nonsense" },
    ] });
    const g = await gradeExplainBack(pts, answer, llm);
    expect(g.covered.map((c) => c.id)).toEqual([0]);
    expect(g.rejected).toBe(2);
    expect(g.coverage).toBe(0.5);
  });
  it("gives nothing for a trivial answer without calling the model", async () => {
    const g = await gradeExplainBack(pts, "dunno", async () => { throw new Error("should not run"); });
    expect(g.coverage).toBe(0);
  });
});

describe("catch-up", () => {
  const range: [number, number] = [4, 7];
  it("holds points that quote outside the missed range", async () => {
    const inside = lecture.segments[5].text;
    const outside = lecture.segments[1].text;
    const llm: Llm = async () => ({ items: [
      { quote: inside, point: inside },
      { quote: outside, point: outside },
    ] });
    const r = await catchUp(lecture, range, llm);
    expect(r.items).toHaveLength(1);
    expect(r.held).toBe(1);
  });
  it("extractive fallback returns verbatim in-range sentences", () => {
    const r = extractiveCatchUp(lecture, range);
    expect(r.items.length).toBeGreaterThan(0);
    for (const it of r.items) expect(it.segIds[0]).toBeGreaterThanOrEqual(4);
  });
});

describe("progress", () => {
  it("tracks best scores and streaks", () => {
    let p = emptyProgress();
    p = recordQuiz(p, [true, false, true], new Date("2026-10-24T10:00:00Z"));
    p = recordQuiz(p, [true, true, true], new Date("2026-10-25T10:00:00Z"));
    p = recordExplain(p, 0.5, new Date("2026-10-26T10:00:00Z"));
    expect(p.quiz.best).toBe(3);
    expect(p.quiz.attempts).toBe(2);
    expect(streak(p, new Date("2026-10-26T12:00:00Z"))).toBe(3);
    expect(streak(p, new Date("2026-10-29T12:00:00Z"))).toBe(0);
  });
});
