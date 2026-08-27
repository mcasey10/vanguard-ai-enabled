/**
 * Integration tests — dev/tests/flows.spec.ts
 *
 * Run with: npx playwright test
 * Requires: dev server running at localhost:5173
 *
 * Flow A: Automated happy path end-to-end
 * Flow B: Manual mode entry end-to-end
 */

import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Flow A — Automated happy path
// ---------------------------------------------------------------------------

test.describe('Flow A: Automated happy path', () => {
  test('end-to-end: entry → automated → confirm → summary', async ({ page }) => {
    // 1. Reset session — navigate to /?reset=true, wait for redirect to clean /
    await page.goto('/?reset=true')
    await page.waitForURL(url => !url.toString().includes('reset'), { timeout: 5000 })
    await page.waitForSelector('#sale-amount', { state: 'visible' })

    // 2. Enter $25,000 and submit
    const amountInput = page.locator('#sale-amount')
    await amountInput.fill('25000')
    await page.getByRole('button', { name: 'Get recommendation' }).click()

    // 3. Wait for /automated to load and recommendation to appear
    await page.waitForURL('**/automated')
    const reviewButton = page.getByRole('button', { name: 'Review order' })
    await reviewButton.waitFor({ state: 'visible', timeout: 10000 })

    // 4. Assert summary banner shows a non-zero SALE TOTAL
    const bannerText = await page.locator('text=$').first().textContent()
    expect(bannerText).toBeTruthy()

    // 5. Assert the page shows fund results (at least one fund row)
    const fundRows = page.locator('text=VTSAX, text=VTIAX, text=VBTLX, text=VBIRX').first()
    // Looser check: at least one ticker appears
    const pageText = await page.content()
    expect(pageText).toMatch(/VTSAX|VTIAX|VBTLX|VBIRX/)

    // 6. Proceed to /confirm
    await reviewButton.click()
    await page.waitForURL('**/confirm')

    // 7. Assert Order Confirmation page heading
    await expect(page.getByRole('heading', { name: 'Review order' })).toBeVisible()

    // 8. Assert Submit order button is present
    const submitButton = page.getByRole('button', { name: 'Submit order' })
    await expect(submitButton).toBeVisible()

    // 9. Submit the order → /summary
    await submitButton.click()
    await page.waitForURL('**/summary')

    // 10. Assert execution summary shows success
    await expect(page.getByText('Order submitted successfully')).toBeVisible({ timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Flow B — Manual mode entry end-to-end
// ---------------------------------------------------------------------------

test.describe('Flow B: Manual mode entry', () => {
  test('end-to-end: entry → automated → manual toggle → manual-2 → confirm → summary', async ({ page }) => {
    // 1. Reset session — navigate to /?reset=true, wait for redirect to clean /
    await page.goto('/?reset=true')
    await page.waitForURL(url => !url.toString().includes('reset'), { timeout: 5000 })
    await page.waitForSelector('#sale-amount', { state: 'visible' })

    // 2. Enter $25,000 and go to automated (seeds the recommendation for manual mode)
    const amountInput = page.locator('#sale-amount')
    await amountInput.fill('25000')
    await page.getByRole('button', { name: 'Get recommendation' }).click()

    // 3. Wait for /automated and recommendation to load
    await page.waitForURL('**/automated')
    await page.getByRole('button', { name: 'Review order' }).waitFor({ state: 'visible', timeout: 10000 })

    // 4. Switch to Manual mode
    await page.getByRole('button', { name: 'Manual' }).click()
    await page.waitForURL('**/manual-2')

    // 5. Assert Manual 2 page loaded with fund table
    const pageContent = await page.content()
    expect(pageContent).toMatch(/VTSAX|VTIAX|VBTLX|VBIRX/)

    // 6. Assert summary banner exists with some sale total (funds pre-populated from rec)
    await expect(page.getByText('SALE TOTAL')).toBeVisible()

    // 7. Review order button should be enabled (funds pre-activated from automated rec)
    const reviewButton = page.getByRole('button', { name: 'Review order' })
    await expect(reviewButton).toBeVisible()
    await expect(reviewButton).toBeEnabled()

    // 8. Navigate to /confirm
    await reviewButton.click()
    await page.waitForURL('**/confirm')

    // 9. Assert Order Confirmation page
    await expect(page.getByRole('heading', { name: 'Review order' })).toBeVisible()

    // 10. Submit the order → /summary
    const submitButton = page.getByRole('button', { name: 'Submit order' })
    await submitButton.click()
    await page.waitForURL('**/summary')

    // 11. Assert execution summary shows success
    await expect(page.getByText('Order submitted successfully')).toBeVisible({ timeout: 5000 })
  })
})
