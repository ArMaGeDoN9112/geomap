import { expect, test } from '@playwright/test'

test('switches to the globe, rotates it and answers with coordinates', async ({ page }) => {
  await page.goto('/world?category=south-america')
  const flat = page.getByLabel('Интерактивная карта мира')
  const globe = page.getByLabel('Интерактивный глобус')
  const twoD = page.getByRole('button', { name: '2D', exact: true })
  const threeD = page.getByRole('button', { name: '3D', exact: true })
  await expect(twoD).toHaveAttribute('aria-pressed', 'true')
  await expect(flat.locator('path[data-object-id="country:bra"]')).toBeAttached()
  await threeD.click()
  await expect(globe.locator('canvas')).toBeVisible({ timeout: 15_000 })
  const { x, y, width, height } = await globe.boundingBox()
  const center = { x: x + width / 2, y: y + height / 2 }
  const captureGlobe = () => page.screenshot({
    clip: { x: Math.round(center.x - 175), y: Math.round(center.y - 175), width: 350, height: 350 },
  })
  const initial = await captureGlobe()
  await page.mouse.move(center.x, center.y)
  await expect(page.getByRole('tooltip')).toContainText('Бразилия')
  expect((await captureGlobe()).equals(initial)).toBe(false)

  await page.mouse.down()
  await page.mouse.move(center.x + 100, center.y + 20, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  expect((await captureGlobe()).equals(initial)).toBe(false)
  await page.getByRole('button', { name: 'Показать всю карту' }).click()

  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Начать', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^Покажи/ })).toBeVisible()
  await expect(threeD).toHaveAttribute('aria-pressed', 'true')
  const submitted = page.waitForRequest((request) => request.url().endsWith('/answer'))
  await page.mouse.click(center.x, center.y)
  const { latitude, longitude } = (await submitted).postDataJSON()
  expect(latitude).toBeCloseTo(-21.5, 0)
  expect(longitude).toBeCloseTo(-55, 0)
  await expect(page.getByText(/^(Верно!|Промах)$/)).toBeVisible()
  await twoD.click()
  await expect(flat).toBeVisible()
  await expect(page.getByText('Задание 1 из 12')).toBeVisible()
  await expect(page.getByText(/^(Верно!|Промах)$/)).toBeVisible()
})

test.describe('globe on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } })

  test('a tap inspects in study and needs confirmation in training', async ({ page }) => {
    await page.goto('/world?category=south-america')
    await page.getByRole('button', { name: '3D', exact: true }).tap()
    const globe = page.getByRole('region', { name: 'Интерактивный глобус' })
    await expect(globe.locator('canvas')).toBeVisible({ timeout: 15_000 })
    await globe.tap()
    await expect(page.getByRole('tooltip')).toContainText('Бразилия')
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).tap()
    await page.getByRole('dialog').getByRole('button', { name: 'Начать', exact: true }).tap()

    const confirm = page.getByRole('button', { name: 'Подтвердить' })
    await expect(confirm).toBeDisabled()
    let submissions = 0
    page.on('request', (request) => { if (request.url().endsWith('/answer')) submissions++ })
    await globe.tap()
    await expect(globe.locator('.globe-pin')).toBeVisible()
    await expect(confirm).toBeEnabled()
    expect(submissions).toBe(0)
    await confirm.tap()
    await expect(page.getByText(/^(Верно!|Промах)$/)).toBeVisible()
    expect(submissions).toBe(1)
  })
})
