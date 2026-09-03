/**
 * Anthropic adapter — a working, available WhatIfInterpreter implementation.
 * Not the active default (Gemini is — see DECISIONS.md D053, mirroring
 * D042's choice for Feature 1). Set WHATIF_PROVIDER=anthropic to switch, no
 * other code change needed.
 *
 * Reads process.env.ANTHROPIC_API_KEY. Never imported from client code.
 */

import type { WhatIfInterpreter } from '../whatIfInterpreter'
import { WhatIfInterpreterApiError } from '../whatIfInterpreter'
import { buildWhatIfPrompt } from '../whatIfPrompt'
import { parseInterpreterResponse, WhatIfParseError } from '../whatIfResponseParser'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5'

export const anthropicInterpreter: WhatIfInterpreter = {
  name: 'anthropic',

  async interpret(input) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new WhatIfInterpreterApiError('ANTHROPIC_API_KEY is not set')
    }

    const { system, user } = buildWhatIfPrompt(input)

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
          max_tokens: 500,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })
    } catch (err) {
      throw new WhatIfInterpreterApiError(`Anthropic API request failed: ${(err as Error).message}`)
    }

    if (!res.ok) {
      throw new WhatIfInterpreterApiError(`Anthropic API returned ${res.status}`, res.status)
    }

    const body = await res.json() as { content?: Array<{ type: string; text?: string }> }
    const text = body.content?.find(b => b.type === 'text')?.text
    if (!text) {
      throw new WhatIfInterpreterApiError('Anthropic API returned no text content')
    }

    try {
      return parseInterpreterResponse(text)
    } catch (err) {
      if (err instanceof WhatIfParseError) {
        throw new WhatIfInterpreterApiError(`Anthropic response could not be parsed: ${err.message}`)
      }
      throw err
    }
  },
}
