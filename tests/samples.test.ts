import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaim, findQuote } from "../src/core/ground";
import { parseSource } from "../src/core/segment";
import type { Kit } from "../src/core/types";

/** Re-validates the committed demo kits against their source text, so the demo can never ship an ungrounded claim. */
for (const name of ["lecture", "notes"]) {
  describe(`bundled ${name} kit`, () => {
    const src = parseSource(readFileSync(`samples/${name}.txt`, "utf8"));
    const kit = JSON.parse(readFileSync(`samples/${name}.kit.json`, "utf8")) as Kit;
    it("every kept quote is verbatim in the source", () => {
      const all = [
        ...kit.points, ...kit.map.nodes, ...kit.map.edges, ...kit.quiz, ...kit.examples, ...kit.audio, ...kit.projects,
      ];
      expect(all.length).toBeGreaterThan(20);
      for (const g of all) expect(findQuote(src, g.quote), g.quote).not.toBeNull();
    });
    it("claims still pass the full check", () => {
      for (const p of kit.points) expect(checkClaim(src, p.text, p.quote).ok, p.text).toBe(true);
      for (const a of kit.audio) expect(checkClaim(src, a.text, a.quote).ok, a.text).toBe(true);
    });
    it("quiz answers are valid options", () => {
      for (const q of kit.quiz) {
        expect(q.options).toHaveLength(4);
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(4);
      }
    });
  });
}
