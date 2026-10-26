const STOP = new Set(
  "a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that these those there here we you they he she i me my our your their his her not no do does did done have has had will would can could should may might must just also very more most some any each every than too into about over under again further once only own same such what which who whom when where why how all both few other out up down off both while because until during before after above below between through".split(
    " ",
  ),
);

/** Lowercase, strip punctuation, collapse whitespace. Used for quote matching. */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function wordCount(s: string): number {
  const n = norm(s);
  return n ? n.split(" ").length : 0;
}

/** Very small suffix stripper: enough to match "strengthens" with "strengthen". */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  if (/(ies|ied)$/.test(w)) return w.replace(/(ies|ied)$/, "y");
  return w.replace(/(ingly|edly|ing|ed|es|ly|s)$/, "");
}

export function contentStems(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

/** Fraction of `claim`'s content stems that also occur in `context`. 1 when claim has none. */
export function support(claim: string, context: string): number {
  const c = contentStems(claim);
  if (!c.length) return 1;
  const ctx = new Set(contentStems(context));
  return c.filter((w) => ctx.has(w)).length / c.length;
}

export function numbersIn(s: string): string[] {
  return (s.normalize("NFKC").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}
