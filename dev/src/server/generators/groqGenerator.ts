/**
 * Groq adapter — a third, working NarrationGenerator implementation
 * (DECISIONS.md D065). Not the active default (Gemini is, D042) — a real,
 * callable alternative alongside Anthropic: set NARRATION_PROVIDER=groq to
 * switch, no other code change needed.
 *
 * Groq hosts a rotating catalog of models behind an OpenAI-compatible
 * chat-completions API — same request/response shape as OpenAI's, not
 * Anthropic's or Gemini's own. Originally pinned to `llama-3.3-70b-versatile`
 * ("Llama-class" per this task's own framing) — a live call against the real
 * key returned 404 `model_not_found`, and `GET /v1/models` confirmed no
 * general-purpose Llama chat model exists in this account's current catalog
 * at all (only two small Llama "prompt-guard" safety-classifier models,
 * which aren't chat models). Groq's real current lineup here is its own
 * `groq/compound`, OpenAI's open-weight `openai/gpt-oss-*`, and Alibaba's
 * `qwen/qwen3.x-*` — see DECISIONS.md D065 for the full finding. Switched to
 * `openai/gpt-oss-120b`: large, general-purpose, and the only family in this
 * catalog explicitly advertising `structured_outputs`/`json_mode` support,
 * which matters for Feature 2's JSON-shaped responses. Same
 * verify-before-trusting caveat as D043 made for Gemini — this may need
 * revisiting if Groq's catalog changes again.
 *
 * Reads process.env.GROQ_API_KEY. Never imported from client code.
 */

import type { NarrationGenerator } from '../narrationGenerator'
import { NarrationApiError } from '../narrationGenerator'
import { buildNarrationPrompt } from '../narrationPrompt'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'openai/gpt-oss-120b'

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export const groqGenerator: NarrationGenerator = {
  name: 'groq',

  async generate(input) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      throw new NarrationApiError('GROQ_API_KEY is not set')
    }

    const { system, user } = buildNarrationPrompt(input)

    let res: Response
    try {
      res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          // 1500, not Gemini/Anthropic's 300 — gpt-oss-120b is a reasoning
          // model that spends part of this SAME token budget on a hidden
          // chain-of-thought (returned separately as `reasoning` in the
          // response, not `content`) before writing the actual answer.
          // Verified live (D065): a simplified version of narrationPrompt.ts's
          // real system prompt burned 200+ of a 300-token budget on hidden
          // reasoning alone; against the FULL real prompt at 300, several
          // calls returned no content at all (likely truncated mid-reasoning
          // before any answer was written) — not a boundary-rule failure, a
          // token-budget one. This is provider-specific tuning, not a change
          // to the shared prompt content in narrationPrompt.ts.
          max_tokens: 1500,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })
    } catch (err) {
      throw new NarrationApiError(`Groq API request failed: ${(err as Error).message}`)
    }

    if (!res.ok) {
      throw new NarrationApiError(`Groq API returned ${res.status}`, res.status)
    }

    const body = await res.json() as GroqChatResponse
    const text = body.choices?.[0]?.message?.content
    if (!text) {
      throw new NarrationApiError('Groq API returned no text content')
    }
    return text.trim()
  },
}
