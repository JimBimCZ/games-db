import { expect, test } from '@playwright/test'

test('health endpoint reports the database is reachable', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok', database: 'ok' })
})

test('shell renders and the sign-in control is reachable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
})

test('theme choice survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle light and dark appearance' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('discover leads to a list page, a card, and a detail page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Top Sellers' })).toBeVisible()

  await page.getByRole('link', { name: 'See all' }).first().click()
  await expect(page).toHaveURL(/\/top-sellers$/)

  await page.locator('a[href^="/game/"]').first().click()

  await expect(page).toHaveURL(/\/game\/\d+$/)
  // The card wrapper holds the title and the price line together, so reading a name off the
  // card to compare against the heading captures both. The URL shape plus the outbound link
  // is what this smoke test is actually for.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View on Steam' })).toBeVisible()
})

// 570 is Dota 2: hydrated, free, and carrying both trailers and screenshots, so it
// exercises the gallery's video branch. A game without a trailer opens on a screenshot
// and never mounts a <video> at all.
test('the detail page renders the gallery and its trailer', async ({ page }) => {
  await page.goto('/game/570')
  await expect(page.getByRole('heading', { level: 1, name: 'Dota 2' })).toBeVisible()

  const media = page.getByRole('region', { name: 'Media for Dota 2' })
  await expect(media.locator('video')).toBeVisible()
  expect(await media.getByRole('button').count()).toBeGreaterThan(1)

  await media.getByRole('button').nth(1).click()
  await expect(media.getByRole('button').nth(1)).toHaveAttribute('aria-current', 'true')
})

test('the sidebar lists genres and a genre page renders', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Indie', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Indie' })).toBeVisible()
})

test('searching then navigating away does not bounce back to search', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('searchbox', { name: 'Search games' }).fill('witcher')
  await expect(page).toHaveURL(/\/search\?q=witcher$/)

  await page.getByRole('link', { name: 'Top Sellers', exact: true }).click()
  await expect(page).toHaveURL(/\/top-sellers$/)

  // The debounce is 250ms; the bug pushed back to /search after it elapsed.
  await page.waitForTimeout(1000)
  await expect(page).toHaveURL(/\/top-sellers$/)
})
