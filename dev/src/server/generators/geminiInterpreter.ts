/**
 * Gemini adapter — the active default WhatIfInterpreter (DECISIONS.md D053).
 * Same endpoint/model as geminiGenerator.ts (Feature 1), verified live
 * there (D042/D043) — reused here rather than re-verified, since it's the
 * same Google account/API surface, just a different prompt and a JSON
 * response instead of prose.
 *
 * Reads process.env.GEMINI_API_KEY. Never imported from client code.
 */

import type { WhatIfInterpreter } from '../whatIfInterpreter.js'
import { WhatIfInterpreterApiError } from '../whatIfInterpreter.js'
import { buildWhatIfPrompt } from '../whatIfPrompt.js'
import { parseInterpreterResponse, WhatIfParseError } from '../whatIfResponseParser.js'

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

export const geminiInterpreter: WhatIfInterpreter = {
  name: 'gemini',

  async interpret(input) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new WhatIfInterpreterApiError('GEMINI_API_KEY is not set')
    }

    const { system, user } = buildWhatIfPrompt(input)

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
      throw new WhatIfInterpreterApiError(`Gemini API request failed: ${(err as Error).message}`)
    }

    if (!res.ok) {
      throw new WhatIfInterpreterApiError(`Gemini API returned ${res.status}`, res.status)
    }

    const body = await res.json() as InteractionResponse
    const modelOutput = body.steps?.find(s => s.type === 'model_output')
    const text = modelOutput?.content?.find(c => c.type === 'text')?.text
    if (!text) {
      throw new WhatIfInterpreterApiError('Gemini API returned no text content')
    }

    try {
      return parseInterpreterResponse(text)
    } catch (err) {
      if (err instanceof WhatIfParseError) {
        throw new WhatIfInterpreterApiError(`Gemini response could not be parsed: ${err.message}`)
      }
      throw err
    }
  },
}
