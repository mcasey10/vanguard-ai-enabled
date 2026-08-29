/**
 * Gemini adapter — the active default NarrationGenerator (DECISIONS.md
 * D042). Calls Google AI Studio's Gemini API via the Interactions
 * endpoint (GA as of June 2026, the currently recommended endpoint for
 * new projects — verified live against ai.google.dev this session, not
 * assumed from training data).
 *
 * Model: gemini-2.5-flash-lite — the cheapest currently-GA Gemini tier
 * ($0.10/$0.40 per 1M input/output tokens as of this session's check),
 * chosen over the newer 3.x flash-lite generations specifically because
 * they cost more per token; this is a short-input/short-output generation
 * task with no need for a larger or newer tier (same reasoning as
 * Haiku-over-Opus for the Anthropic adapter). Verify this is still the
 * cheapest GA option if picking up this file much later — pricing tiers
 * and generations shift (see DECISIONS.md D042).
 *
 * Reads process.env.GEMINI_API_KEY. Never imported from client code.
 */

import type { NarrationGenerator } from '../narrationGenerator'
import { NarrationApiError } from '../narrationGenerator'
import { buildNarrationPrompt } from '../narrationPrompt'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MODEL = 'gemini-2.5-flash-lite'

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
      throw new NarrationApiError(`Gemini API returned ${res.status}`)
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
