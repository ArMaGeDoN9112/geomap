import { expect, test } from '@playwright/test'

const mapCanvas = (page) => page.getByLabel('Интерактивная карта России')
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

async function lakePoint(page, id, inset = 1) {
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
    const point = await lakePoint(page, id, inset)
    if (point && area.width > 70) return point
    const visible = await lakePoint(page, id, 0)
    await page.mouse.move(visible?.x ?? area.x + area.width / 2, visible?.y ?? area.y + area.height / 2)
    await page.mouse.wheel(0, -1800)
    await expect.poll(async () => (await path.boundingBox()).width).toBeGreaterThan(area.width)
  }
  const point = await lakePoint(page, id, inset)
  expect(point).not.toBeNull()
  return point
}

test('desktop study, share, first answer, full results, repeat and exit', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openStudy(page)
  const map = mapCanvas(page)
  const baikal = await lakePoint(page, 'baikal')
  expect(baikal).not.toBeNull()
  await page.mouse.move(baikal.x, baikal.y)
  await expect(page.getByRole('tooltip')).toHaveText('Байкал')
  await page.getByRole('button', { name: 'Поделиться списком' }).click()
  await expect(page.getByRole('status')).toHaveText('Ссылка скопирована')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/russia$/)
  await start(page, 'Анна')

  const toggle = page.getByRole('switch', { name: 'Подсветка контуров' })
  await expect(toggle).not.toBeChecked()
  const beforeHighlight = await lakePoint(page, 'baikal')
  expect(beforeHighlight).not.toBeNull()
  await page.mouse.move(beforeHighlight.x, beforeHighlight.y)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(outlines(page, '#125b50')).toHaveCount(0)
  await toggle.click()
  const afterHighlight = await lakePoint(page, 'baikal')
  expect(afterHighlight).not.toBeNull()
  await page.mouse.move(afterHighlight.x, afterHighlight.y)
  await expect(outlines(page, '#125b50')).toHaveCount(1)
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
  for (let number = 1; number <= 11; number++) {
    await expect(page.getByText(`Задание ${number} из 11`, { exact: true })).toBeVisible()
    const prompt = await page.getByRole('heading', { name: /^Покажи/ }).textContent()
    prompts.add(prompt)
    if (prompt === 'Покажи Байкал') {
      const point = await zoomToObject(page, 'baikal', 5)
      await page.mouse.click(point.x, point.y)
      await expect(page.getByText('Верно!', { exact: true })).toBeVisible()
    } else {
      const area = await map.boundingBox()
      await page.mouse.click(area.x + 70, area.y + 75)
      await expect(page.getByText(/Расстояние до объекта · .*км/)).toBeVisible()
      await expect(outlines(page, '#af4a23')).toHaveCount(1)
    }
    await map.click({ position: { x: 70, y: 75 } })
    expect(submissions).toBe(number)
    await page.getByRole('button', { name: number === 11 ? 'Показать результат' : 'Следующее задание' }).click()
  }
  expect(prompts.size).toBe(11)
  await expect(page.getByRole('heading', { name: 'Результат тренировки' })).toBeVisible()
  await expect(page.getByText('Анна', { exact: true })).toBeVisible()
  await expect(page.locator('.score')).toHaveText('1 / 11')
  await expect(page.getByRole('listitem')).toHaveCount(10)
  await expect(page.getByRole('listitem').filter({ hasText: 'Байкал' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Пройти ещё раз' }).click()
  const request = page.waitForRequest((request) => request.url().endsWith('/training') && request.method() === 'POST')
  await page.getByRole('dialog').getByRole('button', { name: 'Начать', exact: true }).click()
  await request
  await expect(page.getByText('Задание 1 из 11', { exact: true })).toBeVisible()
  await expect(toggle).not.toBeChecked()
  await page.getByRole('button', { name: 'К изучению' }).click()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByText('Задание 1 из 11', { exact: true })).toBeVisible()
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

test.describe('touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 })

  test('tap shows a name, gestures do not submit, and a moved marker can hit the Neva', async ({ page, context }) => {
    await openStudy(page)
    const map = mapCanvas(page)
    const baikal = await zoomToObject(page, 'baikal')
    await page.touchscreen.tap(baikal.x, baikal.y)
    await expect(page.getByRole('tooltip')).toHaveText('Байкал')
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

    for (let number = 1; number <= 11; number++) {
      await expect(page.getByText(`Задание ${number} из 11`, { exact: true })).toBeVisible()
      if (await page.getByRole('heading', { name: /^Покажи/ }).textContent() === 'Покажи основное русло Невы') break
      expect(number).toBeLessThan(11)
      await map.tap({ position: { x: 70, y: 75 } })
      await submit.tap()
      await page.getByRole('button', { name: 'Следующее задание' }).tap()
    }
    await page.getByRole('button', { name: 'Показать всю карту' }).tap()
    await map.tap({ position: { x: 70, y: 75 } })
    await expect(submit).toBeEnabled()
    const before = submissions
    const neva = await zoomToObject(page, 'neva', 4)
    await page.touchscreen.tap(neva.x, neva.y)
    expect(submissions).toBe(before)
    const toggle = page.getByRole('switch', { name: 'Подсветка контуров' })
    await toggle.tap()
    await expect(outlines(page, '#125b50')).toHaveCount(1)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await submit.tap()
    await expect(page.getByText('Верно!', { exact: true })).toBeVisible()
    expect(submissions).toBe(before + 1)
  })
})
