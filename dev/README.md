# Application — Vanguard AI-Enabled Sell & Rebalance

This directory contains the React application this project extends with an embedded AI interpretive/generative layer. See the repo root [`CLAUDE.md`](../CLAUDE.md) for full project context — this project doesn't use the phase-based structure the app was originally built under.

## Live deployment (original, unmodified application — see `CLAUDE.md` §2)

| URL | Description |
|-----|-------------|
| https://vanguard-ai-pipeline-jade.vercel.app/ | Production deployment |
| https://vanguard-ai-pipeline-jade.vercel.app/?reset=true | Clean demo state (clears all localStorage) |

## Run locally

```bash
cd dev
npm install
npm run dev
```

Runs at `http://localhost:5173`

## Tech stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 5 |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS v3 |
| Routing | React Router v6 |
| State | Zustand v5 |
| Unit tests | Vitest 2 |
| E2E tests | Playwright |
| CI | GitHub Actions |
| Deployment | Vercel |
| Backend | Vercel serverless function (`api/narrate.ts`) — Anthropic API |

**Baseline test results, this repo:** see `DECISIONS.md` for the most recent Vitest/Playwright run against this copy of the app — the original project's release-tag/commit reference no longer applies here since this repo's git history was stripped on import.

## Directory structure

```
dev/
├── src/
│   ├── components/        # Shared UI components (CoachMark, shell, etc.)
│   ├── pages/             # Route-level page components
│   ├── store/             # Zustand store (vsr-store.ts)
│   ├── engine/            # Dual-objective optimization engine
│   │   ├── optimizer.ts   # Core optimization logic
│   │   └── types.ts       # Engine type definitions
│   └── data/              # Sample dataset (43 lots, 7 funds)
├── tests/                 # Vitest unit tests for the engine
├── e2e/                   # Playwright E2E tests
└── public/                # Static assets
```

## Optimization engine

The engine implements a dual-objective optimization: minimize realized capital gains tax while rebalancing portfolio allocation toward target percentages.

**Inputs:** withdrawal amount, optimization priority (tax-first, balance-first, or balanced), current lot data with cost basis, fund allocations  
**Algorithm:** greedy lot selection ordered by priority weighting; iterates over funds sorted by rebalancing need and tax efficiency  
**Output:** selected lots, realized gains/losses per fund, projected post-sale allocation, estimated tax impact

Unit tests cover: lot selection ordering, short/long-term gain classification, wash-sale exclusions, edge cases (zero-gain lots, insufficient balance, single-lot funds).

## Backend

`api/narrate.ts` is a minimal Vercel serverless function that calls the Anthropic API to generate the Feature 1 narration text (see `CLAUDE.md` §7, `DECISIONS.md` D038). It requires an `ANTHROPIC_API_KEY` environment variable in the Vercel project (or a local `.env` consumed by `vercel dev`) — without one, every touchpoint falls back to a deterministic, non-AI-labeled summary of the same figures rather than failing. `npm run dev` alone (no `vercel dev` needed) also serves this route locally via a Vite dev-server middleware in `vite.config.ts`.

## Known gaps (post-release)

- No real Vanguard API integration — all portfolio/holdings data is static sample dataset. (Unrelated to `api/narrate.ts` above, which is narration-only and never touches account data — see its input/output contract in `CLAUDE.md` §7.)
- Authentication and account selection are mocked (L1 nav is static)
- Order submission is simulated — no actual brokerage transaction
- Transaction history is session-only (not persisted between reloads)
- Mobile layout is present but not optimized — designed for 1440px desktop

## Notion workspace (reference-only for this project — see `CLAUDE.md` §2, §9)

PRD 04 (canonical user journeys and segment definitions): https://www.notion.so/Vanguard-Sell-Rebalance-PRD-33edcac9574a808da907cc9decefb512
