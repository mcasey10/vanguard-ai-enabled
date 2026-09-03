/**
 * Groq adapter — a third, working WhatIfInterpreter implementation
 * (DECISIONS.md D065). Not the active default (Gemini is, D053) — set
 * WHATIF_PROVIDER=groq to switch, no other code change needed.
 *
 * Same OpenAI-compatible chat-completions shape as groqGenerator.ts — see
 * that file's header for the full model-pinning story: `llama-3.3-70b-versatile`
 * doesn't exist in this account's real catalog (no general-purpose Llama
 * chat model does, as of DECISIONS.md D065's live check), so this is pinned
 * to `openai/gpt-oss-120b` instead — chosen specifically for its explicit
 * `structured_outputs`/`json_mode` support, which matters most for this
 * file's JSON-shaped responses. Verify-before-trusting the same way D043
 * corrected Gemini's model pin.
 *
 * Reads process.env.GROQ_API_KEY. Never imported from client code.
 */

import type { WhatIfInterpreter } from '../whatIfInterpreter'
import { WhatIfInterpreterApiError } from '../whatIfInterpreter'
import { buildWhatIfPrompt } from '../whatIfPrompt'
import { parseInterpreterResponse, WhatIfParseError } from '../whatIfResponseParser'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'openai/gpt-oss-120b'

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export const groqInterpreter: WhatIfInterpreter = {
  name: 'groq',

  async interpret(input) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      throw new WhatIfInterpreterApiError('GROQ_API_KEY is not set')
    }

    const { system, user } = buildWhatIfPrompt(input)

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
          // 2000, not Gemini/Anthropic's 500 — see groqGenerator.ts's
          // comment on the same parameter: gpt-oss-120b spends part of this
          // budget on a hidden chain-of-thought before writing the actual
          // JSON response, verified live against a truncated/empty response
          // at the lower value (D065). Provider-specific tuning, not a
          // change to whatIfPrompt.ts's shared content.
          max_tokens: 2000,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })
    } catch (err) {
      throw new WhatIfInterpreterApiError(`Groq API request failed: ${(err as Error).message}`)
    }

    if (!res.ok) {
      throw new WhatIfInterpreterApiError(`Groq API returned ${res.status}`, res.status)
    }

    const body = await res.json() as GroqChatResponse
    const text = body.choices?.[0]?.message?.content
    if (!text) {
      throw new WhatIfInterpreterApiError('Groq API returned no text content')
    }

    try {
      return parseInterpreterResponse(text)
    } catch (err) {
      if (err instanceof WhatIfParseError) {
        throw new WhatIfInterpreterApiError(`Groq response could not be parsed: ${err.message}`)
      }
      throw err
    }
  },
}
