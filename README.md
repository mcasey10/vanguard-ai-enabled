# Vanguard AI-Enabled Sell & Rebalance

An AI-**enabled** extension of an existing portfolio Sell & Rebalance application. The underlying app — fund selection, tax-lot optimization, scenario comparison, order confirmation — is unchanged. What this project adds is an embedded AI layer on top of it:

- **AI narration** — an existing deterministic string at four points in the flow (Fund Selection rationale, Scenario Analysis tradeoff summary, Order Confirmation summary, Execution Summary narrative) is replaced by a real, live-generated explanation of the same already-computed figures. The model never calculates anything; it only describes numbers the app's own engine already produced.
- **Scenario assistant** — a conversational panel that interprets a plain-language request ("sell $5,000 of VTSAX," "reduce my tax impact by $20,000"), clarifies anything ambiguous, and — only after the user confirms a plain-language summary of what it understood — calls the same calculation engine Fund Selection already uses to build or modify a scenario. It never computes a number itself either.

The project's actual subject is the *design* of that layer, not just building it: what AI-enabled design requires that AI-assisted development doesn't, where a human-in-the-loop boundary needs to sit, and what breaks (in this app's own pre-existing code, and in the AI layer itself) when you try to add it responsibly. See [`CLAUDE.md`](CLAUDE.md) for the full framing.

## Running it locally

```bash
cd dev
npm install
npm run dev
```

Opens at **http://localhost:5173**.

You'll need at least one AI provider key for narration and the Scenario assistant to generate real output — without one, every touchpoint falls back to a deterministic, non-AI-labeled summary of the same figures rather than failing.

```bash
cd dev
cp .env.example .env.local
# then edit .env.local and set at least GEMINI_API_KEY
```

| Variable | Required? | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Required for the default setup | Gemini is the active default provider for both features. Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `ANTHROPIC_API_KEY` | Optional | Only read if `NARRATION_PROVIDER`/`WHATIF_PROVIDER` is set to `anthropic`. |
| `GROQ_API_KEY` | Optional | Only read if set to `groq`. |
| `NARRATION_PROVIDER` | Optional | `gemini` (default) / `anthropic` / `groq` — which provider generates narration. |
| `WHATIF_PROVIDER` | Optional | Same three options, independent of `NARRATION_PROVIDER` — the Scenario assistant can run on a different provider than narration. |

The app's own in-app **Demo Settings** dialog (gear icon, top right) can also switch the active provider and reader-tone segment at runtime, per request — it overrides the env var when set, and falls back to it otherwise. It currently only offers Gemini and Groq in its dropdowns (not Anthropic), because this deployment has no Anthropic key configured — the Anthropic adapter itself is real, tested code, just not switched on here.

Other commands, run from `dev/`:

```bash
npm test        # Vitest — unit/integration tests
npm run test:e2e  # Playwright — end-to-end tests
npm run build    # production build
```

## Where to find deeper context

This README is deliberately just an entry point. The actual project record lives in three places, each with a different job:

- **[`CLAUDE.md`](CLAUDE.md)** — the living architecture and standing-decisions document. Read this before making any change. It covers the project's scope, the AI/code boundary each feature has to respect, business-logic constraints, and a running "implementation map" of where everything actually lives.
- **[`DECISIONS.md`](DECISIONS.md)** — the full, append-only decision log. Every design or engineering decision this project has made, in order, with the reasoning behind it.
- **[`docs/progress.html`](docs/progress.html)** — the human-facing status page: feature completeness, test coverage, a standards-compliance audit, and two sections worth reading even outside this project — an **AI-approaches landscape** mapping what was built (and deliberately not built) against the broader space of AI application patterns, and a **design lessons** section on what this project changed about how to design AI-enabled products, distinct from the engineering bugs it happened to find along the way.

## Scope

This is a portfolio / case-study project, not a production application. Its own in-app "Reset demo" control describes itself the same way: *"Not part of the production feature set — for demonstration purposes only."* Authentication and account selection are mocked, order submission is simulated (no real brokerage transaction ever occurs), and the underlying portfolio data is a static sample dataset — there is no real Vanguard API integration anywhere in this repo.
