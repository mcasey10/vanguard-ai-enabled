# CLAUDE.md — Vanguard AI-Enabled Sell & Rebalance

## 0. How to use this file

This is the single living context artifact for this project. Read it in full before any planning or build task — it replaces the four-file, phase-split structure (`pm/`, `pd/`, `dev/`, root) used in the original Vanguard Sell & Rebalance pipeline project. That structure does not carry forward here; this project deliberately does not use sequential PM→PD→Dev phases.

**Standing rule — read this before every session, follow it at the end of every session:** roles (PM/PD/Dev) persist as jurisdiction over judgment, not as sequential phases. Work whatever section of this project needs attention next; there is no gate requiring one role's pass to finish before another's begins, except where a decision is genuinely dependent on an earlier one (e.g., you cannot write a boundary rule for a feature that hasn't been scoped). When a decision is made, log it in `DECISIONS.md` immediately, tagged with the role-lens that produced it (PM/PD/Dev), **before ending the session** — a session that ends without that write is exactly how context got lost in the predecessor project (manual copy-paste between Claude Chat and Claude Code, occasionally skipped to save credits). This file and `DECISIONS.md` are the entire mechanism that replaces that relay. If they're not kept current, the mechanism doesn't work, regardless of which tool you're in.

**Standing engagement expectations** (generalized from the market-data session — see `DECISIONS.md` D033–D037 for where these came from):
- Before editing any value that other computed fields, tests, or UI locations might derive from, check for cascading dependencies first — don't assume a field is isolated.
- When a problem seems to present exactly two options, treat that as worth a second look rather than a given — check whether a third option avoids a real cost that both original options share.
- Prefer surfacing an assumption or an unresolved tradeoff explicitly over resolving it silently in whichever direction is easiest to implement.

## 1. Project relationship and scope

This project adds an embedded AI interpretive/generative layer to the **Vanguard Sell & Rebalance** application, which was fully built, deployed, and documented in a separate, prior, now-untouched portfolio project (a three-role PM/PD/Dev pipeline across Notion/Jira/GitHub/Figma). That original project's repository remains the complete historical record and is not modified or referenced from within this repo — no cross-repo links belong in this file. (The relationship between the two projects is described externally, in portfolio/case-study materials, not here.)

This project's own thesis, distinct from feature delivery: test whether role-based rigor (PM/PD/Dev judgment) can be preserved without a sequential artifact-relay process, by consolidating context into one continuously-updated file instead of four phase-gated ones.

**Scope — two features, not four to five:**
1. **AI narration layer** — one cross-cutting capability applied at four existing static-text touchpoints (Fund Selection rationale, Scenario Analysis tradeoff summary, Order Confirmation summary, Execution Summary narrative). Upgrades an existing deterministic string to an AI-generated one at each location; introduces no new UI surface.
2. **AI-assisted "what-if" exploration** — a collapsible AI assistant panel in Scenario Analysis that interprets natural-language requests, clarifies ambiguity, and — after human confirmation — constructs or modifies a scenario by calling the existing calculation engine directly, without requiring navigation to Fund Selection.

**Rejected candidates** (see `DECISIONS.md` D004 for full reasoning): voice/chat-based Order Confirmation entry (wrong risk/value ratio at the highest-stakes, currently input-free stage); document ingestion for holdings extraction (violates bottom-up data construction, no UI precedent, high hallucination risk).

**Standing principle — genuine generation, not simulation** (project-wide, governs both features, not just Feature 1 — see `DECISIONS.md` D038, D042): All "AI-generated" or "AI-assisted" content in this application must be produced by an actual call to a language model at runtime, via a swappable generator interface — never templating, deterministic string assembly, or any other simulated mechanism, regardless of implementation convenience or infrastructure cost. The provider behind that interface is changeable without redesigning calling code, tests, or the fallback logic — **the current active default provider is Gemini** (`gemini-2.5-flash-lite`, via Google AI Studio), with Anthropic (`claude-sonnet-5`) as a second, fully working adapter, switchable via the `NARRATION_PROVIDER` env var. D038 named Anthropic specifically before this generalization; D042 is the refinement, not a reversal of "real model call, never simulated."

## 2. Pointers (don't restate what's already true elsewhere — go look)

- **This repo's calculation engine**: `dev/src/engine/` (module referenced independently of any screen — this is what makes both features architecturally viable: neither has to reimplement calculation logic, both call the same module Fund Selection already calls).
- **This repo's narration engine**: `dev/api/narrate.ts` (Vercel serverless function) calls a provider-agnostic `NarrationGenerator` interface (`dev/src/server/narrationGenerator.ts`), currently Gemini by default with Anthropic as a working alternative (`dev/src/server/generators/`) — see §7 for the full contract, §9 for exact file paths. Narrative generation lives outside the calculation engine entirely, per CD-4.2 and the standing principle in §1.
- **Live previous-project application** — `https://vanguard-ai-pipeline-jade.vercel.app/` (reset via `?reset=true`). First-line source of truth for existing UI behavior and visual design. Check this and the design-system spec before consulting anything else, including this file's own notes, if there's any doubt about current behavior.
- **Canonical workflow spec (HTML)** — `pm/sell_rebalance_workflow.html` in the previous project's repo (fetch live; do not trust a cached copy) — field-by-field states for all four stages, current as of v3.
- **PRD 04** (Notion) — canonical user journey and segment definitions (Segments A–D). Superseded the old Workflow A/B step structure; use this, not `pm/CLAUDE.md`'s stale description.
- **PRD 11** (Notion) — conversational design requirements (CD-1 through CD-6). This is the PM-authored governance layer both features must satisfy — see §6.
- **PDB 05** (Notion) — design system token/component specification. Pull specific values only when building a specific new UI element (see §10); do not embed the whole token table here.

## 3. Glossary — canonical terms (cross-checked against live sources; do not use the alternatives)

| Canonical | Do not use | Why |
|---|---|---|
| Automated / Manual mode | "Workflow A" / "Workflow B" | PRD 04 (live, rewritten) uses Automated/Manual; PRD 11 still uses the old terms in places — treat PRD 11's mode language as needing translation, not as introducing a second real system. |
| "Review order" | "Execute this scenario", "Proceed with this scenario", "Select this scenario" | Confirmed via three independent sources: live app screenshots, canonical workflow HTML, and `pd/CLAUDE.md`'s own terminology table (which itself states it replaces the other three). Design-history chat threads showing "Proceed"/"Execute" reflect an intermediate design that did not ship. |
| "Go to Scenario Analysis" | "Save as scenario" / "Save Scenario" | Scenarios are not named/saved as a distinct save action from the user's perspective; this is navigation, not persistence framing. |
| "Edit scenario →" | — | Secondary action, Scenario Analysis → Fund Selection. |
| "System recommendation — [priority]" badge (system-derived) / "Custom" badge (manually built) | — | Two real, mutually exclusive shipped badge states, both confirmed live (`https://vanguard-ai-pipeline-jade.vercel.app/`, manually-built scenario, 2026-08-28) — not "badge vs. no badge." "System recommendation — [priority]" is a compound label appending the active optimization priority (e.g., "System recommendation — Tax-first optimized"). "Custom" is a real, gray pill (`bg-[#e8e9e9]`/`text-[#717777]`), not internal PD/Figma shorthand for badge absence — see `DECISIONS.md` D040, which supersedes D011's contrary claim. |
| "AI-assisted" badge (new, this project) | — | Independent, compound-format badge (e.g., "AI-assisted — Custom", "AI-assisted — Tax-first optimized") disclosing that the AI assistant constructed/modified the scenario. Orthogonal to the System recommendation badge — one badge answers "how were the numbers derived," the other answers "how was the input captured." See §8. |
| Tax-first / Balance-first | — | The actual objective lever exposed to the user (Fund Selection "Optimization priority" toggle). An objective-driven what-if prompt ("optimize for lower tax") must map onto this toggle, not onto Fund Selection's Automated/Manual mode toggle — scenarios are mode-agnostic once saved. |
| EST. TAX vs. EST. NET TAX | (used interchangeably) | Distinct figures — EST. NET TAX nets loss harvesting against gains. Never conflate in narration or chat output. |

## 4. World model

Canonical source: PRD 04 (Segments A–D), fetched live — do not use an archived description. Segment-specific notes relevant to the two in-scope features:

- **Segment A** ("wants to interrogate the data / may iterate between manual configuration and comparison multiple times"): primary beneficiary of Feature 2; per CD-2.2, prefers data over interpretation, so narration (Feature 1) for this segment should stay terse and figure-forward rather than explanatory.
- Segments B–D: narration tone/posture varies by segment per CD-2.x; consult PRD 11 directly when writing segment-specific copy variants rather than restating the full matrix here.

## 5. Constraints (binding — merged from `dev/CLAUDE.md`, still authoritative; and `pd/CLAUDE.md`, where still applicable)

### Business logic / calculation (source: `dev/CLAUDE.md`)
- Account withdrawal priority order: Taxable → Traditional IRA → Roth.
- Traditional IRA distributions are ordinary income; SpecID is not available for Traditional IRA.
- State tax is out of scope — never compute or display it as a real figure (live UI shows "$0.00" / greyed for state tax by design, not as a placeholder to fill in).
- EST. TAX and EST. NET TAX are always labeled "Estimated" — never presented as final.
- Known rounding-artifact discrepancies exist between some legacy documentation and the corrected calculation engine (`KNOWN_ROUNDING_ARTIFACTS` in `dev/src/engine`). **The engine's live output is always authoritative** — see §11 for the specific documented case (VT8/dataset figures) so it isn't rediscovered as a new bug.
- REQ-B3-002: Fund Selection recalculates live in Manual mode as fields change. Feature 2, once it hands off a constructed delta into Fund Selection (if that path is used) or calls the engine directly (primary path), relies on this — it is existing behavior, not something either feature builds.
- SpecID selection: sell-amount field becomes read-only and the lot-detail panel reveals, atomically, on method selection. This is a **business rule** (SpecID is only valid once specific lots are resolved) independent of which UI surface enforces it — the chat-based assistant must reach the same fully-specified state before it can call the engine, even though it won't replicate the exact field-lock/panel-reveal UI mechanism.
- Wait & Save is suppressed entirely in Automated mode; appears only in Manual mode / manually-active fund rows.
- **MinTax lot selection minimizes total tax *dollars*, not tax *rate*** (`selectLots()` in `dev/src/engine/index.ts`, sorts by `(nav - basis) / nav * taxRate(holding_period)` ascending). This means a recently-acquired short-term lot with a high cost basis relative to current NAV (small embedded gain, taxed at the higher ST rate) can legitimately beat an old long-term lot with a large embedded gain (taxed at the lower LT rate) — the small-gain lot's low absolute tax can undercut the large-gain lot's rate advantage. Verified directly against the real engine for VTSAX's actual lots (a $5,000 sale): the ST lot MinTax picks produces $105.78 in tax, genuinely the lowest of all 9 real alternatives — the next best (an LT lot) produces $143.75, and the largest embedded-gain LT lots produce $500+ despite the lower rate. Correct-but-counterintuitive behavior — documented here specifically so it isn't re-flagged as a suspected bug (see `DECISIONS.md` D046).

### Design system (source: `pd/CLAUDE.md`, still-relevant portions only — build-process content such as Figma file keys, Jira references, and branch strategy is not carried forward)
- Canonical named components exist for badges, alerts, and mode/view toggles (e.g., `Controls/Mode Toggle`, `Alert/Warning Banner`, `Summary Banner`). Any new UI (the AI-assisted badge, the assistant panel) should be built as a proper addition to this system, not bespoke-styled — check the live app / design-system spec for the nearest existing pattern before inventing one.
- Fund Row component states (Automated / Active / Inactive) and their exact read-only/input-field rules are fully specified in `pd/CLAUDE.md`'s "Fund Row usage rules" — consult directly if either feature needs to reason about fund-row state rather than re-deriving it.
- `pd/CLAUDE.md`'s sample dataset is **stale** — see §11. Use `dev/CLAUDE.md`'s corrected figures for anything dataset-related.

## 6. Interaction standards (source: PRD 11, CD-1 through CD-6 — compile as a check, not just a reference)

Before any AI-generated output ships in either feature, it must satisfy:
- **CD-1.1** — assistive, not directive, posture.
- **CD-1.2** — AI transparency: disclose when content is AI-generated (this is the direct basis for the "AI-assisted" badge in Feature 2, and should govern how Feature 1's narration blocks are visually distinguished from static text).
- **CD-1.3** — human control: override, inspect reasoning, opt out / switch to manual at any point.
- **CD-2.x** — segment-aware tone (see §4).
- **CD-3.1** — rationale-sentence structure and accuracy-to-actual-logic requirement (governs Feature 1's Fund Selection touchpoint directly; treat as the template for the other three).
- **CD-4.2** — "Calculation is a tool function; narrative is an AI function. These are distinct." This is the project's core deterministic/generative boundary and predates this project entirely — both features' boundary specs (§7, §8) are applications of this one rule, not new inventions.

## 7. AI/code boundary spec — Feature 1 (narration layer)

- Pure explanation. The AI may only describe values the engine has already computed; it may never state, estimate, or imply a figure itself.
- Every generated block must respect the EST. TAX / EST. NET TAX distinction exactly as computed.
- Applies identically at all four touchpoints — one spec, four call sites, not four bespoke specs.
- Disclosure per CD-1.2 required at each touchpoint (visually distinct from static/deterministic text) — **only when the content shown actually came from the model.** See fallback rule below for the case where it didn't.

**Narration engine architecture** (see `DECISIONS.md` D038, D042):
- Generation is a real LLM API call at runtime, per §1's standing principle — not templating or deterministic assembly — made through a provider-agnostic `NarrationGenerator` interface so the active provider is swappable without touching the fallback logic, the caching layer, or any touchpoint call site. Implemented as a minimal Vercel serverless function, `dev/api/narrate.ts`, wrapping shared core logic also used for local dev-server parity and for direct unit testing.
- **Provider-agnostic by design (D042)**: `getActiveGenerator()` selects Gemini (default) or Anthropic via `NARRATION_PROVIDER`. Both adapters build their prompt from the same shared, provider-agnostic prompt content (`dev/src/server/narrationPrompt.ts`) — no prompt text is duplicated per provider.
- **Input/output contract is the CD-4.2 boundary made architectural, not just conventional**: the function receives only already-engine-computed structured figures (fund/lot identifiers, amounts, gain/loss figures, tax figures, allocation deltas, flags, and — when not excluded — the market-context figure). It never receives raw account data and never performs any calculation. It returns prose text only.
- **Tests mock at the interface/HTTP boundary, not any specific provider's SDK or endpoint.** Same precedent as the market-data rules below (no live network dependency in tests) — not a separate decision, the same one applied to every live-data source. This is also what makes the provider swap safe: client/caching tests mock `fetch` against `/api/narrate` (provider-agnostic already), and adapter-selection tests assert on `getActiveGenerator().name`, never on which HTTP call happened underneath.
- **Failure fallback differs from the market-data sentence's rule on purpose.** Market context is supplementary — omitting it silently on failure is fine (rule 2 below). Narration is the *primary* content at all four touchpoints, so on API failure the touchpoint falls back to a plain, deterministic summary of the same structured figures rather than blank space. That fallback **must not** carry the CD-1.2 AI-generated badge — it genuinely isn't AI-generated in that state, so the badge stays honest in both the success and failure case rather than becoming a fixed label that's sometimes false.
- **Caching**: narration is memoized client-side by a stable hash of the full input payload (touchpoint + structured figures, including market-context/exclusion state) for the session. Decided explicitly, not a silent default — see D038 for the reasoning. Cache keys don't include which provider generated the text — see D042 for why that's fine (the fallback/interface boundary the client depends on doesn't change across providers).
- **Market-data rules** (governs the third narration input, live market-performance context — see `DECISIONS.md` D028–D031, D037):
  1. May state only a percentage return between two real dates — never an absolute price, real or fictional, in the same sentence or surrounding narration.
  2. The figure is a static, precomputed dataset value verified once at authoring time, never a live runtime fetch — no failure-handling or test-mocking logic is needed for it as a result.
  3. **Never fabricate or overwrite a verified real figure to force agreement with the fictional dataset, and never adjust a fictional value without first checking for cascading dependencies** (other display locations, self-consistency/rollup fields — see `DECISIONS.md` D036 for what that check looks like). When a genuine real-vs-fictional conflict is found for a specific fund/lot pairing: if the fictional side can be adjusted safely (no cascading dependents), adjust it and document the change in `note_market_data`, following the precedent of the existing `note_investor_age` field. If it can't be adjusted safely, add an entry to `dataset_metadata.market_context_exclusions` (fund, lot_id, reason) instead and suppress the narration for that specific pairing — the real figure stays as-fetched, the fictional side stays untouched, and the conflict is documented, not resolved silently either way.

## 8. AI/code boundary spec — Feature 2 (what-if assistant)

- **Human-in-the-loop stages are interpretation, not calculation**: prompt → interpret → clarify (if underspecified) → present plain-language interpretation → user confirms → *only then* call the engine. This is the direct instantiation of the original project's "human-in-the-loop labeling throughout" principle, applied for the first time to a real feature.
- **No preview-with-numbers step exists between confirmation and computation.** What's shown pre-compute is the interpreted intent in plain language (e.g., "reduce VTSAX by $5,000, increase VBTLX by $5,000") — not a numeric result, since no numeric result exists yet at that point.
- **The assistant is treated as an external edit tool, equivalent to a Fund Selection round-trip** — not a shortcut around the complexity that made Scenario Analysis read-only in the first place (that complexity was specifically SpecID/cost-lot selection; confirmed via project design history, not inferred). The assistant must reach the same fully-specified state Manual mode requires (see §5) before any engine call — no exemption for being conversational.
- **Capability model: one slot-filling interpret/clarify/confirm loop, not four separate builds.** Simple delta, new comparative scenario from a base, full specification, and iterative multi-turn clarification (including inline lot-level detail, e.g. for SpecID) are all the same mechanism exercised at different levels of user-supplied detail — design and build it once, let it degrade gracefully to asking for whatever is missing.
- **Direct engine invocation, bypassing the Fund Selection screen, is architecturally sound** — the engine is a standalone module (§2), not embedded in the Fund Selection component, so the assistant calling it directly does not duplicate or risk diverging from Fund Selection's own calls, *provided* the assistant only ever calls the shared engine module and never reimplements any calculation or business rule itself. If the assistant pathway and the Fund Selection pathway ever produce different numbers for identical inputs, that is a defect in the assistant's integration, not a second valid answer.
- **Scenario provenance and mode tagging**: any scenario the assistant creates or modifies gets the "AI-assisted" badge (§3), independent of whether the resulting scenario is fund-specific (pairs with the "Custom" badge — not absence of a badge, see §3/D040) or objective-driven (pairs with "System recommendation — [priority]", where priority maps to the Tax-first/Balance-first toggle the prompt implied or specified). **Open question, not yet resolved (D040):** for the fund-specific case, does "AI-assisted" replace "Custom," or do both render together? Resolve when Feature 2's badge is actually built, against the live app's real "Custom" pill, not by inference.
- **This is a deliberate scope increase over a lighter "delta + redirect to Fund Selection" design that was considered and superseded** — chosen because the project's goal is depth of embedded-AI expertise for a case study, not least-cost delivery. See `DECISIONS.md` D010–D013.

## 9. Implementation map

**This is a living summary of where things actually live right now — not a log.** `DECISIONS.md` is append-only by design (it answers "why did we get here"); this section answers a different question ("where does X actually live right now") and must be *edited in place* every time it goes stale. Do not append a new dated entry here — that's what `DECISIONS.md` is for.

**Feature 1 (narration layer) — four touchpoints:**
- Fund Selection rationale: `dev/src/pages/FundSelectionAutomated.tsx`, `dev/src/pages/FundSelectionManual2.tsx`
- Scenario Analysis tradeoff summary: `dev/src/pages/ScenarioAnalysis.tsx`
- Order Confirmation summary: `dev/src/pages/OrderConfirmation.tsx`
- Execution Summary narrative: `dev/src/pages/ExecutionSummary.tsx`

**Feature 1 — shared narration architecture (one spec, four call sites — see §7):**
- Narration component (all four touchpoints render through this one): `dev/src/components/NarrationBlock.tsx`
- Vercel serverless function (the HTTP entry point): `dev/api/narrate.ts` — calls `getActiveGenerator().generate(input)`, doesn't know which provider
- Provider-agnostic generator interface + active-provider selection (`NARRATION_PROVIDER` env var, defaults to Gemini): `dev/src/server/narrationGenerator.ts`
- Shared, provider-agnostic prompt construction (used by every adapter — no per-provider prompt duplication): `dev/src/server/narrationPrompt.ts`
- Provider adapters, each a concrete `NarrationGenerator`: `dev/src/server/generators/geminiGenerator.ts` (active default, `gemini-2.5-flash-lite`), `dev/src/server/generators/anthropicGenerator.ts` (working alternative, `claude-sonnet-5`)
- Client-side caching/fetch module: `dev/src/utils/narration.ts`
- Deterministic fallback builder (used on API failure, never AI-badged): `buildDeterministicFallback()` in `dev/src/utils/narrationShared.ts`
- Shared types + market-context exclusion check: `dev/src/utils/narrationShared.ts` (`NarrationInput`, `isMarketContextExcluded()`, `buildMarketContext()`)
- Per-touchpoint input adapters (engine output → `NarrationInput`, no calculation): `dev/src/utils/narrationBuilders.ts`
- Local dev-server parity for `/api/narrate`, including loading `.env.local` into `process.env` for the dev Node process (so `npm run dev` alone works without `vercel dev`): middleware + `loadEnv()` wiring in `dev/vite.config.ts`
- Env var scaffolding: `dev/.env.example` (committed, placeholders only), `dev/.env.local` (gitignored, real keys)
- Test coverage for all 11 §12 categories, plus generator-selection/interface-boundary coverage: `dev/src/utils/narration.test.ts`

**Feature 2 (what-if assistant):** not yet built — no files exist. Update this entry when it is.

**Badges (§3 glossary):** both real states render in `ScenarioAnalysis.tsx`'s `ScenarioColumn` (~line 291–309): `isSystemRec` true → "System recommendation — [priority]" pill; false → "Custom" pill (confirmed correct against the live app — D040; this repo's code was already right, D011's documentation was wrong). "AI-assisted" badge (Feature 2 provenance): not yet built — see §8's open question on how it composes with "Custom."

## 10. Working process — standing rules

- **Tooling** (source: `DECISIONS.md` D025, reconciled against the original pipeline's `ai_pipeline.html` tool-by-role inventory): kept and extended — Vitest, Playwright, Vercel/GitHub Actions. Dropped for this project — multi-model reconciliation (ChatGPT/Gemini comparison), Whimsical, v0, Jira/Atlassian Rovo; none serve a function this project's scope and scale actually needs (no open structural exploration, no multi-person coordination). Notion shifts to reference-only — no new pages authored here; new PM-lens decisions go into `DECISIONS.md` instead.
- **Verify, don't assume, whenever a specific fact matters.** This project's own history has repeatedly found live sources disagreeing with cached ones (see §11) — treat any UI copy, field behavior, or figure as unconfirmed until checked against the live app or the most current fetched source, not the first document that surfaces it.
- **Live source beats Notion/doc source when they conflict.** Track record on this project specifically: Notion and legacy `CLAUDE.md` files have drifted from shipped reality multiple times; the live app and current canonical HTML have not yet been found wrong.
- **Pull design tokens individually, on demand, not wholesale.** Do not embed PDB 05's full token/typography table into this file preemptively — that reintroduces the fragmentation problem this file exists to avoid, at the cost of bloating the one document meant to stay fully readable every session.
- **For any new visual element**: check PDB 05 / the design-system spec and the live previous-project app first. Only fall back to `pd/reference-screenshots/` (real Vanguard.com screenshots) as inspiration, not as a source of truth for this project's implementation — those screenshots were themselves just an input to the original design-system creation process, not a spec for what we're extending.
- **Log every decision to `DECISIONS.md` before ending a session**, tagged by role-lens (PM/PD/Dev). This is not optional bookkeeping — see §0.

## 11. Known source drift (register — check here before treating a discrepancy as a new bug)

- PRD 11 uses "Workflow A"/"Workflow B" terminology in places; PRD 04 (current, canonical) uses Automated/Manual. Not a functional disagreement, just unreconciled naming — translate mentally when reading PRD 11.
- `pm/CLAUDE.md`'s Notion page-ID table is stale relative to the current Notion hub structure.
- `pd/CLAUDE.md`'s canonical sample dataset is stale relative to `dev/CLAUDE.md`'s corrected figures (dataset corrections were applied after PD phase concluded). Specific known deltas: portfolio total $849,851.40 (pd, stale) vs. $870,619.40 (dev, corrected); VTSAX ST gain $1,515.85 (pd, stale) vs. $1,515.50 (dev, corrected); EST. NET TAX $110.21 (pd, stale) vs. $111.21 (dev, corrected). **Always use `dev/CLAUDE.md`'s figures.**
- Design-history chat threads (mid-project Figma/CC prompt sessions) contain superseded decisions — e.g., "Execute"/"Proceed" button terminology, an assumption that Scenario Analysis would "always be in edit mode." These did not ship; do not treat design-history excerpts as current unless cross-checked against a live source.
- Minor/unconfirmed: the canonical workflow HTML's text description of the allocation-impact indicator ("Improved/Regressed/Neutral", categorical) does not match the live app's summary view, which shows signed per-asset-class percentage deltas. Doesn't affect either feature's scope; flagged for whoever eventually touches that indicator.

## 12. Test-case coverage baseline (source: `DECISIONS.md` D032 — agreed prior to any UI build)

These are the acceptance-criteria categories both features build toward, not a description of what's already implemented — check `DECISIONS.md` for build-status entries before assuming any of these are covered yet.

**Narration (Feature 1) — 11 categories:** pure gain / pure loss-harvest / mixed gain+harvest / ST-LT crossing / Traditional IRA ordinary-income framing / allocation toward-target / allocation away-from-target / Wait & Save triggered / SpecID lot-level active / same figures across two segment tones / multi-fund (3+) aggregation / **market-context exclusion-check mechanism** — verifies the narration code actually consults `dataset_metadata.market_context_exclusions` for the (fund, lot) pairing being narrated before including a market-context sentence, not just that the one hardcoded VFITX/IRA-VFITX-06 case happens to render correctly. Added post-D037, once the exclusion pattern existed to have a mechanism to test.

**What-if (Feature 2) — 9 categories:** clean unambiguous delta / vague-relative quantity requiring clarification / objective-shaped request mapping to Tax-first or Balance-first / full specification with explicit cost-basis methods / multi-turn with inline lot-level detail / SpecID requested on Traditional IRA (must refuse) / requested amount exceeding position size (must catch, not pass to engine) / ambiguous fund reference requiring disambiguation / out-of-scope general-advice request (must decline per assistive-not-directive posture).
