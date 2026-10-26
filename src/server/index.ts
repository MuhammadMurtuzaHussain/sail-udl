import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { catchUp } from "../core/catchup";
import { gradeExplainBack } from "../core/grade";
import { generateKit } from "../core/kit";
import { DEFAULT_MODEL, ollamaLlm, ollamaStatus } from "../core/ollama";
import { MAX_SOURCE_CHARS, parseSource } from "../core/segment";

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(process.cwd(), "dist");
const llm = ollamaLlm();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

async function body<T>(req: IncomingMessage): Promise<T> {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 200_000) throw new Error("Request too large");
  }
  return JSON.parse(raw || "{}") as T;
}

const json = (res: ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};

function checkText(text: unknown): string {
  if (typeof text !== "string" || text.trim().split(/\s+/).length < 30) throw new Error("Paste at least ~30 words of material.");
  if (text.length > MAX_SOURCE_CHARS) throw new Error(`Material is ${text.length} characters; this MVP takes up to ${MAX_SOURCE_CHARS}.`);
  return text;
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, { model: DEFAULT_MODEL, ...(await ollamaStatus()) });
  }
  if (req.method === "POST" && url.pathname === "/api/kit") {
    const { text } = await body<{ text: string }>(req);
    const src = parseSource(checkText(text));
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const send = (o: unknown) => res.write(JSON.stringify(o) + "\n");
    await generateKit(src, llm, { model: DEFAULT_MODEL, onSection: (id, kit, ms) => send({ type: "section", id, kit, ms }) });
    send({ type: "done" });
    return res.end();
  }
  if (req.method === "POST" && url.pathname === "/api/grade") {
    const { points, answer } = await body<{ points: never[]; answer: string }>(req);
    return json(res, 200, await gradeExplainBack(points, String(answer ?? ""), llm));
  }
  if (req.method === "POST" && url.pathname === "/api/catchup") {
    const { text, range } = await body<{ text: string; range: [number, number] }>(req);
    const src = parseSource(checkText(text));
    const [a, b] = range;
    if (!(a >= 0 && b >= a && b < src.segments.length)) throw new Error("Bad range");
    return json(res, 200, await catchUp(src, [a, b], llm));
  }
  if (req.method === "GET") {
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    if (p === "/" || !existsSync(join(DIST, p)) || statSync(join(DIST, p)).isDirectory()) p = "/index.html";
    const file = join(DIST, p);
    if (!existsSync(file)) return json(res, 404, { error: "Run `npm run build` first (or use `npm run dev`)." });
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    return res.end(readFileSync(file));
  }
  json(res, 404, { error: "Not found" });
}

createServer((req, res) => {
  route(req, res).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (res.headersSent) { res.write(JSON.stringify({ type: "error", message: msg }) + "\n"); res.end(); }
    else json(res, 400, { error: msg });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`SAIL on http://127.0.0.1:${PORT}  (model ${DEFAULT_MODEL})`));
