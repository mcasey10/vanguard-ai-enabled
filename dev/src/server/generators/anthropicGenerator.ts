/**
 * Anthropic adapter — a working, available NarrationGenerator implementation.
 * Not the active default (Gemini is — see DECISIONS.md D042), preserved
 * as a real, callable alternative: set NARRATION_PROVIDER=anthropic to
 * switch to it, no other code changes needed.
 *
 * Reads process.env.ANTHROPIC_API_KEY. Never imported from client code.
 */

import type { NarrationGenerator } from '../narrationGenerator'
import { NarrationApiError } from '../narrationGenerator'
import { buildNarrationPrompt } from '../narrationPrompt'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5'

export const anthropicGenerator: NarrationGenerator = {
  name: 'anthropic',

  async generate(input) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new NarrationApiError('ANTHROPIC_API_KEY is not set')
    }

    const { system, user } = buildNarrationPrompt(input)

    let res: Response
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 300,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })
    } catch (err) {
      throw new NarrationApiError(`Anthropic API request failed: ${(err as Error).message}`)
    }

    if (!res.ok) {
      throw new NarrationApiError(`Anthropic API returned ${res.status}`)
    }

    const body = await res.json() as { content?: Array<{ type: string; text?: string }> }
    const text = body.content?.find(b => b.type === 'text')?.text
    if (!text) {
      throw new NarrationApiError('Anthropic API returned no text content')
    }
    return text.trim()
  },
}
