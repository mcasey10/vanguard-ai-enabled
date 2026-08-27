# DECISIONS.md — Vanguard AI-Enabled Sell & Rebalance

Append-only. Chronological. Each entry tagged with the role-lens (PM/PD/Dev) that produced the judgment call, not with a project phase — see `CLAUDE.md` §0. Never edit a past entry to "fix" it in place; if a decision is superseded, add a new entry that says so and references the old one.

---

### D001 — [PM] Process model: jurisdiction, not phases
Roles (PM/PD/Dev) persist as ownership of specific judgment lenses, not as sequential stages with handoff artifacts. The non-handoff context model removes the artifact *relay* between roles, not the distinct thinking each role does. Operational unit is the individual decision or feature, not "the project" or "the role" — each gets the appropriate lens applied explicitly and logged, but lenses can be applied to different features interleaved in one sitting rather than batched by role across the whole project.

### D002 — [PM] Scrum ceremonies: not abandoned, re-scoped
Ceremonies that coordinate scarce human attention and commit to stakeholders (sprint planning's capacity commitment, WIP limiting, cross-person synchronization) are unrelated to phase-gated documentation and survive regardless of context model. What becomes redundant is specifically the mechanic of finishing an artifact and throwing it over the wall to the next role. In this solo, single-repo project both ceremony functions collapse to nothing since there's only one human — not generalizable evidence that ceremonies are unnecessary in a multi-person team.

### D003 — [PM] Decisions log is role-tagged, not phase-tagged
One continuous `DECISIONS.md`, entries interleaved by time, each carrying which lens produced it. This is what preserves traceability without artifact fragmentation.

### D004 — [PM] Feature scope: two features, not four to five
Ran all ten brief candidates through PM/PD/Dev lenses. Result:
- **In scope, Feature 1**: AI narration layer — one cross-cutting capability at four existing static-text touchpoints (Fund Selection rationale, Scenario Analysis tradeoff summary, Order Confirmation summary, Execution Summary narrative). Each touchpoint already renders equivalent static text today; this upgrades the field, not the screen.
- **In scope, Feature 2**: AI-assisted "what-if" exploration in Scenario Analysis, routed through the real engine.
- **Rejected — voice/chat Order Confirmation entry**: introduces a new interaction paradigm at the single highest-stakes, currently 100%-read-only stage in the journey; misparse risk there is a wrong trade, not a bad narration. Weakest risk/value ratio of any candidate.
- **Rejected — document ingestion (holdings extraction from uploaded statements)**: doesn't map to any PRD 04 stage or segment need; violates the bottom-up data construction principle; highest hallucination risk; no existing UI precedent anywhere in the screen inventory.

### D005 — [PM/Dev] Feature 2 core boundary: human-in-the-loop interpretation, deterministic computation
Confirm-before-compute gates AI *interpretation*, never gates or substitutes for calculation. The AI may construct a candidate scenario input from natural language; the constructed input must be shown to and confirmed by the user before the engine runs on it. This is the first concrete instantiation of the original project's "human-in-the-loop labeling throughout, distinguishing AI-suggested/explained content from system-executed actions" principle.

### D006 — [PD] Feature 2 UI: collapsible assistant panel, not a redirect to Fund Selection
Superseded an earlier design (delta interpretation → navigate to Fund Selection with prefill → user manually returns to Scenario Analysis) — see D010. Current design: a collapsible AI assistant panel sits in/over the "Add scenario" slot in Scenario Analysis; confirmed changes are applied directly to a scenario without leaving the screen.

### D007 — [PM] Read-only constraint: deliberately extended, origin now confirmed (not inferred)
The canonical workflow HTML states scenarios are "created and edited in Fund Selection only" — a stated invariant, not just an inline-editing-complexity artifact. Origin is now confirmed via project design history (not merely inferred): the constraint existed specifically to avoid repeating fund-row-selection and cost-basis-lot (SpecID) complexity inside Scenario Analysis. Feature 2 deliberately extends past this stated constraint by treating the AI assistant as "an external edit tool, equivalent to a round-trip edit via Fund Selection" — same underlying editing operation, different interface, same completeness requirements (a scenario isn't valid until it reaches the same fully-specified state Manual mode requires). Logged as a deliberate, sourced extension of the original spec, not a compliant reading of undocumented intent.

### D008 — [PD/Dev] Feature 2 capability model: one slot-filling loop, not four tiers
Simple delta modification, new comparative scenario from a base, full specification, and iterative multi-turn clarification (including inline lot-level detail for SpecID) are the same interpret→identify-missing→ask→confirm mechanism at different levels of user-supplied detail — not four separate features to design or build. Named patterns for the case study: slot-filling dialogue (conversational AI) and confirm-before-execute (agentic tool-use safety).

### D009 — [Dev] Feature 2 engine access: shared module only, no duplication
The assistant must call the existing engine module (`dev/src/engine/`) directly and must never reimplement any calculation or business rule (account priority, IRA tax treatment, Wait & Save eligibility, etc.). Architecturally sound because the engine is already a standalone module, not embedded in the Fund Selection component. If assistant-path and Fund-Selection-path outputs ever diverge for identical inputs, that is a defect, not a second valid answer.

### D010 — [PM] Superseded: "delta + redirect to Fund Selection" design for Feature 2
Earlier design had the assistant interpret a delta, show it in-chat, then on confirmation navigate to Fund Selection pre-filled, relying on Fund Selection's existing live recalculation (REQ-B3-002) to do the rest, with the user manually navigating back to Scenario Analysis to save. Superseded by D006/D007 because it added negligible value over the existing manual process — same navigation, same screen, just with an AI-filled starting point. Retained here as a rejected alternative, not deleted, since it clarified the actual constraint (D007) through the process of proposing and testing it.

### D011 — [PM] Badge/provenance model
Three independent signals, not one badge doing double duty:
- "System recommendation — [priority]" — existing, compound, states how the *numbers* were derived (optimizer-driven, with active priority).
- "AI-assisted" — new, compound-format, orthogonal, states how the *input* was captured (assistant-constructed/modified), required by CD-1.2 disclosure regardless of whether the resulting scenario is fund-specific or objective-driven.
- Absence of both badges = fully manual. No "Custom" label exists in shipped UI (confirmed via design-history source: "no pill badge (custom scenario, not system recommendation)" — "Custom" was internal shorthand for badge absence, never UI text).

### D012 — [PM] Scenario mode-tagging logic
Scenarios are mode-agnostic once saved (confirmed live: "No mode toggle here"). An objective-driven what-if prompt ("optimize for lower tax") maps onto the Tax-first/Balance-first optimization-priority toggle (confirmed as a live, user-facing control in Fund Selection), not onto the Automated/Manual mode toggle.

### D013 — [PM/PD] Terminology resolved via triple cross-check
"Review order" confirmed canonical (Fund Selection and Scenario Analysis both) via live app screenshots, canonical workflow HTML, and `pd/CLAUDE.md`'s own terminology table (explicitly lists itself as replacing "Proceed"/"Execute"/"Select this scenario"). Design-history chat excerpts showing "Execute"/"Proceed" reflect a mid-project design that did not ship — noted explicitly per user instruction not to assume mid-thread excerpts reflect final decisions.

### D014 — [PM] Context artifact shape: single file, role-tagged log, no phase files carried forward
Single root `CLAUDE.md` (this file's companion), single `DECISIONS.md`. Original `pm/CLAUDE.md`, `pd/CLAUDE.md`, `dev/CLAUDE.md` are not carried into the new repository — content worth keeping is merged into the new `CLAUDE.md` by content type (constraints, glossary, design-system rules), not by original authoring role; content that was specific to producing the original Figma/screens (file keys, Jira IDs, branch strategy, MCP reading discipline) is dropped as inapplicable, since this project extends the existing build rather than reproducing it. The original project's repository remains untouched and complete as historical reference if ever needed. No cross-repo references belong in the new `CLAUDE.md` — the relationship between projects is a portfolio-narrative concern, external to this artifact.

### D015 — [Dev] `pd/CLAUDE.md` sample dataset flagged stale
`pd/CLAUDE.md`'s canonical sample data section predates dataset corrections documented in `dev/CLAUDE.md`. Specific deltas logged in `CLAUDE.md` §10. `dev/CLAUDE.md`'s figures are authoritative; `pd/CLAUDE.md`'s are not carried forward.

### D016 — [PD] Design tokens: pulled on demand, not embedded wholesale
Decided against embedding the full PDB 05 token/component table into `CLAUDE.md` preemptively — would dilute the one file meant to stay fully readable every session, and would commit to unverified values at scale in a project with a documented track record of Notion-vs-live drift. Tokens are looked up individually when a specific new UI element is actually being built, preferring the live app over PDB 05 when they disagree.

### D017 — [PD] Visual precedent hierarchy for new UI elements
For any new visual element (AI-assisted badge, assistant panel): check PDB 05 / the live previous-project app first, since that's the actual implementation being extended. `pd/reference-screenshots/` (real Vanguard.com) is inspiration-only fallback, not a source of truth — those screenshots were themselves just an input to the original design-system creation, and the original project may have intentionally diverged from them.

### D018 — [PM] Local working folder renamed
Local folder for this project: `/c/Users/micha/Documents/vanguard-ai-enabled/` (not `vanguard-ai-pipeline`, which remains the untouched original project's folder).

### D019 — [PM] Tooling: Claude Code as primary planning + execution surface going forward
Claude Code, once connected to the same Notion MCP endpoint used in this planning conversation, is a functional superset of Claude Chat for this project's remaining work — it adds real local filesystem/git access that Chat categorically lacks, at the cost of no built-in cross-session memory search, which `CLAUDE.md` + `DECISIONS.md` are designed to substitute for structurally. The transition artifact is these two files, read fresh each session per Claude Code's `CLAUDE.md` convention — not a transcript dump of the planning conversation, which would reintroduce unstructured, unfiltered context of exactly the kind this project exists to eliminate. The discipline requirement (write decisions before ending a session) still applies inside a single-tool workflow — the tool change removes the cross-tool relay failure mode, not the need for the discipline itself.

### D020 — [Dev] Repo bootstrapped: history-stripped snapshot from `vanguard-ai-pipeline`
Cloned the local `vanguard-ai-pipeline` repo (`C:\Users\micha\Documents\vanguard-ai-pipeline`, confirmed as the sibling original-project folder per D018) into a scratch temp dir, deleted its `.git` entirely, then constructed this repo's first commit from a filtered subset rather than the full stripped tree — copying only `dev/` (in full, minus `dev/CLAUDE.md`) and `pd/reference-screenshots/` into `vanguard-ai-enabled`, then `git init` + commit. Left out, deliberately: `pm/` (all), `pd/` except `reference-screenshots/` (its `CLAUDE.md`, `DECISIONS.md`, `DEV_HANDOFF_PROMPT.md`, `FIGMA_DESIGN_SYSTEM_DEPRECATED.md`, `Prototype-A.png`, `Prototype-B.png`, `README.md`, `vanguard-design-system.html`), the old root `CLAUDE.md`/`README.md`/`ai_pipeline.html`/`five_planes_ux.svg`/`portfolio_handoff.md`/`retrospective.md`, `.github/workflows/deploy.yml`, and the root-level `.claude/launch.json` (kept `dev/.claude/launch.json` since it's inside `dev/` "in full" and is what a dev-server preview needs; the root one duplicated it one level up and wasn't part of either named bring-forward item, so it was dropped as an asymmetric but deliberate call — flagging in case that reads as inconsistent later). Also added a new top-level `.gitignore` (node_modules/dist/build/.vite/test-results/env files/OS cruft) since this is a fresh repo that needs one to stay clean under `npm install` — not copied wholesale from the original's root `.gitignore` (which referenced now-irrelevant paths like `pd/Prototype-A.png`), written lean for what this repo actually contains. No remote created — stopped after the local commit per instruction, pending user confirmation before any push.

### D021 — [Dev] Discrepancy found: `pd/reference-screenshots/` is untracked in the source repo
`vanguard-ai-pipeline/pd/.gitignore` explicitly ignores `reference-screenshots/` — the folder exists on disk (40 files, ~5.5MB) but was never committed there. A plain `git clone` of the original repo therefore does *not* bring it forward, even though CLAUDE.md §9/§1 and this session's task both treat it as in-scope content to carry over. Worked around by copying the folder directly from the source working tree (filesystem copy) rather than from git history. Logging this so a future session doesn't mistake the screenshots' absence-from-history as a reason they're missing here, or re-derive this workaround from scratch.

### D022 — [Dev] Notion MCP: pre-existing authenticated connector found; freshly-added one is inert
Ran `claude mcp add --transport http notion https://mcp.notion.com/mcp` per instruction. `claude mcp list` shows it registered but "Needs authentication." However, this session already had a *separate*, already-authenticated Notion connector available (tools prefixed `mcp__7e2a7ae2-32e3-413f-8491-f272955e6754__notion-*`, not shown in `claude mcp list`'s output) — verified live by calling its `notion-search` for "PRD 04," which returned real workspace results including "04 — User journeys," "Vanguard Sell & Rebalance — PRD," "Vanguard Sell & Rebalance — PDB," and "09 — PD decisions log." So Notion access for PRD 04 / PRD 11 / PDB 05 lookups is functional right now via that connector; the newly `mcp add`-ed entry is currently redundant/unauthenticated and not needed unless the user wants to consolidate onto a single named connector (unclear whether the working one is session-scoped or will persist — worth confirming in a future session before relying on it being there by default).
