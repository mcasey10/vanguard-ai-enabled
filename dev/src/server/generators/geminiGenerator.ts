/**
 * Gemini adapter — the active default NarrationGenerator (DECISIONS.md
 * D042). Calls Google AI Studio's Gemini API via the Interactions
 * endpoint (GA as of June 2026, the currently recommended endpoint for
 * new projects — verified live against ai.google.dev this session, not
 * assumed from training data).
 *
 * Model: gemini-3.5-flash-lite. D042 originally picked gemini-2.5-flash-lite
 * as the cheapest GA tier by listed price, but it turned out to be retired
 * for new API keys — a real call against it returned 404 with
 * "This model models/gemini-2.5-flash-lite is no longer available to new
 * users. Please update your code to use models/gemini-3.5-flash-lite" (see
 * DECISIONS.md D043). 3.5-flash-lite is confirmed working end-to-end with a
 * real key as of this update. Verify this is still current if picking up
 * this file much later — pricing tiers, generations, and availability
 * shift (D042/D043).
 *
 * Reads process.env.GEMINI_API_KEY. Never imported from client code.
 */

import type { NarrationGenerator } from '../narrationGenerator.js'
import { NarrationApiError } from '../narrationGenerator.js'
import { buildNarrationPrompt } from '../narrationPrompt.js'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MODEL = 'gemini-3.5-flash-lite'

interface InteractionStep {
  type: string
  content?: Array<{ type: string; text?: string }>
}

interface InteractionResponse {
  status?: string
  steps?: InteractionStep[]
}

export const geminiGenerator: NarrationGenerator = {
  name: 'gemini',

  async generate(input) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new NarrationApiError('GEMINI_API_KEY is not set')
    }

    const { system, user } = buildNarrationPrompt(input)

    let res: Response
    try {
      res = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model: MODEL,
          system_instruction: system,
          input: user,
        }),
      })
    } catch (err) {
      throw new NarrationApiError(`Gemini API request failed: ${(err as Error).message}`)
    }

    if (!res.ok) {
      throw new NarrationApiError(`Gemini API returned ${res.status}`, res.status)
    }

    const body = await res.json() as InteractionResponse
    const modelOutput = body.steps?.find(s => s.type === 'model_output')
    const text = modelOutput?.content?.find(c => c.type === 'text')?.text
    if (!text) {
      throw new NarrationApiError('Gemini API returned no text content')
    }
    return text.trim()
  },
}
