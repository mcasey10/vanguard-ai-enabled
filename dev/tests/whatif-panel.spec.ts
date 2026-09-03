/**
 * Feature 2 UI — dev/tests/whatif-panel.spec.ts
 *
 * The first end-to-end test of the whole conversational loop through the
 * real UI, not just backend logic in isolation (Vitest's whatIf.test.ts
 * already covers the backend exhaustively — see DECISIONS.md D054/D055).
 *
 * Mocks only the network boundary to the interpreter API (/api/interpret),
 * same policy as the rest of this project's tests (CLAUDE.md §7, D038 rule
 * 4): no live provider call. Everything else — the real panel component,
 * the real validator, the real engine, the real scenario builder, the real
 * store — runs for real.
 *
 * Run with: npx playwright test
 * Requires: dev server running at localhost:5173
 */

import { test, expect } from '@playwright/test'

test.describe('What-if assistant panel', () => {
  test('full interaction: open panel → send request → confirm → scenario added with AI-assisted badge', async ({ page }) => {
    // Mock only the interpreter call — a clean, unambiguous fund-specific
    // request, mirroring whatIf.test.ts's category 1 fixture.
    await page.route('**/api/interpret', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'confirm',
          candidate: {
            mode: 'manual',
            targetSaleAmount: 5000,
            manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] },
          },
          summary: 'Sell $5,000.00 of VTSAX using MinTax.',
        }),
      })
    })

    await page.goto('/scenarios')

    // Scenario Analysis seeds 3 canonical demo scenarios on mount — the
    // header-level Scenario assistant trigger (D066) is always visible
    // regardless of count, but confirming a NEW scenario still needs a free
    // slot (the 3-scenario cap check inside handleConfirm), so delete one.
    await page.getByRole('button', { name: 'More options' }).first().click()
    await page.getByRole('button', { name: 'Delete scenario' }).click()
    await page.getByRole('button', { name: 'Delete' }).click()

    // Open the assistant panel from its real, header-level trigger (D066).
    // exact: true — "Modify with Scenario assistant" would otherwise also match.
    await page.getByRole('button', { name: 'Scenario assistant', exact: true }).click()
    await expect(page.getByText('AI-generated interpretations — review each request before confirming.')).toBeVisible()

    // Send a real utterance through the real input.
    await page.getByPlaceholder("Tell the Scenario assistant what you'd like to do…").fill('Sell $5,000 of VTSAX')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    // The mocked interpreter's plain-language summary renders as a confirm card.
    await expect(page.getByText('Sell $5,000.00 of VTSAX using MinTax.')).toBeVisible({ timeout: 5000 })

    // Confirm — this calls the REAL validator and the REAL engine (no mock
    // beyond the interpreter call above), producing a real MinTax result.
    await page.getByRole('button', { name: 'Confirm' }).click()

    // The real engine picks lot T-VTSAX-08 for this exact sale (verified
    // independently against real dataset lots — DECISIONS.md D046), producing
    // a real, non-zero tax figure — not a guessed or hand-typed one.
    await expect(page.getByText('Added to Scenario Analysis')).toBeVisible()
    await expect(page.getByText('AI-assisted — Custom')).toBeVisible()
    await expect(page.getByText('$105.78').first()).toBeVisible()
  })

  test('segmented control: selecting a scenario updates it in place, does not add a new column (DECISIONS.md D064, re-platformed onto the segmented control in D067)', async ({ page }) => {
    // A different fund/amount than the seeded canonical Scenario 1 (VTSAX
    // $15,000 + VBTLX $10,000), so "updated in place" is unambiguous —
    // whatever appears after confirming has to be this new sale, not a
    // stale render of the original.
    await page.route('**/api/interpret', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'confirm',
          candidate: {
            mode: 'manual',
            targetSaleAmount: 22000,
            manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 22000 }] },
          },
          summary: 'Sell $22,000.00 of VTSAX using MinTax, updating this scenario.',
        }),
      })
    })

    await page.goto('/scenarios')

    // 3 canonical scenarios are already seeded — count stays 3 the whole
    // way through this test, since a modify-in-place never adds a column.
    await expect(page.locator('text=/^SCENARIO \\d$/')).toHaveCount(3)

    // Per-scenario "Modify with Scenario assistant" links are gone (D067) —
    // the header button is the only launch point now.
    await expect(page.getByRole('button', { name: 'Modify with Scenario assistant' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Scenario assistant', exact: true }).click()

    // "New" is the default selection — no summary card yet, generic greeting.
    await expect(page.getByText(/Tell me what you.d like to do/)).toBeVisible()

    // Select Scenario 1 in the in-panel segmented control.
    await page.getByRole('button', { name: 'Scenario 1', exact: true }).click()
    await expect(page.getByText(/Modifying Scenario 1/)).toBeVisible()

    // The summary card reorients the user to what's being modified — real
    // seeded Scenario 1 data (VTSAX + VBTLX, Taxable Brokerage, $25,000
    // total). "Taxable Brokerage" also appears elsewhere on the underlying
    // page (the header strip, each scenario column's own label), so this is
    // scoped to the summary card's own test id, not a bare text match.
    const summaryCard = page.getByTestId('whatif-summary-card')
    await expect(summaryCard).toContainText('VTSAX, VBTLX')
    await expect(summaryCard).toContainText('Taxable Brokerage')

    await page.getByPlaceholder("Tell the Scenario assistant what you'd like to do…").fill('Sell $22,000 of VTSAX instead')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Sell $22,000.00 of VTSAX using MinTax, updating this scenario.')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('Updated Scenario 1 in Scenario Analysis.')).toBeVisible()

    // Still 3 scenarios — Scenario 1 was replaced, not appended to.
    await expect(page.locator('text=/^SCENARIO \\d$/')).toHaveCount(3)
    // Scenario 1's own real fund_selections now reflect the new $22,000
    // sale, and it carries the AI-assisted badge (the modification touched
    // it, even though its source_mode was originally 'automated').
    await expect(page.getByText('$22,000.00').first()).toBeVisible()
    await expect(page.getByText('AI-assisted').first()).toBeVisible()
  })

  test('segmented control: switching selection clears in-progress conversation and toggles the summary card (D067, item 2/3)', async ({ page }) => {
    await page.goto('/scenarios')
    await page.getByRole('button', { name: 'Scenario assistant', exact: true }).click()

    const summaryCard = page.getByTestId('whatif-summary-card')
    const panel = page.getByTestId('whatif-panel')

    // Type a partial request under "New" without sending it — this is the
    // in-progress state that must not bleed into Scenario 1's conversation.
    const draft = 'Sell some VTIAX'
    await page.getByPlaceholder("Tell the Scenario assistant what you'd like to do…").fill(draft)
    await expect(page.getByPlaceholder("Tell the Scenario assistant what you'd like to do…")).toHaveValue(draft)

    // No summary card under "New" — nothing yet to summarize.
    await expect(summaryCard).toHaveCount(0)

    // Switch to Scenario 2 (seeded: VTSAX + VTIAX, Taxable Brokerage).
    await page.getByRole('button', { name: 'Scenario 2', exact: true }).click()

    // The draft input is cleared, not carried over into the new context.
    await expect(page.getByPlaceholder("Tell the Scenario assistant what you'd like to do…")).toHaveValue('')
    // The conversation reset to a fresh greeting for Scenario 2 — the old
    // "New"-context draft text is nowhere in the panel's message log either.
    await expect(panel.getByText(/Modifying Scenario 2/)).toBeVisible()
    await expect(panel.getByText(draft)).toHaveCount(0)
    // The summary card now appears, showing Scenario 2's real data.
    await expect(summaryCard).toContainText('VTSAX, VTIAX')
    await expect(summaryCard).toContainText('Taxable Brokerage')

    // Switching back to "New" clears the conversation again and hides the card.
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(panel.getByText(/Tell me what you.d like to do/)).toBeVisible()
    await expect(panel.getByText(/Modifying Scenario/)).toHaveCount(0)
    await expect(summaryCard).toHaveCount(0)
  })

  test('close confirmation (D076): closing with an unsent draft prompts before discarding; closing with nothing typed does not', async ({ page }) => {
    await page.goto('/scenarios')
    await page.getByRole('button', { name: 'Scenario assistant', exact: true }).click()

    // Closing a freshly-opened panel (nothing typed, nothing sent) closes
    // immediately — no prompt for a conversation that was never started.
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByText('Discard this conversation?')).toHaveCount(0)
    await expect(page.getByTestId('whatif-panel')).toHaveCount(0)

    // Re-open, type an unsent draft, attempt to close — must prompt.
    await page.getByRole('button', { name: 'Scenario assistant', exact: true }).click()
    const draft = 'Sell $5,000 of VTSAX'
    await page.getByPlaceholder("Tell the Scenario assistant what you'd like to do…").fill(draft)
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByText('Discard this conversation?')).toBeVisible()

    // "Keep editing" aborts the close — panel stays open, draft preserved.
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await expect(page.getByTestId('whatif-panel')).toBeVisible()
    await expect(page.getByPlaceholder("Tell the Scenario assistant what you'd like to do…")).toHaveValue(draft)

    // "Discard" actually closes it.
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByTestId('whatif-panel')).toHaveCount(0)
  })
})
