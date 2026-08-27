# Dev Phase — Development

This directory contains the full React application built during the Development phase of the Vanguard AI Pipeline project.

**Timeline:** June 17 – July 9, 2026  
**Role:** Developer (AI-assisted)  
**Tools:** Claude Code, Figma MCP

## Live deployment

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

**Test results at release tag `dev-phase-complete` (commit 923323b):** 58/58 unit tests passing · 2/2 Playwright E2E flows passing

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

## Known gaps (post-release)

- No real Vanguard API integration — all data is static sample dataset
- Authentication and account selection are mocked (L1 nav is static)
- Order submission is simulated — no actual brokerage transaction
- Transaction history is session-only (not persisted between reloads)
- Mobile layout is present but not optimized — designed for 1440px desktop

## Notion workspace

Dev phase context and requirements: https://www.notion.so/Vanguard-Sell-Rebalance-PRD-33edcac9574a808da907cc9decefb512
