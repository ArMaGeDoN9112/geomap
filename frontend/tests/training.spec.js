import { expect, test } from '@playwright/test'

const mapCanvas = (page) => page.getByLabel(/^Интерактивная карта/)
const outlines = (page, color) => mapCanvas(page).locator(`path[stroke="${color}"]`)

async function openStudy(page) {
  await page.goto('/russia')
  await expect(page.getByRole('heading', { name: 'Изучение' })).toBeVisible()
}

async function start(page, name = '') {
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  const dialog = page.getByRole('dialog')
  if (name) await dialog.getByLabel(/Имя/).fill(name)
  await dialog.getByRole('button', { name: 'Начать', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^Покажи/ })).toBeVisible()
}

async function areaPoint(page, id, inset = 1) {
  const path = mapCanvas(page).locator(`path[data-object-id="${id}"]`)
  return path.evaluate((element, inset) => {
    const area = element.getBoundingClientRect()
    for (let y = Math.max(0, Math.ceil(area.top)); y < Math.min(innerHeight, area.bottom); y += 1) {
      for (let x = Math.max(0, Math.ceil(area.left)); x < Math.min(innerWidth, area.right); x += 1) {
        if ([[0, 0], [inset, 0], [-inset, 0], [0, inset], [0, -inset]].every(([dx, dy]) =>
          document.elementFromPoint(x + dx, y + dy) === element)) return { x, y }
      }
    }
    return null
  }, inset)
}

async function zoomToObject(page, id, inset = 1) {
  const map = mapCanvas(page)
  await map.scrollIntoViewIfNeeded()
  const path = map.locator(`path[data-object-id="${id}"]`)
  for (let zoom = 0; zoom < 8; zoom++) {
    const area = await path.boundingBox()
    const point = await areaPoint(page, id, inset)
    if (point && area.width > 70) return point
    const visible = await areaPoint(page, id, 0)
    await page.mouse.move(visible?.x ?? area.x + area.width / 2, visible?.y ?? area.y + area.height / 2)
    await page.mouse.wheel(0, -1800)
    await expect.poll(async () => (await path.boundingBox()).width).toBeGreaterThan(area.width)
  }
  const point = await areaPoint(page, id, inset)
  expect(point).not.toBeNull()
  return point
}

test('desktop study, share, first answer, full results, repeat and exit', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openStudy(page)
  const map = mapCanvas(page)
  const baikal = await areaPoint(page, 'baikal')
  expect(baikal).not.toBeNull()
  await page.mouse.move(baikal.x, baikal.y)
  await expect(page.getByRole('tooltip')).toContainText('Байкал')
  await expect(page.getByRole('tooltip')).toContainText('Озеро · Азия')
  const caucasus = await areaPoint(page, 'mountain:caucasus', 2)
  await page.mouse.move(caucasus.x, caucasus.y)
  await expect(page.getByRole('tooltip')).toContainText(/Высшая точка · Эльбрус, 5\s?642 м/)
  await expect(outlines(page, '#125b50')).toHaveAttribute('fill', 'none')
  await expect(map.locator('img[src="/physical-relief.webp"]').first()).toHaveJSProperty('naturalWidth', 6144)
  await page.getByRole('button', { name: 'Поделиться списком' }).click()
  await expect(page.getByRole('status')).toHaveText('Ссылка скопирована')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/russia$/)
  await start(page, 'Анна')

  const toggle = page.getByRole('switch', { name: 'Подсветка контуров' })
  await expect(toggle).toHaveCount(0)
  await page.mouse.move(baikal.x, baikal.y)
  await expect(outlines(page, '#125b50')).toHaveAttribute('fill', 'none')
  await expect(page.getByRole('tooltip')).toHaveCount(0)

  let submissions = 0
  page.on('request', (request) => { if (request.url().endsWith('/answer')) submissions++ })
  const area = await map.boundingBox()
  await page.mouse.move(area.x + 180, area.y + 160)
  await page.mouse.down()
  await page.mouse.move(area.x + 270, area.y + 200, { steps: 10 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Приблизить', exact: true }).click()
  await page.getByRole('button', { name: 'Показать всю карту' }).click()
  expect(submissions).toBe(0)

  const prompts = new Set()
  for (let number = 1; number <= 12; number++) {
    await expect(page.getByText(`Задание ${number} из 12`, { exact: true })).toBeVisible()
    const prompt = await page.getByRole('heading', { name: /^Покажи/ }).textContent()
    prompts.add(prompt)
    await map.click({ position: { x: 70, y: 35 } })
    await expect(page.getByText(/Расстояние до объекта · .*км/)).toBeVisible()
    await expect(outlines(page, '#af4a23')).toHaveAttribute('fill', 'none')
    await map.click({ position: { x: 70, y: 35 } })
    expect(submissions).toBe(number)
    await page.getByRole('button', { name: number === 12 ? 'Показать результат' : 'Следующее задание' }).click()
  }
  expect(prompts.size).toBe(12)
  await expect(page.getByRole('heading', { name: 'Результат тренировки' })).toBeVisible()
  await expect(page.getByText('Анна', { exact: true })).toBeVisible()
  await expect(page.locator('.score')).toHaveText('0 / 12')
  await expect(page.getByRole('listitem')).toHaveCount(12)

  await page.getByRole('button', { name: 'Пройти ещё раз' }).click()
  const request = page.waitForRequest((request) => request.url().endsWith('/training') && request.method() === 'POST')
  await page.getByRole('dialog').getByRole('button', { name: 'Начать', exact: true }).click()
  await request
  await expect(page.getByText('Задание 1 из 12', { exact: true })).toBeVisible()
  await expect(toggle).toHaveCount(0)
  await page.getByRole('button', { name: 'К изучению' }).click()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByText('Задание 1 из 12', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'К изучению' }).click()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Изучение' })).toBeVisible()

  await start(page)
  const unload = page.waitForEvent('dialog')
  const reload = page.reload()
  const warning = await unload
  expect(warning.type()).toBe('beforeunload')
  await warning.accept()
  await reload
  await expect(page.getByRole('heading', { name: 'Изучение' })).toBeVisible()
  await expect(page).toHaveURL(/\/russia$/)
})

test('political map shows capitals, grades clicks and asks before switching maps', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openStudy(page)
  await page.getByRole('link', { name: 'Политическая', exact: true }).click()
  await expect(page).toHaveURL(/\/world$/)
  await expect(page.getByRole('heading', { name: 'Страны мира' })).toBeVisible()
  const brazil = await areaPoint(page, 'country:bra', 4)
  expect(brazil).not.toBeNull()
  const flagImage = page.waitForResponse((response) => response.url().endsWith('/country-flags.webp'))
  await page.mouse.move(brazil.x, brazil.y)
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toContainText('Бразилия')
  await expect(tooltip).toContainText('Столица · Бразилиа')
  await expect(tooltip).toContainText('Южная Америка')
  await expect(tooltip).toContainText(/Население.*211.*2019/)
  await expect(tooltip.getByRole('img', { name: 'Флаг · Бразилия' })).toBeVisible()
  expect((await flagImage).ok()).toBe(true)
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)

  await page.getByRole('button', { name: 'Поделиться списком' }).click()
  await expect(page.getByRole('status')).toHaveText('Ссылка скопирована')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/world$/)

  await start(page)
  const prompt = await page.getByRole('heading', { name: /^Покажи/ }).textContent()
  const algeria = await areaPoint(page, prompt.includes('Алжир') ? 'country:bra' : 'country:dza', 4)
  expect(algeria).not.toBeNull()
  await page.mouse.move(algeria.x, algeria.y)
  await expect(tooltip).toHaveCount(0)
  await expect(outlines(page, '#125b50')).toHaveCount(0)
  await page.getByRole('switch', { name: 'Подсветка контуров' }).click()
  await page.mouse.move(algeria.x, algeria.y)
  await expect(outlines(page, '#125b50')).toHaveCount(1)
  await page.mouse.click(algeria.x, algeria.y)
  await expect(page.getByText(/Расстояние до объекта · .*км/)).toBeVisible()
  await expect(outlines(page, '#af4a23')).toHaveCount(1)

  const physicalMap = page.getByRole('link', { name: 'Физическая', exact: true })
  await physicalMap.click()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByText('Задание 1 из 12')).toBeVisible()
  await physicalMap.click()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(/\/russia$/)
  await expect(page.getByRole('heading', { name: 'Изучение' })).toBeVisible()
})

for (const [route, category, shown, hidden, antarcticCount] of [
  ['/russia', 'africa', 'water', 'baikal', '7'],
  ['/world', 'south-america', 'country:bra', 'country:chn', '1'],
]) {
  test(`selects a category and exercise count on ${route}`, async ({ page }) => {
    await page.goto(route)
    const start = page.getByRole('button', { name: 'Начать тренировку', exact: true })
    await expect(start).toBeEnabled()
    await expect(page.getByLabel('Категория')).toHaveCount(0)
    await start.click()
    const dialog = page.getByRole('dialog', { name: 'Начать тренировку' })
    const select = dialog.getByLabel('Категория')
    const count = dialog.getByLabel('Количество заданий')
    await select.selectOption('antarctica')
    await expect(count).toHaveAttribute('max', antarcticCount)
    await select.selectOption(category)
    await expect(page).toHaveURL(new RegExp(`category=${category}$`))
    await count.fill('3')
    await dialog.getByRole('button', { name: 'Начать', exact: true }).click()
    await expect(page.getByText('Задание 1 из 3', { exact: true })).toBeVisible()
    await expect(mapCanvas(page).locator(`[data-object-id^="${shown}"]`).first()).toBeAttached()
    await expect(mapCanvas(page).locator(`[data-object-id="${hidden}"]`)).toHaveCount(0)
  })
}

test.describe('touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 })

  test('political map shows capitals on tap and waits for confirmation', async ({ page }) => {
    await page.goto('/world')
    await expect(page.getByRole('heading', { name: 'Изучение' })).toBeVisible()
    const map = mapCanvas(page)
    await map.scrollIntoViewIfNeeded()
    const brazil = await areaPoint(page, 'country:bra', 4)
    expect(brazil).not.toBeNull()
    await page.touchscreen.tap(brazil.x, brazil.y)
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toContainText('Столица · Бразилиа')
    await expect(tooltip.getByRole('img', { name: 'Флаг · Бразилия' })).toBeVisible()
    await start(page)

    const confirm = page.getByRole('button', { name: 'Подтвердить' })
    await expect(confirm).toBeDisabled()
    await map.scrollIntoViewIfNeeded()
    const prompt = await page.getByRole('heading', { name: /^Покажи/ }).textContent()
    const algeria = await areaPoint(page, prompt.includes('Алжир') ? 'country:bra' : 'country:dza', 3)
    expect(algeria).not.toBeNull()
    let submissions = 0
    page.on('request', (request) => { if (request.url().endsWith('/answer')) submissions++ })
    await page.touchscreen.tap(algeria.x, algeria.y)
    await expect(confirm).toBeEnabled()
    expect(submissions).toBe(0)
    await confirm.tap()
    await expect(page.getByText(/Расстояние до объекта · .*км/)).toBeVisible()
    expect(submissions).toBe(1)
  })

  test('tap shows a name and moving a marker to the Neva needs confirmation', async ({ page, context }) => {
    await openStudy(page)
    const map = mapCanvas(page)
    const baikal = await zoomToObject(page, 'baikal')
    await page.touchscreen.tap(baikal.x, baikal.y)
    await expect(page.getByRole('tooltip')).toContainText('Байкал')
    await page.getByRole('button', { name: 'Показать всю карту' }).tap()
    await start(page)

    const submit = page.getByRole('button', { name: 'Подтвердить' })
    await expect(submit).toBeDisabled()
    let submissions = 0
    page.on('request', (request) => { if (request.url().endsWith('/answer')) submissions++ })
    await map.scrollIntoViewIfNeeded()
    const area = await map.boundingBox()
    const x = Math.round(area.x + area.width / 2)
    const y = Math.round(area.y + area.height / 2)
    const cdp = await context.newCDPSession(page)
    const touch = (type, positions) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: positions.map((offset, id) => ({ x: x + offset, y, id })),
    })
    const scale = map.locator('.leaflet-control-scale-line')
    const originalScale = await scale.textContent()
    await touch('touchStart', [-22, 22])
    await touch('touchMove', [-64, 64])
    await touch('touchMove', [-110, 110])
    await touch('touchEnd', [])
    await expect(scale).not.toHaveText(originalScale)
    await expect(submit).toBeDisabled()
    await touch('touchStart', [0])
    await touch('touchMove', [-80])
    await touch('touchEnd', [])
    await expect(submit).toBeDisabled()
    expect(submissions).toBe(0)

    await page.getByRole('button', { name: 'Показать всю карту' }).tap()
    await map.tap({ position: { x: 70, y: 75 } })
    await expect(submit).toBeEnabled()
    const neva = await zoomToObject(page, 'neva', 4)
    await page.touchscreen.tap(neva.x, neva.y)
    expect(submissions).toBe(0)
    await expect(outlines(page, '#125b50')).toHaveCount(0)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    const request = page.waitForRequest((request) => request.url().endsWith('/answer'))
    await submit.tap()
    const { longitude, latitude } = (await request).postDataJSON()
    expect(longitude).toBeGreaterThan(30)
    expect(longitude).toBeLessThan(32)
    expect(latitude).toBeCloseTo(60, 0)
    await expect(page.getByText(/^(Верно!|Промах)$/)).toBeVisible()
    expect(submissions).toBe(1)
  })
})
