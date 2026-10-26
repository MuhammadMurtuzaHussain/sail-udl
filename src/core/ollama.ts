import type { Llm } from "./types";

export const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

export async function ollamaStatus(model = DEFAULT_MODEL): Promise<{ up: boolean; hasModel: boolean }> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const j = (await r.json()) as { models?: { name: string }[] };
    return { up: true, hasModel: !!j.models?.some((m) => m.name === model || m.name === `${model}:latest`) };
  } catch {
    return { up: false, hasModel: false };
  }
}

/** Structured-output chat against a local Ollama. Retries once if the JSON does not parse. */
export function ollamaLlm(model = DEFAULT_MODEL, timeoutMs = 240_000): Llm {
  return async ({ system, user, schema }) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: schema,
          options: { temperature: attempt === 0 ? 0.2 : 0.5, num_ctx: 8192 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as { message?: { content?: string } };
      try {
        return JSON.parse(j.message?.content ?? "");
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`Model returned invalid JSON twice: ${String(lastErr)}`);
  };
}
