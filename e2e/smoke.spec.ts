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
  await page.getByRole('button', { name: /Switch to dark appearance/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
