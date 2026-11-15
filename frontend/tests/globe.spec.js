import { expect, test } from '@playwright/test'

test('loads detailed satellite tiles in both physical map views', async ({ page }) => {
  await page.goto('/russia?category=south-america')
  const tile = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')
    context.fillStyle = '#df3690'
    context.fillRect(0, 0, 256, 256)
    return canvas.toDataURL().split(',')[1]
  })
  const levels = new Set()
  let release
  const held = new Promise((resolve) => { release = resolve })
  await page.route('https://tiles.maps.eox.at/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.includes('/WGS84/')) {
      levels.add(Number(path.split('/').at(-3)))
      await held
    }
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(tile, 'base64'), headers: { 'access-control-allow-origin': '*' } })
  })
  const overview = page.waitForResponse((response) => response.url().endsWith('/globe-satellite.jpg'))
  const flat = page.getByLabel('Интерактивная карта мира')
  await expect(flat).toBeVisible()
  const flatArea = await flat.boundingBox()
  const zoom = page.getByRole('button', { name: 'Приблизить' })
  for (let click = 0; click < 3; click++) await zoom.click()
  await expect(flat.locator('img.leaflet-tile-loaded').first()).toHaveJSProperty('naturalWidth', 256)
  await page.getByRole('button', { name: '3D', exact: true }).click()
  const globe = page.getByRole('region', { name: 'Интерактивный глобус' })
  await expect(globe.locator('canvas')).toBeVisible({ timeout: 15_000 })
  expect((await overview).ok()).toBe(true)
  expect(await globe.boundingBox()).toEqual(flatArea)
  expect(levels.size).toBe(0)
  for (let click = 0; click < 4; click++) await zoom.click()
  await expect.poll(() => levels.size).toBe(1)
  await zoom.click()
  await expect.poll(() => levels.size).toBe(2)
  const [lower, higher] = levels
  expect(higher).toBeGreaterThan(lower)
  const before = await globe.screenshot()
  release()
  await expect.poll(async () => (await globe.screenshot()).equals(before)).toBe(false)
})

test('switches to the globe, rotates it and answers with coordinates', async ({ page }) => {
  const satelliteRequests = []
  page.on('request', (request) => {
    if (request.url().includes('tiles.maps.eox.at') || request.url().endsWith('/globe-satellite.jpg')) {
      satelliteRequests.push(request.url())
    }
  })
  await page.goto('/world?category=south-america')
  const flat = page.getByLabel('Интерактивная карта мира')
  const globe = page.getByLabel('Интерактивный глобус')
  const twoD = page.getByRole('button', { name: '2D', exact: true })
  const threeD = page.getByRole('button', { name: '3D', exact: true })
  const panel = page.getByRole('complementary', { name: 'Изучение' })
  await expect(twoD).toHaveAttribute('aria-pressed', 'true')
  await expect(flat.locator('path[data-object-id="country:bra"]')).toBeAttached()
  await expect(panel.getByRole('group', { name: 'Управление картой' })).toBeVisible()
  const relief = page.waitForResponse((response) => response.url().endsWith('/physical-relief.webp'))
  const flatArea = await flat.boundingBox()
  await threeD.click()
  await expect(globe.locator('canvas')).toBeVisible({ timeout: 15_000 })
  expect((await relief).ok()).toBe(true)
  await expect(panel.getByRole('group', { name: 'Управление картой' })).toBeVisible()
  const { x, y, width, height } = await globe.boundingBox()
  const panelArea = await panel.boundingBox()
  expect({ x, y, width, height }).toEqual(flatArea)
  expect(height).toBeGreaterThan(page.viewportSize().height * 0.75)
  expect(panelArea.x).toBeGreaterThanOrEqual(x + width)
  await expect(panel.getByRole('button', { name: '3D', exact: true })).toBeFocused()
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
  const zoom = page.getByRole('button', { name: 'Приблизить' })
  for (let click = 0; click < 5; click++) await zoom.click()
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x - 100, center.y, { steps: 5 })
  await page.mouse.up()
  const submitted = page.waitForRequest((request) => request.url().endsWith('/answer'))
  await page.mouse.click(center.x, center.y)
  const { latitude, longitude } = (await submitted).postDataJSON()
  expect(satelliteRequests).toEqual([])
  expect(latitude).toBeCloseTo(-21.5, 0)
  expect(longitude).toBeGreaterThan(-54.5)
  expect(longitude).toBeLessThan(-52)
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize().width)
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
