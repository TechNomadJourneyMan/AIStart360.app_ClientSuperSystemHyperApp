import type {
  JourneyFactView,
  JourneyRoadmapView,
  JourneyWidgetKind,
  JourneyWidgetView,
  JourneyWorkspaceView,
} from './model'
import { makeId } from './model'
import {
  journeyWidgetSchema,
  type JourneyWidgetDecision,
} from '@/lib/journey/schema'

type LocalDomain = 'tomato-retail' | 'insurance' | 'generic'

/**
 * Honest deterministic fallback for local/dev use. It only promotes text the
 * user typed and never claims to have read a document or contacted a source.
 */
export function runLocalTurn(
  current: JourneyWorkspaceView,
  text: string,
): JourneyWorkspaceView {
  const now = new Date().toISOString()
  const userMessage = {
    id: makeId('message'),
    role: 'user' as const,
    text,
    createdAt: now,
  }

  if (shouldTreatAsGoal(current, text)) {
    const domain = detectLocalDomain(`${current.businessDescription} ${text}`)
    const goalId = makeId('goal')
    const parsedTarget = extractGoalTarget(text)
    const goal = {
      id: goalId,
      title: text,
      metric: parsedTarget?.metric,
      target: parsedTarget?.target,
      deadline: extractDeadline(text),
      status: 'confirmed' as const,
    }
    const measurable = Boolean(goal.metric && goal.target && goal.deadline)
    const roadmap = buildRoadmap(domain)
    const selectedWidgets = [
      widget('point_b_goals', 'Точка B', 90, 970, 620, {
        goals: [goal],
      }),
      widget('roadmap_actions', 'Ближайшие действия', 85, 1300, 620, {
        items: roadmap,
      }),
      ...buildGoalMetricWidgets(domain),
      ...buildTransformationWidgets(domain),
      ...buildRetirementWidgets(current.widgets, domain),
    ]
    const widgetDecisions = buildWidgetDecisions(selectedWidgets, domain, current.facts, current.widgets)
    const widgets = upsertWidgets(
      current.widgets,
      selectedWidgets,
      widgetDecisions,
      current.manualWidgetIds ?? [],
    )

    return {
      ...current,
      phase: measurable ? 'ready' : 'partial',
      businessDescription: mergeBusinessDescription(current.businessDescription, text),
      messages: [
        ...current.messages,
        userMessage,
        {
          id: makeId('message'),
          role: 'assistant',
          text: measurable
            ? 'Цель записана в Точку B. Я построил демонстрационный путь из проверяемых этапов — их можно обсудить и скорректировать.'
            : 'Цель сохранена как черновик. Уточните показатель, целевое значение и срок, чтобы завершить Точку B.',
          createdAt: now,
        },
      ],
      goals: [...current.goals, goal],
      roadmap,
      widgets,
      widgetDecisions: upsertWidgetDecisions(
        current.widgetDecisions ?? [],
        widgetDecisions,
      ),
      suggestions: [
        {
          id: makeId('suggestion'),
          label: 'Уточнить первый этап',
          value: 'Давай уточним первый этап дорожной карты.',
          target: 'roadmap',
          status: 'active',
        },
      ],
      provider: { mode: 'demo', label: 'Демо-логика' },
      persistence: {
        mode: 'local',
        label: 'Сохранение на устройстве',
        reason: 'Ответ создан детерминированным локальным сценарием, не внешней AI-моделью.',
      },
      updatedAt: now,
    }
  }

  const extracted = extractFactsFromText(text)
  const existingKeys = new Set(current.facts.map((fact) => `${fact.label}:${fact.value}`.toLowerCase()))
  const facts = extracted.filter(
    (fact) => !existingKeys.has(`${fact.label}:${fact.value}`.toLowerCase()),
  )
  const mergedFacts = [...current.facts, ...facts]
  const domain = detectLocalDomain(`${current.businessDescription} ${text}`)
  const contextualWidgets = domain === 'tomato-retail'
    ? [
        widget('domain_metrics', 'Экономика свежего товара', 85, 570, 620, {
          domain: 'Розничная торговля свежими продуктами',
          purpose: 'Проверить, выдерживает ли экономика одной точки масштабирование до сети.',
          metrics: [
            { label: 'Списания', status: 'unknown', sourceLabel: 'Нужно уточнить у пользователя' },
            { label: 'Валовая маржа', status: 'unknown', sourceLabel: 'Нужно уточнить у пользователя' },
            { label: 'Капитал на открытие', status: 'unknown', sourceLabel: 'Нужно уточнить у пользователя' },
          ],
          guidance: [
            { title: 'Доля списаний', detail: 'Какая доля товара списывается?', status: 'question' },
            { title: 'Маржа точки', detail: 'Какова валовая маржа одной точки?', status: 'question' },
          ],
        }),
      ]
    : domain === 'insurance'
      ? [
          widget('domain_metrics', 'Экономика страхового портфеля', 85, 570, 620, {
            domain: 'Страхование',
            purpose: 'Понять качество портфеля до выбора рычагов роста и удержания.',
            metrics: [
              { label: 'Собранная премия', status: 'unknown' },
              { label: 'Loss ratio', status: 'unknown' },
              { label: 'Частота страховых случаев', status: 'unknown' },
              { label: 'Renewal rate', status: 'unknown' },
            ],
            guidance: [
              {
                title: 'Нужны данные портфеля',
                detail: 'Назовите текущий renewal rate или загрузите обезличенную выгрузку полисов.',
                status: 'question',
              },
            ],
          }),
        ]
      : [
        widget('crm_readiness', 'CRM readiness', 75, 570, 620, {
          hasCrm: crmStatusFromText(text) === 'unknown' ? null : crmStatusFromText(text) === 'connected',
          connectionStatus:
            crmStatusFromText(text) === 'connected'
              ? 'not_connected'
              : crmStatusFromText(text) === 'missing'
                ? 'not_needed_yet'
                : 'unknown',
          nextStep: 'Ответьте, есть ли у бизнеса CRM и нужно ли подключение данных.',
          alternatives: [],
        }),
        ...(current.files.length
          ? [widget('knowledge_base', 'База знаний', 60, 970, 620, { files: current.files })]
          : []),
      ]
  const selectedWidgets = [
    widget('business_passport', 'Паспорт бизнеса', 100, 170, 620, {
      facts: mergedFacts.filter((fact) => fact.status !== 'rejected'),
    }),
    ...contextualWidgets,
    ...buildRetirementWidgets(current.widgets, domain),
  ]
  const widgetDecisions = buildWidgetDecisions(selectedWidgets, domain, mergedFacts, current.widgets)
  const widgets = upsertWidgets(
    current.widgets,
    selectedWidgets,
    widgetDecisions,
    current.manualWidgetIds ?? [],
  )

  const assistantText = facts.length
    ? `Я выделил ${facts.length} ${pluralizeFact(facts.length)} только из вашего сообщения. Проверьте формулировки перед добавлением в Точку A.`
    : 'Я сохранил сообщение, но не стал превращать неоднозначные фразы в факты. Уточните, пожалуйста, продукт, клиентов или одну ключевую цифру.'

  return {
    ...current,
    phase: facts.length ? 'partial' : current.phase,
    businessDescription: mergeBusinessDescription(current.businessDescription, text),
    messages: [
      ...current.messages,
      userMessage,
      {
        id: makeId('message'),
        role: 'assistant',
        text: assistantText,
        createdAt: now,
      },
    ],
    facts: mergedFacts,
    widgets,
    widgetDecisions: upsertWidgetDecisions(
      current.widgetDecisions ?? [],
      widgetDecisions,
    ),
    suggestions: facts.length
      ? [
          {
            id: makeId('suggestion'),
            label: 'Проверить факты',
            value: 'Покажи, какие факты нужно подтвердить.',
            target: 'point-a',
            status: 'active',
          },
        ]
      : current.suggestions,
    provider: { mode: 'demo', label: 'Демо-логика' },
    persistence: {
      mode: 'local',
      label: 'Сохранение на устройстве',
      reason: 'Ответ создан детерминированным локальным сценарием, не внешней AI-моделью.',
    },
    updatedAt: now,
  }
}

export function afterFactsConfirmed(current: JourneyWorkspaceView): JourneyWorkspaceView {
  const now = new Date().toISOString()
  const confirmed = current.facts.filter((fact) => fact.status === 'confirmed')
  const passport = widget('business_passport', 'Паспорт бизнеса', 100, 170, 620, {
    facts: confirmed,
  })
  return {
    ...current,
    phase: current.goals.length ? 'ready' : 'partial',
    messages: current.goals.length
      ? current.messages
      : [
          ...current.messages,
          {
            id: makeId('message'),
            role: 'assistant',
            text: 'Точка A обновлена. Теперь опишите один измеримый результат для Точки B: что должно измениться, до какого значения и к какому сроку?',
            createdAt: now,
          },
        ],
    widgets: upsertWidgets(current.widgets, [passport]),
    widgetDecisions: upsertWidgetDecisions(
      current.widgetDecisions ?? [],
      buildWidgetDecisions(
        [passport],
        detectLocalDomain(current.businessDescription),
        confirmed,
        current.widgets,
      ),
    ),
    suggestions: current.goals.length
      ? current.suggestions
      : [
          {
            id: makeId('suggestion'),
            label: 'Сформулировать цель',
            value: 'Хочу сформулировать измеримую цель на 12 месяцев.',
            target: 'point-b',
            status: 'active',
          },
        ],
    updatedAt: now,
  }
}

export function refreshKnowledgeWidget(current: JourneyWorkspaceView): JourneyWorkspaceView {
  const knowledge = widget('knowledge_base', 'База знаний', 60, 970, 620, {
    files: current.files,
  })
  return {
    ...current,
    widgets: upsertWidgets(current.widgets, [knowledge]),
    widgetDecisions: upsertWidgetDecisions(
      current.widgetDecisions ?? [],
      buildWidgetDecisions(
        [knowledge],
        detectLocalDomain(current.businessDescription),
        current.facts,
        current.widgets,
      ),
    ),
    updatedAt: new Date().toISOString(),
  }
}

function extractFactsFromText(text: string): JourneyFactView[] {
  const facts: JourneyFactView[] = []
  const clean = text.trim().replace(/\s+/g, ' ')
  if (!clean) return facts

  facts.push({
    id: makeId('fact'),
    label: 'Описание бизнеса',
    value: clean,
    category: 'business',
    sourceLabel: 'Сообщение пользователя',
    confidence: 1,
    status: 'pending',
  })

  if (isProduceRetail(clean)) {
    facts.push({
      id: makeId('fact'),
      label: 'Формат бизнеса',
      value: 'Магазин помидоров',
      category: 'business',
      sourceLabel: 'Сообщение пользователя',
      confidence: 1,
      status: 'pending',
    })
  } else if (detectLocalDomain(clean) === 'insurance') {
    facts.push({
      id: makeId('fact'),
      label: 'Формат бизнеса',
      value: 'Страхование',
      category: 'business',
      sourceLabel: 'Сообщение пользователя',
      confidence: 1,
      status: 'pending',
    })
  }

  const locationMatch = clean.match(/(?:сейчас\s+)?(\d+|один|одна|одно)\s+(?:магазин[а-яё]*|точк[а-яё]*)/i)
  if (locationMatch?.[1]) {
    const count = russianNumber(locationMatch[1]) ?? Number(locationMatch[1])
    if (Number.isFinite(count)) {
      facts.push({
        id: makeId('fact'),
        label: 'Количество точек',
        value: `${count}`,
        category: 'operations',
        sourceLabel: 'Сообщение пользователя',
        confidence: 1,
        status: 'pending',
      })
    }
  }

  const teamMatch = clean.match(/(?:команд[а-яё]*|штат[а-яё]*)\D{0,18}(\d{1,5})\s*(?:человек|сотрудник[а-яё]*)?/i)
  if (teamMatch?.[1]) {
    facts.push({
      id: makeId('fact'),
      label: 'Размер команды',
      value: `${teamMatch[1]} человек`,
      category: 'team',
      sourceLabel: 'Сообщение пользователя',
      confidence: 1,
      status: 'pending',
    })
  }

  const revenueMatch = clean.match(
    /выручк[а-яё]*\s*(?:около|примерно|~)?\s*([\d.,]+\s*(?:тыс(?:яч[аи])?|млн|миллион[а-яё]*|млрд|миллиард[а-яё]*)?\s*(?:₸|тенге|тг|kzt)?(?:\s*в\s*(?:месяц[а-яё]*|год[а-яё]*))?)/i,
  )
  if (revenueMatch?.[1]) {
    facts.push({
      id: makeId('fact'),
      label: 'Выручка',
      value: revenueMatch[1].trim(),
      category: 'finance',
      sourceLabel: 'Сообщение пользователя',
      confidence: 1,
      status: 'pending',
    })
  }

  const crmStatus = crmStatusFromText(clean)
  if (crmStatus === 'connected' || crmStatus === 'missing') {
    facts.push({
      id: makeId('fact'),
      label: 'CRM',
      value: crmStatus === 'connected' ? 'Есть' : 'Нет',
      category: 'sales',
      sourceLabel: 'Сообщение пользователя',
      confidence: 1,
      status: 'pending',
    })
  }

  return facts.slice(0, 6)
}

function crmStatusFromText(text: string): 'connected' | 'missing' | 'unknown' {
  if (/\b(?:нет|без)\s+(?:никакой\s+)?crm\b|\bcrm\D{0,18}(?:нет|отсутствует)\b/i.test(text)) return 'missing'
  if (/\b(?:есть|используем|подключена?)\s+crm\b|\bcrm\D{0,18}(?:есть|используем|подключена?)\b/i.test(text)) return 'connected'
  return 'unknown'
}

function shouldTreatAsGoal(state: JourneyWorkspaceView, text: string): boolean {
  if (state.goals.length > 0) return false
  const hasConfirmedPointA = state.facts.some((fact) => fact.status === 'confirmed')
  if (!hasConfirmedPointA) return false
  return /(?:цель|увелич|сниз|достичь|вырасти|открыть|масштаб|до\s+[\d.,]+|за\s+\d+\s*(?:месяц|год|недел))/i.test(text)
}

function extractGoalTarget(text: string): { metric: string; target: string } | undefined {
  const stores = text.match(/(?:открыть|до)\s+(\d+|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять)\s+(магазин[а-яё]*|точ[а-яё]*)/i)
  if (stores?.[1]) {
    const count = russianNumber(stores[1]) ?? Number(stores[1])
    if (Number.isFinite(count)) return { metric: 'Количество магазинов', target: `${count} магазинов` }
  }
  const renewal = text.match(/(?:renewal\s*rate|дол[яю]\s+продлен[а-яё]*|процент\s+продлен[а-яё]*)[^\d]{0,30}(\d+(?:[.,]\d+)?\s*%)/i)
  if (renewal?.[1]) return { metric: 'Renewal rate', target: renewal[1].replace(/\s+/g, '') }
  const match = text.match(/(?:до|на)\s+([\d.,]+\s*(?:%|тыс(?:яч[аи])?|млн|миллион[а-яё]*|млрд)?(?:\s*(?:₸|тенге|тг|kzt))?)/i)
  return match?.[1] ? { metric: 'Целевой показатель', target: match[1].trim() } : undefined
}

function extractDeadline(text: string): string | undefined {
  const match = text.match(/(?:за|через|к)\s+(\d+\s*(?:недел[а-яё]*|месяц[а-яё]*|год[а-яё]*|квартал[а-яё]*))/i)
  return match?.[1]?.trim()
}

function buildRoadmap(domain: LocalDomain): JourneyRoadmapView[] {
  if (domain === 'tomato-retail') return buildProduceRetailRoadmap()
  if (domain === 'insurance') return buildInsuranceRoadmap()
  const first = makeId('roadmap')
  const second = makeId('roadmap')
  return [
    {
      id: first,
      title: 'Подтвердить базовую метрику',
      description: 'Зафиксировать текущее значение тем же способом, которым будет измеряться цель.',
      horizon: '0–30 дней',
      progress: 0,
      status: 'next',
      dependsOn: [],
    },
    {
      id: second,
      title: 'Запустить первый приоритет',
      description: 'Выбрать одно действие с владельцем, сроком и ожидаемым изменением метрики.',
      horizon: '31–60 дней',
      progress: 0,
      status: 'planned',
      dependsOn: [first],
    },
    {
      id: makeId('roadmap'),
      title: 'Сверить прогресс с Точкой B',
      description: 'Сопоставить факт с целью и пересобрать следующий цикл действий.',
      horizon: '61–90 дней',
      progress: 0,
      status: 'planned',
      dependsOn: [second],
    },
  ]
}

function buildProduceRetailRoadmap(): JourneyRoadmapView[] {
  const economics = makeId('roadmap')
  const locations = makeId('roadmap')
  const opening = makeId('roadmap')
  return [
    {
      id: economics,
      title: 'Проверить unit-экономику одной точки',
      description: 'Подтвердить маржу, списания, аренду, персонал и необходимый оборотный капитал.',
      horizon: '0–30 дней',
      progress: 0,
      status: 'next',
      dependsOn: [],
    },
    {
      id: locations,
      title: 'Отобрать локации и схему поставок',
      description: 'Задать критерии трафика и аренды, проверить поставщиков, запас и частоту пополнения.',
      horizon: '31–60 дней',
      progress: 0,
      status: 'planned',
      dependsOn: [economics],
    },
    {
      id: opening,
      title: 'Собрать чек-лист открытия магазина',
      description: 'Стандартизировать оборудование, ассортимент, контроль качества и запуск точки.',
      horizon: '61–90 дней',
      progress: 0,
      status: 'planned',
      dependsOn: [locations],
    },
    {
      id: makeId('roadmap'),
      title: 'Спланировать команду и капитал',
      description: 'Назначить владельцев, посчитать потребность в людях и финансировании первой волны.',
      horizon: 'Следующая волна',
      progress: 0,
      status: 'planned',
      dependsOn: [opening],
    },
  ]
}

function buildInsuranceRoadmap(): JourneyRoadmapView[] {
  const baseline = makeId('roadmap')
  const journey = makeId('roadmap')
  const experiment = makeId('roadmap')
  return [
    {
      id: baseline,
      title: 'Подтвердить базовый renewal rate',
      description: 'Зафиксировать текущую долю продлений, когорту полисов и единый источник измерения.',
      horizon: '0–30 дней',
      progress: 0,
      status: 'next',
      dependsOn: [],
    },
    {
      id: journey,
      title: 'Разобрать путь клиента до продления',
      description: 'Найти фактические потери между уведомлением, предложением, оплатой и новым полисом.',
      horizon: '31–60 дней',
      progress: 0,
      status: 'planned',
      dependsOn: [baseline],
    },
    {
      id: experiment,
      title: 'Запустить один рычаг удержания',
      description: 'Выбрать сегмент, действие, владельца и контрольную группу без выдуманного прогноза.',
      horizon: '61–90 дней',
      progress: 0,
      status: 'planned',
      dependsOn: [journey],
    },
    {
      id: makeId('roadmap'),
      title: 'Масштабировать подтверждённый сценарий',
      description: 'Сравнить результат с Точкой B и расширять только доказавший эффект процесс.',
      horizon: 'После 90 дней',
      progress: 0,
      status: 'planned',
      dependsOn: [experiment],
    },
  ]
}

function isProduceRetail(text: string): boolean {
  return /помидор/i.test(text) && /(?:магазин|точк|прода)/i.test(text)
}

function detectLocalDomain(text: string): LocalDomain {
  if (isProduceRetail(text) || /помидор|овощн[а-яё]* магазин/i.test(text)) return 'tomato-retail'
  if (/страхов|полис|андеррайт|renewal\s*rate|страхов[а-яё]* случа/i.test(text)) return 'insurance'
  return 'generic'
}

function buildTransformationWidgets(domain: LocalDomain): JourneyWidgetView[] {
  if (domain === 'tomato-retail') {
    return [
      widget('domain_process', 'Открытие новых магазинов', 82, 570, 880, {
        domain: 'Розничная сеть свежих продуктов',
        purpose: 'Не открывать следующую точку, пока не подтверждена воспроизводимость первой.',
        stages: [
          { id: 'store-unit-economics', name: 'Экономика первой точки', status: 'next', nextAction: 'Подтвердить маржу, списания и денежный цикл.' },
          { id: 'store-supply-standard', name: 'Стандарт закупок и запасов', status: 'blocked', nextAction: 'Описать поставщиков и контроль качества.', dependsOn: ['store-unit-economics'] },
          { id: 'store-location-model', name: 'Модель выбора локации', status: 'blocked', nextAction: 'Зафиксировать критерии трафика и аренды.', dependsOn: ['store-unit-economics'] },
          { id: 'store-opening-playbook', name: 'Чек-лист открытия', status: 'blocked', nextAction: 'Собрать бюджет, роли и контроль запуска.', dependsOn: ['store-supply-standard', 'store-location-model'] },
        ],
      }),
    ]
  }
  if (domain === 'insurance') {
    return [
      widget('domain_process', 'Путь страхового портфеля', 82, 570, 880, {
        domain: 'Страхование',
        purpose: 'Связать привлечение, андеррайтинг, сопровождение, выплаты и продление.',
        stages: [
          { id: 'insurance-acquisition', name: 'Привлечение и котировка', status: 'unknown' },
          { id: 'insurance-underwriting', name: 'Андеррайтинг и выпуск полиса', status: 'unknown', dependsOn: ['insurance-acquisition'] },
          { id: 'insurance-claims', name: 'Урегулирование страховых случаев', status: 'unknown', dependsOn: ['insurance-underwriting'] },
          { id: 'insurance-renewal', name: 'Продление и удержание', status: 'unknown', dependsOn: ['insurance-underwriting'] },
        ],
      }),
    ]
  }
  return []
}

function buildGoalMetricWidgets(domain: LocalDomain): JourneyWidgetView[] {
  if (domain === 'tomato-retail') {
    return [
      widget('domain_metrics', 'Экономика свежего товара', 85, 570, 620, {
        domain: 'Розничная торговля свежими продуктами',
        purpose: 'Проверить, выдерживает ли экономика одной точки масштабирование до сети.',
        metrics: [
          { label: 'Списания', status: 'unknown' },
          { label: 'Валовая маржа', status: 'unknown' },
          { label: 'Капитал на открытие', status: 'unknown' },
        ],
        guidance: [{ title: 'Нужны данные точки', detail: 'Уточните маржу и списания.', status: 'question' }],
      }),
    ]
  }
  if (domain === 'insurance') {
    return [
      widget('domain_metrics', 'Экономика страхового портфеля', 85, 570, 620, {
        domain: 'Страхование',
        purpose: 'Понять качество портфеля до выбора рычагов роста и удержания.',
        metrics: [
          { label: 'Собранная премия', status: 'unknown' },
          { label: 'Loss ratio', status: 'unknown' },
          { label: 'Частота страховых случаев', status: 'unknown' },
          { label: 'Renewal rate', status: 'unknown' },
        ],
        guidance: [{ title: 'Нужны данные портфеля', detail: 'Назовите текущий renewal rate.', status: 'question' }],
      }),
    ]
  }
  return []
}

function buildRetirementWidgets(
  current: JourneyWidgetView[],
  domain: LocalDomain,
): JourneyWidgetView[] {
  if (domain === 'generic') return []
  return current
    .filter((item) => item.kind === 'crm_readiness' && !item.hidden)
    .map((item) => journeyWidgetSchema.parse({ ...item, collapsed: true, hidden: true }))
}

function russianNumber(value: string): number | undefined {
  const normalized = value.toLowerCase()
  const values: Record<string, number> = {
    один: 1,
    одна: 1,
    одно: 1,
    два: 2,
    три: 3,
    четыре: 4,
    пять: 5,
    шесть: 6,
    семь: 7,
    восемь: 8,
    девять: 9,
    десять: 10,
  }
  return values[normalized]
}

function widget(
  kind: JourneyWidgetKind,
  title: string,
  priority: number,
  x: number,
  y: number,
  data: Record<string, unknown>,
): JourneyWidgetView {
  return journeyWidgetSchema.parse({
    id: `widget-${kind}`,
    kind,
    title,
    priority,
    collapsed: false,
    hidden: false,
    focused: false,
    position: { x, y },
    data,
  })
}

function upsertWidgets(
  current: JourneyWidgetView[],
  incoming: JourneyWidgetView[],
  decisions: JourneyWidgetDecision[] = [],
  manualWidgetIds: string[] = [],
): JourneyWidgetView[] {
  const byKind = new Map(current.map((item) => [item.kind, item]))
  const decisionsById = new Map(decisions.map((decision) => [decision.widgetId, decision]))
  const manualIds = new Set(manualWidgetIds)
  for (const update of incoming) {
    const previous = byKind.get(update.kind)
    const resolvedId = previous?.id ?? update.id
    const shouldHide = decisionsById.get(update.id)?.action === 'hide' && !manualIds.has(resolvedId)
    byKind.set(update.kind, journeyWidgetSchema.parse(previous
      ? {
          ...update,
          id: resolvedId,
          collapsed: previous.collapsed,
          hidden: shouldHide ? true : previous.hidden,
          focused: previous.focused,
          position: previous.position,
        }
      : { ...update, hidden: shouldHide || update.hidden }))
  }
  return [...byKind.values()]
}

function buildWidgetDecisions(
  widgets: JourneyWidgetView[],
  domain: LocalDomain,
  facts: JourneyFactView[],
  existing: JourneyWidgetView[],
): JourneyWidgetDecision[] {
  const existingIds = new Set(existing.map((item) => item.id))
  const evidenceFactIds = facts
    .filter((fact) => fact.status !== 'rejected')
    .map((fact) => fact.id)
    .slice(0, 12)
  return widgets.map((item) => ({
    widgetId: item.id,
    kind: item.kind,
    action: item.hidden ? 'hide' : existingIds.has(item.id) ? 'update' : 'create',
    reason: localDecisionReason(item.kind, domain),
    evidenceFactIds,
  }))
}

function localDecisionReason(kind: JourneyWidgetKind, domain: LocalDomain): string {
  if (kind === 'business_passport') return 'Фиксирует Точку A только по фактам из сообщения пользователя.'
  if (kind === 'point_b_goals') return 'Пользователь сформулировал измеримую цель, поэтому она вынесена в Точку B.'
  if (kind === 'roadmap_actions') return 'Связывает подтверждённую Точку A с Точкой B через зависимые этапы.'
  if (kind === 'tasks_reminders') return 'Переводит ближайшие этапы дорожной карты в конкретные действия.'
  if (kind === 'knowledge_base') return 'Показывает честный статус загруженных файлов и их анализа.'
  if (kind === 'crm_readiness') return 'Сначала уточняет наличие CRM, не имитируя подключение системы.'
  if (kind === 'domain_metrics' && domain === 'insurance') {
    return 'Для страхового портфеля важны renewal rate, loss ratio, премия и частота случаев; неизвестные значения не выдумываются.'
  }
  if (kind === 'domain_metrics' && domain === 'tomato-retail') {
    return 'Для масштабирования магазина сначала нужны маржа, списания, запасы и поток покупателей одной точки.'
  }
  if (kind === 'domain_process' && domain === 'insurance') {
    return 'Цель продления зависит от связанного процесса выпуска, сопровождения и renewal.'
  }
  if (kind === 'domain_process' && domain === 'tomato-retail') {
    return 'Цель сети требует повторяемого процесса закупок, локации и открытия каждой точки.'
  }
  return 'Модуль выбран по текущему бизнес-контексту и безопасному типизированному реестру.'
}

function upsertWidgetDecisions(
  current: JourneyWidgetDecision[],
  incoming: JourneyWidgetDecision[],
): JourneyWidgetDecision[] {
  const next = new Map(current.map((decision) => [decision.widgetId, decision]))
  for (const decision of incoming) next.set(decision.widgetId, decision)
  return [...next.values()].slice(0, 24)
}

function mergeBusinessDescription(current: string, message: string): string {
  const text = message.trim()
  if (!text || current.toLowerCase().includes(text.toLowerCase())) return current
  return [current, text].filter(Boolean).join('\n').slice(0, 4_000)
}

function pluralizeFact(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'факт'
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'факта'
  return 'фактов'
}
