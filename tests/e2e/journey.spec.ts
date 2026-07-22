import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const BUSINESS_DESCRIPTION =
  'У меня один магазин помидоров в Алматы, продаём свежие овощи розничным клиентам'
const MEASURABLE_GOAL =
  'Хочу открыть пять магазинов за 12 месяцев'
const HONOR_COMMERCE_DESCRIPTION =
  'HONOR — интернет-магазин outdoor-одежды для охоты, рыбалки и outdoor в Казахстане'
const HONOR_COMMERCE_GOAL =
  'Хочу увеличить выручку до 50 млн ₸ за 6 месяцев'

async function sendChatMessage(page: Page, message: string) {
  const composer = page.getByRole('textbox', { name: 'Сообщение AI' })
  await expect(composer).toBeVisible()
  await composer.fill(message)
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(composer).toHaveValue('')
}

async function selectMobileSurface(page: Page, name: RegExp) {
  const isMobile = await page.evaluate(() => window.matchMedia('(max-width: 767px)').matches)
  if (!isMobile) return
  const tab = page.getByRole('tab', { name }).first()
  await expect(tab).toBeVisible()
  await tab.click()
}

async function takeJourneyScreenshot(page: Page, testInfo: TestInfo, stage: string) {
  const directory = path.resolve(process.cwd(), 'artifacts/journey')
  await mkdir(directory, { recursive: true })
  await page.screenshot({
    path: path.join(directory, `${testInfo.project.name}-${stage}.png`),
    fullPage: true,
  })
}

async function expectNoHorizontalViewportOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))

  expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 2)
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 2)
}

async function openDesktopModuleDock(page: Page) {
  const trigger = page.getByRole('button', { name: 'Открыть стек AI-модулей' })
  if (await trigger.isVisible()) await trigger.click()
  const dock = page.getByRole('complementary', { name: 'Стек AI-модулей', exact: true })
  await expect(dock).toBeVisible()
  return dock
}

async function waitForWidgetPersistence(
  page: Page,
  ids: { collapsed: string; focused: string; hidden: string },
) {
  await expect
    .poll(() =>
      page.evaluate(({ collapsed, focused, hidden }) => {
        const baseKey = 'aistart360:journey:state:v1'
        const identity = JSON.parse(
          window.localStorage.getItem('aistart360:journey:identity:v1') ?? 'null',
        ) as { workspaceId?: unknown } | null
        const workspaceId = typeof identity?.workspaceId === 'string' ? identity.workspaceId : ''
        const raw = (workspaceId && window.localStorage.getItem(`${baseKey}:${workspaceId}`))
          || window.localStorage.getItem(baseKey)
        if (!raw) return false
        try {
          const parsed = JSON.parse(raw) as {
            widgets?: Array<{
              id?: string
              collapsed?: boolean
              focused?: boolean
              hidden?: boolean
            }>
          }
          const widgets = parsed.widgets ?? []
          return (
            widgets.some((widget) => widget.id === collapsed && widget.collapsed) &&
            widgets.some((widget) => widget.id === focused && widget.focused) &&
            widgets.some((widget) => widget.id === hidden && widget.hidden)
          )
        } catch {
          return false
        }
      }, ids),
    )
    .toBe(true)
}

async function waitForWidgetLayout(
  page: Page,
  id: string,
  position: { x: number; y: number },
) {
  await expect.poll(() => page.evaluate(({ widgetId, expected }) => {
    const baseKey = 'aistart360:journey:state:v1'
    const identity = JSON.parse(
      window.localStorage.getItem('aistart360:journey:identity:v1') ?? 'null',
    ) as { workspaceId?: unknown } | null
    const workspaceId = typeof identity?.workspaceId === 'string' ? identity.workspaceId : ''
    const raw = (workspaceId && window.localStorage.getItem(`${baseKey}:${workspaceId}`))
      || window.localStorage.getItem(baseKey)
    if (!raw) return false
    try {
      const parsed = JSON.parse(raw) as {
        manualWidgetIds?: string[]
        widgets?: Array<{ id?: string; position?: { x?: number; y?: number } }>
      }
      const widget = parsed.widgets?.find((item) => item.id === widgetId)
      return parsed.manualWidgetIds?.includes(widgetId) === true
        && widget?.position?.x === expected.x
        && widget?.position?.y === expected.y
    } catch {
      return false
    }
  }, { widgetId: id, expected: position })).toBe(true)
}

test.describe('AI-first workspace journey', () => {
  test('direct HONOR demo link loads an isolated commerce journey without invented KPIs', async ({
    page,
  }) => {
    const pageErrors: string[] = []
    const journeyApiRequests: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/v1/journey')) journeyApiRequests.push(url.pathname)
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })

    // Install this before the first Journey document so the direct link keeps
    // its query string while starting from an empty browser store.
    await page.addInitScript(() => window.localStorage.clear())
    await page.goto('/journey?demo=honor')
    await expect(page).toHaveURL(/\/journey\/?\?demo=honor$/)

    const workspace = page.locator('[data-demo-scenario="honor"]')
    await expect(workspace).toBeVisible()
    await expect(page.getByTestId('demo-project-banner')).toBeVisible()
    await expect(page.getByTestId('demo-project-banner')).toContainText(/HONOR/i)
    await expect(page.getByRole('button', { name: 'Подключить другое устройство' })).toHaveCount(0)

    const pointA = page.getByTestId('point-a')
    const pointB = page.getByTestId('point-b')
    const roadmap = page.getByTestId('journey-roadmap')
    await expect(pointA).toBeVisible()
    await expect(pointA).toContainText(/HONOR/i)
    await expect(pointA).toContainText(/интернет-магазин|outdoor/i)
    await expect(pointB).toBeVisible()
    await expect(pointB).toContainText(/50\s*млн\s*₸/i)
    await expect(pointB).toContainText(/6\s*месяц/i)
    await expect(roadmap).toBeVisible()
    await expect(roadmap).toContainText(/ассортимент|заказ|доставк|продаж/i)

    await selectMobileSurface(page, /модули|виджеты/i)
    const domainMetrics = page.locator(
      '[data-testid="journey-widget"][data-widget-kind="domain_metrics"]',
    )
    const domainProcess = page.locator(
      '[data-testid="journey-widget"][data-widget-kind="domain_process"]',
    )
    await expect(domainMetrics).toBeVisible()
    await expect(domainMetrics).toContainText(/продажи.*ассортимент.*наличие/i)
    await expect(domainMetrics).toContainText(/нужно уточнить/i)
    await expect(domainMetrics).not.toContainText(/50\s*млн/i)
    if ((await domainProcess.count()) === 0) {
      await (await openDesktopModuleDock(page))
        .getByRole('button', { name: /Путь заказа и повторной покупки/i })
        .click()
    }
    const expandProcess = domainProcess.getByRole('button', { name: /^Развернуть модуль:/ }).first()
    if (await expandProcess.isVisible()) await expandProcess.click()
    await expect(domainProcess).toContainText(/Заказ/i)
    await expect(domainProcess).toContainText(/Наличие и резерв/i)
    await expect(domainProcess).toContainText(/Доставка и возврат/i)

    const demoIdentity = await page.evaluate(() => {
      const serialized = window.localStorage.getItem('aistart360:journey:demo:identity:v1:honor')
      return serialized ? JSON.parse(serialized) as { workspaceId?: string; accessToken?: string } : null
    })
    expect(demoIdentity).toBeTruthy()
    expect(demoIdentity?.workspaceId).toMatch(/^demo-honor-/)
    expect(demoIdentity?.accessToken).toBeUndefined()
    expect(journeyApiRequests).toEqual([])
    await expectNoHorizontalViewportOverflow(page)
    expect(pageErrors).toEqual([])

    // A page-scoped init script above must not leak into a normal route visit.
    // The standard Journey identity is deliberately distinct from the demo one.
    const normalPage = await page.context().newPage()
    try {
      await normalPage.goto('/journey')
      await expect(normalPage.locator('[data-demo-scenario="honor"]')).toHaveCount(0)
      await expect(normalPage.getByTestId('demo-project-banner')).toHaveCount(0)
      await expect(normalPage.getByRole('region', { name: 'Путь первого разговора' })).toBeVisible()
      const normalIdentity = await normalPage.evaluate(() =>
        window.localStorage.getItem('aistart360:journey:identity:v1'),
      )
      expect(normalIdentity).toBeTruthy()
      expect(normalIdentity).not.toBe(JSON.stringify(demoIdentity))
    } finally {
      await normalPage.close()
    }
  })

  test('Honor commerce reaches a safe revenue journey without invented metrics', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.emulateMedia({ reducedMotion: 'reduce' })

    await page.goto('/journey')
    await page.evaluate(() => window.localStorage.clear())
    await page.reload()

    await selectMobileSurface(page, /диалог|чат/i)
    await sendChatMessage(page, HONOR_COMMERCE_DESCRIPTION)
    const pendingFacts = page.getByTestId('pending-fact')
    await expect(pendingFacts.first()).toBeVisible()

    const confirmAll = page.getByRole('button', { name: /всё верно|подтвердить всё/i })
    if (await confirmAll.isVisible()) {
      await confirmAll.click()
    } else {
      const labels = await page
        .getByRole('button', { name: /^Подтвердить факт:/ })
        .evaluateAll((buttons) =>
          buttons
            .map((button) => button.getAttribute('aria-label'))
            .filter((label): label is string => Boolean(label)),
        )
      for (const label of labels) {
        await page.getByRole('button', { name: label, exact: true }).click()
      }
    }
    await expect(pendingFacts).toHaveCount(0)

    await selectMobileSurface(page, /диалог|чат/i)
    await sendChatMessage(page, HONOR_COMMERCE_GOAL)
    await selectMobileSurface(page, /доска|путь/i)
    const pointB = page.getByTestId('point-b')
    await expect(pointB).toBeVisible()
    await expect(pointB).toContainText(/50\s*млн\s*₸/i)

    await selectMobileSurface(page, /модули|виджеты/i)
    const domainMetrics = page.locator(
      '[data-testid="journey-widget"][data-widget-kind="domain_metrics"]',
    )
    const domainProcess = page.locator(
      '[data-testid="journey-widget"][data-widget-kind="domain_process"]',
    )
    await expect(domainMetrics).toContainText(/продажи.*ассортимент.*наличие/i)
    await expect(domainMetrics).toContainText('Нужно уточнить')
    await expect(domainMetrics).not.toContainText(/50\s*млн/i)
    if ((await domainProcess.count()) === 0) {
      await (await openDesktopModuleDock(page))
        .getByRole('button', { name: /Путь заказа и повторной покупки/i })
        .click()
    }
    const expandProcess = domainProcess.getByRole('button', { name: /^Развернуть модуль:/ }).first()
    if (await expandProcess.isVisible()) await expandProcess.click()
    await expect(domainProcess).toContainText(/Заказ/i)
    await expect(domainProcess).toContainText(/Наличие и резерв/i)
    await expect(domainProcess).toContainText(/Сборка и отгрузка/i)
    await expect(domainProcess).toContainText(/Доставка и возврат/i)
    await expect(domainProcess).toContainText(/Повторная покупка/i)

    await takeJourneyScreenshot(page, testInfo, 'honor-ready')
    await expectNoHorizontalViewportOverflow(page)
    expect(pageErrors).toEqual([])
  })

  test('business input and CSV produce Point A, Point B, roadmap and persistent widget state', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.emulateMedia({ reducedMotion: 'reduce' })

    await page.goto('/journey')
    await page.evaluate(() => window.localStorage.clear())
    await page.reload()

    await expect(page).toHaveURL(/\/journey\/?$/)
    await expect(page.getByTitle(/демо(?:[- ]режим|[- ]логика)/i).first()).toBeVisible()
    await expect(page.getByText(/расскаж|начните|пока нет данных/i).first()).toBeVisible()
    const firstConversation = page.getByRole('region', { name: 'Путь первого разговора' })
    await expect(firstConversation).toBeVisible()
    await expect(firstConversation).toHaveAttribute('data-stage', 'describe')
    await expect(firstConversation).toContainText(/Бизнес|Точка A|Точка B|Первый шаг/i)
    if (await page.evaluate(() => window.matchMedia('(max-width: 767px)').matches)) {
      await expect(page.getByRole('tab', { name: /диалог.*спросить AI/i })).toHaveAttribute('aria-selected', 'true')
    }
    await takeJourneyScreenshot(page, testInfo, 'empty')
    await expectNoHorizontalViewportOverflow(page)

    await selectMobileSurface(page, /диалог|чат/i)
    await sendChatMessage(page, BUSINESS_DESCRIPTION)

    const pendingFacts = page.getByTestId('pending-fact')
    await expect(pendingFacts.first()).toBeVisible()
    await expect(firstConversation).toHaveAttribute('data-stage', 'confirm')

    const fileInput = page.getByTestId('journey-file-input')
    await fileInput.setInputFiles({
      name: 'tomato-inventory.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'product,city,status',
          'Помидоры,Алматы,в наличии',
          'Черри,Алматы,в наличии',
        ].join('\n'),
      ),
    })

    const fileStatus = page.getByTestId('journey-file-status').filter({
      hasText: 'tomato-inventory.csv',
    })
    await expect(fileStatus).toBeVisible()
    await expect(fileStatus).toContainText(/готов|обработ|проанализ|локальн/i)
    await expect(fileStatus).not.toContainText(/ошиб/i)

    const confirmAll = page.getByRole('button', { name: /всё верно|подтвердить всё/i })
    if (await confirmAll.isVisible()) {
      await confirmAll.click()
    } else {
      const labels = await page
        .getByRole('button', { name: /^Подтвердить факт:/ })
        .evaluateAll((buttons) =>
          buttons
            .map((button) => button.getAttribute('aria-label'))
            .filter((label): label is string => Boolean(label)),
        )
      for (const label of labels) {
        await page.getByRole('button', { name: label, exact: true }).click()
      }
    }
    await expect(pendingFacts).toHaveCount(0)
    await expect(firstConversation).toHaveAttribute('data-stage', 'goal')

    await selectMobileSurface(page, /диалог|чат/i)
    await sendChatMessage(page, MEASURABLE_GOAL)

    await selectMobileSurface(page, /доска|путь/i)
    const pointA = page.getByTestId('point-a')
    const roadmap = page.getByTestId('journey-roadmap')
    const pointB = page.getByTestId('point-b')

    await expect(pointA).toBeVisible()
    await expect(pointA).toContainText(/один магазин|1\s+магазин/i)
    await expect(pointA).toContainText(/помидор|овощ/i)
    await expect(pointB).toBeVisible()
    await expect(pointB).toContainText(/5\s+магазин|пять магазин/i)
    await expect(roadmap).toBeVisible()
    await expect(roadmap).toContainText(/следующ|этап|дорожн|30|90/i)
    await takeJourneyScreenshot(page, testInfo, 'ready')
    await expectNoHorizontalViewportOverflow(page)

    if (testInfo.project.name.includes('mobile')) {
      const mobileBoard = page.getByTestId('journey-mobile-board')
      await mobileBoard.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(pointB).toBeInViewport()
      await takeJourneyScreenshot(page, testInfo, 'goal')
    }

    await selectMobileSurface(page, /модули|виджеты/i)
    const widgets = page.getByTestId('journey-widget')
    await expect(widgets.nth(2)).toBeVisible()
    const domainMetrics = page.locator(
      '[data-testid="journey-widget"][data-widget-kind="domain_metrics"]',
    )
    const domainProcess = page.locator(
      '[data-testid="journey-widget"][data-widget-kind="domain_process"]',
    )
    await expect(domainMetrics).toContainText(/Экономика.*(?:товар|запас|магазин)/i)
    await expect(domainMetrics).toContainText(/нужно уточнить/i)
    if ((await domainProcess.count()) === 0) {
      await (await openDesktopModuleDock(page))
        .getByRole('button', { name: /Открытие новых магазинов|Поставка и открытие точки/i })
        .click()
    }
    await expect(domainProcess).toContainText(/Поставка и открытие точки|Открытие новых магазинов/i)
    await expect(widgets.locator('a[href^="http"]')).toHaveCount(0)

    const collapsedId = await widgets.nth(0).getAttribute('data-widget-id')
    const focusedId = await widgets.nth(1).getAttribute('data-widget-id')
    const hiddenId = await widgets.nth(2).getAttribute('data-widget-id')

    expect(collapsedId).toBeTruthy()
    expect(focusedId).toBeTruthy()
    expect(hiddenId).toBeTruthy()

    if (!collapsedId || !focusedId || !hiddenId) {
      throw new Error('Journey widgets must expose stable data-widget-id attributes')
    }

    let movedPosition: { x: number; y: number } | null = null
    if (testInfo.project.name.includes('mobile')) {
      const sortHandle = widgets.nth(0).getByTestId('widget-sort-handle')
      const nextHandle = widgets.nth(1).getByTestId('widget-sort-handle')
      const sortable = sortHandle.locator('xpath=ancestor::div[@data-sorting][1]')
      await sortHandle.scrollIntoViewIfNeeded()
      const sourceBox = await sortHandle.boundingBox()
      const targetBox = await nextHandle.boundingBox()
      if (!sourceBox || !targetBox) throw new Error('Mobile widget sort handles must have bounding boxes')
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
      await expect(sortable).toHaveAttribute('data-sorting', 'true')
      await page.mouse.up()
      await expect(sortable).toHaveAttribute('data-sorting', 'false')
      await expect(widgets.nth(0)).toHaveAttribute('data-widget-id', focusedId)
    } else {
      const movable = page.locator(
        `[data-testid="journey-widget"][data-widget-id="${focusedId}"]`,
      )
      const handle = movable.getByTestId('widget-drag-handle')
      const handleBox = await handle.boundingBox()
      if (!handleBox) throw new Error('Desktop widget drag handle must have a bounding box')
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(handleBox.x + handleBox.width / 2 + 84, handleBox.y + handleBox.height / 2 + 36, { steps: 5 })
      await expect(movable).toHaveAttribute('data-dragging', 'true')
      await page.mouse.up()
      await expect(movable).toHaveAttribute('data-dragging', 'false')
      movedPosition = await movable.evaluate((element) => ({
        x: Number.parseFloat((element as HTMLElement).style.left),
        y: Number.parseFloat((element as HTMLElement).style.top),
      }))
      await waitForWidgetLayout(page, focusedId, movedPosition)
    }

    const collapsedWidget = page.locator(
      `[data-testid="journey-widget"][data-widget-id="${collapsedId}"]`,
    )
    const focusedWidget = page.locator(
      `[data-testid="journey-widget"][data-widget-id="${focusedId}"]`,
    )
    const hiddenWidget = page.locator(
      `[data-testid="journey-widget"][data-widget-id="${hiddenId}"]`,
    )

    await collapsedWidget.getByRole('button', { name: /^Свернуть модуль:/ }).click()
    const persistedCollapsed = page.locator(
      `[data-testid="journey-widget"][data-widget-id="${collapsedId}"]`,
    )
    if (testInfo.project.name.includes('mobile')) {
      await expect(persistedCollapsed).toHaveAttribute('data-collapsed', 'true')
      await expect(
        persistedCollapsed.getByRole('button', { name: /^Развернуть модуль:/ }),
      ).toBeVisible()
    } else {
      await expect(persistedCollapsed).toHaveCount(0)
      await expect((await openDesktopModuleDock(page)).getByText('свёрнут').first()).toBeVisible()
    }

    await hiddenWidget.getByRole('button', { name: /^Скрыть модуль:/ }).click()
    await expect(
      page.locator(`[data-testid="journey-widget"][data-widget-id="${hiddenId}"]`),
    ).toHaveCount(0)

    await focusedWidget.getByRole('button', { name: /^Фокусировать модуль:/ }).click()
    const persistedFocused = page.locator(
      `[data-testid="journey-widget"][data-widget-id="${focusedId}"]`,
    )
    await expect(persistedFocused).toHaveAttribute('data-focused', 'true')

    await waitForWidgetPersistence(page, {
      collapsed: collapsedId,
      focused: focusedId,
      hidden: hiddenId,
    })

    await page.reload()
    await selectMobileSurface(page, /модули|виджеты/i)

    if (!testInfo.project.name.includes('mobile')) {
      await page.setViewportSize({ width: 1440, height: 900 })
      const chatDock = page.getByRole('region', { name: 'AI-диалог о бизнесе' })
      const expandHistory = chatDock.getByRole('button', { name: 'Раскрыть историю диалога' })
      if (await expandHistory.isVisible()) await expandHistory.click()
      await expect(chatDock.getByRole('button', { name: 'Свернуть историю диалога' })).toBeVisible()
      const dockBox = await chatDock.boundingBox()
      expect(dockBox).not.toBeNull()
      if (dockBox) {
        expect(dockBox.y).toBeGreaterThanOrEqual(0)
        expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(901)
      }
    }

    const reloadedCollapsed = page.locator(
      `[data-testid="journey-widget"][data-widget-id="${collapsedId}"]`,
    )
    if (testInfo.project.name.includes('mobile')) {
      await expect(reloadedCollapsed).toHaveAttribute('data-collapsed', 'true')
    } else {
      await expect(reloadedCollapsed).toHaveCount(0)
      await expect((await openDesktopModuleDock(page)).getByText('свёрнут').first()).toBeVisible()
    }
    await expect(
      page.locator(`[data-testid="journey-widget"][data-widget-id="${focusedId}"]`),
    ).toHaveAttribute('data-focused', 'true')
    await expect(
      page.locator(`[data-testid="journey-widget"][data-widget-id="${hiddenId}"]`),
    ).toHaveCount(0)
    if (testInfo.project.name.includes('mobile')) {
      await expect(page.getByTestId('journey-widget').nth(0)).toHaveAttribute('data-widget-id', focusedId)
    } else if (movedPosition) {
      const reloadedPosition = await page.locator(
        `[data-testid="journey-widget"][data-widget-id="${focusedId}"]`,
      ).evaluate((element) => ({
        x: Number.parseFloat((element as HTMLElement).style.left),
        y: Number.parseFloat((element as HTMLElement).style.top),
      }))
      expect(reloadedPosition).toEqual(movedPosition)
    }

    await takeJourneyScreenshot(page, testInfo, 'persisted')
    await expectNoHorizontalViewportOverflow(page)
    expect(pageErrors).toEqual([])
  })
})

test.describe('Journey real cross-device sync', () => {
  test.skip(
    process.env.JOURNEY_SYNC_E2E !== '1',
    'Requires a test Supabase project with Journey migrations 069/070.',
  )

  test('links two isolated browser contexts without sharing localStorage', async ({ browser }) => {
    const sourceContext = await browser.newContext()
    const targetContext = await browser.newContext()
    const source = await sourceContext.newPage()
    const target = await targetContext.newPage()

    try {
      await source.goto('/journey')
      await source.evaluate(() => window.localStorage.clear())
      await source.reload()
      await sendChatMessage(source, BUSINESS_DESCRIPTION)
      await expect(source.getByTestId('pending-fact').first()).toBeVisible()

      await source.getByRole('button', { name: 'Подключить другое устройство' }).click()
      await source.getByRole('button', { name: 'Создать одноразовый код' }).click()
      const codeButton = source.getByRole('button', { name: /^Скопировать код подключения/ })
      await expect(codeButton).toBeVisible()
      const code = (await codeButton.textContent())?.match(/[A-Z2-9]{4}-[A-Z2-9]{4}/)?.[0]
      expect(code).toBeTruthy()

      await target.goto('/journey')
      await target.evaluate(() => window.localStorage.clear())
      await target.reload()
      await target.getByRole('button', { name: 'Подключить другое устройство' }).click()
      await target.getByRole('tab', { name: 'Ввести код' }).click()
      await target.getByRole('textbox', { name: 'Одноразовый код подключения' }).fill(code!)
      await target.getByRole('textbox', { name: 'Название подключаемого устройства' }).fill('E2E телефон')
      await target.getByRole('button', { name: 'Подключить это устройство' }).click()

      await expect(target.getByText(BUSINESS_DESCRIPTION).first()).toBeVisible()
      const [sourceIdentity, targetIdentity] = await Promise.all([
        source.evaluate(() => window.localStorage.getItem('aistart360:journey:identity:v1')),
        target.evaluate(() => window.localStorage.getItem('aistart360:journey:identity:v1')),
      ])
      expect(JSON.parse(targetIdentity ?? '{}')).toEqual({
        workspaceId: JSON.parse(sourceIdentity ?? '{}').workspaceId,
      })
    } finally {
      await sourceContext.close()
      await targetContext.close()
    }
  })
})
