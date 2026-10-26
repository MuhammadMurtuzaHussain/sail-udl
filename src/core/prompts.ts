import { renderForPrompt } from "./segment";
import type { SectionId, Source } from "./types";

/** Restrictions stated up front, role-play as a careful tutor, evidence first. */
export const SYSTEM = `You are SAIL, a careful study tutor who helps students learn from their own material.
You work ONLY from the SOURCE the student pasted. Rules:
1. Every item carries a "quote": an exact, contiguous copy of words from the SOURCE (4 to 40 words, no speaker names, no [id] markers). Write the quote FIRST, then write the item from it.
2. Never use outside knowledge. Never add a number, date, name or term that is not in the SOURCE.
3. If the SOURCE does not support enough items, return fewer. Never pad.
4. Write plain, friendly English for a university student.
Reply with JSON only.`;

const str = { type: "string" };
const strs = { type: "array", items: str };
const arrOf = (props: Record<string, object>, required = Object.keys(props)) => ({
  type: "array",
  items: { type: "object", properties: props, required },
});

export interface SectionSpec {
  id: SectionId;
  schema: object;
  user: (src: Source) => string;
}

const wrap = (src: Source, task: string, example: string) =>
  `<source>\n${renderForPrompt(src)}\n</source>\n\n${task}\n\nExample of the format, on unrelated material about gardening ("Tomatoes need six hours of sun."):\n${example}\n\nNow do the same for the SOURCE above.`;

export const SECTIONS: SectionSpec[] = [
  {
    id: "points",
    schema: { type: "object", properties: { items: arrOf({ quote: str, idea: str }) }, required: ["items"] },
    user: (src) =>
      wrap(
        src,
        "List the 6 most important ideas a student must remember. Each idea is one clear sentence in your own words.",
        `{"items":[{"quote":"Tomatoes need six hours of sun","idea":"Tomato plants need plenty of direct sunlight each day."}]}`,
      ),
  },
  {
    id: "map",
    schema: {
      type: "object",
      properties: {
        nodes: arrOf({ quote: str, label: str }),
        edges: arrOf({ quote: str, from: str, to: str, relation: str }),
      },
      required: ["nodes", "edges"],
    },
    user: (src) =>
      wrap(
        src,
        'Build a concept map: 6 to 9 nodes (a "label" of at most 4 words naming a key concept) and 6 to 10 edges. An edge links two node labels, copied exactly, with a short "relation" phrase such as "needs" or "leads to". Each node and each edge needs its own quote.',
        `{"nodes":[{"quote":"Tomatoes need six hours of sun","label":"Tomato sunlight"},{"quote":"Watering early reduces evaporation","label":"Early watering"}],"edges":[{"quote":"Watering early reduces evaporation","from":"Early watering","to":"Tomato sunlight","relation":"is timed around"}]}`,
      ),
  },
  {
    id: "quiz",
    schema: {
      type: "object",
      properties: {
        items: arrOf({ quote: str, question: str, correct: str, wrong: strs, explanation: str }),
      },
      required: ["items"],
    },
    user: (src) =>
      wrap(
        src,
        'Write 5 multiple-choice questions. Each has one "correct" answer that the quote proves, and exactly 3 plausible "wrong" answers. Test understanding, not wording. Short "explanation" of why the correct answer is right.',
        `{"items":[{"quote":"Tomatoes need six hours of sun","question":"How much sun do tomato plants need each day?","correct":"About six hours","wrong":["About one hour","Only indirect light","None, they grow in shade"],"explanation":"The source says tomatoes need six hours of sun."}]}`,
      ),
  },
  {
    id: "examples",
    schema: {
      type: "object",
      properties: { items: arrOf({ quote: str, title: str, scenario: str, steps: strs }) },
      required: ["items"],
    },
    user: (src) =>
      wrap(
        src,
        'Write 2 short worked examples that show a key idea applied in a concrete everyday situation: a "scenario" (1-2 sentences) and 2 to 4 "steps". The quote is the passage that states the idea being illustrated. Do not introduce numbers that are not in the SOURCE.',
        `{"items":[{"quote":"Tomatoes need six hours of sun","title":"Choosing a spot","scenario":"Sam has a shaded balcony and a bright windowsill.","steps":["Check which spot gets the most direct light.","Place the tomato plant there."]}]}`,
      ),
  },
  {
    id: "audio",
    schema: {
      type: "object",
      properties: { lines: arrOf({ quote: str, speaker: str, line: str }) },
      required: ["lines"],
    },
    user: (src) =>
      wrap(
        src,
        'Write a friendly two-voice audio script (speakers "Ana" and "Ben") of about 8 short spoken lines that walks through the material for a listener. Each line has its own quote.',
        `{"lines":[{"quote":"Tomatoes need six hours of sun","speaker":"Ana","line":"First thing to know: tomatoes want lots of sun."}]}`,
      ),
  },
  {
    id: "projects",
    schema: { type: "object", properties: { items: arrOf({ quote: str, title: str, brief: str }) }, required: ["items"] },
    user: (src) =>
      wrap(
        src,
        'Suggest 3 short project prompts a student could do to show what they learned (for example make a poster, record a 2-minute talk, or apply the idea to their own situation). Each has a "title" and a 1-2 sentence "brief". The quote is the passage the project is about.',
        `{"items":[{"quote":"Tomatoes need six hours of sun","title":"Sun map","brief":"Sketch your garden and mark where each spot gets direct light, then decide where a tomato plant would go."}]}`,
      ),
  },
];

export function catchUpPrompt(src: Source, ids: number[]): { system: string; user: string; schema: object } {
  return {
    system: SYSTEM,
    schema: { type: "object", properties: { items: arrOf({ quote: str, point: str }) }, required: ["items"] },
    user: `A student zoned out for part of a session. Below is ONLY the part they missed.\n<missed>\n${renderForPrompt(src, ids)}\n</missed>\n\nList the 3 to 5 things they must know from the missed part, each as one clear sentence ("point") with its quote, in the order they happened.\n\nFormat: {"items":[{"quote":"...exact words...","point":"..."}]}`,
  };
}

export function gradePrompt(points: { id: number; text: string }[], answer: string) {
  return {
    system:
      "You grade a student's explain-back against a checklist of key ideas. Be fair but strict: an idea is covered only if the student's own words express it. Reply with JSON only.",
    schema: {
      type: "object",
      properties: { covered: arrOf({ id: { type: "integer" }, evidence: str }) },
      required: ["covered"],
    },
    user: `Checklist:\n${points.map((p) => `${p.id}: ${p.text}`).join("\n")}\n\nStudent's explanation:\n"""\n${answer}\n"""\n\nFor each checklist idea the student covered, give its "id" and an "evidence" string copied EXACTLY from the student's explanation. Leave out ideas that were not covered.\n\nFormat: {"covered":[{"id":0,"evidence":"...exact words from the student..."}]}`,
  };
}
