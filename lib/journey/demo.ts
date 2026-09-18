import { randomUUID } from 'node:crypto'
import {
  journeyStateSchema,
  journeyWidgetSchema,
  type JourneyFact,
  type JourneyGoal,
  type JourneyRoadmapItem,
  type JourneyState,
  type JourneySuggestion,
  type JourneyWidget,
  type JourneyWidgetDecision,
} from './schema'

function makeId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

export function createEmptyJourneyState(workspaceId: string): JourneyState {
  const now = new Date().toISOString()
  return journeyStateSchema.parse({
    version: 1,
    workspaceId,
    phase: 'empty',
    companyName: '',
    businessDescription: '',
    messages: [
      {
        id: `welcome-${workspaceId}`.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 120),
        role: 'assistant',
        text: 'Расскажите о бизнесе своими словами. Я задам по одному вопросу, подтвержу факты и построю путь из Точки A в вашу измеримую Точку B.',
        createdAt: now,
      },
    ],
    facts: [],
    goals: [],
    roadmap: [],
    widgets: [],
    widgetDecisions: [],
    manualWidgetIds: [],
    widgetOrder: [],
    files: [],
    suggestions: [
      {
        id: 'start-business',
        label: 'Описать бизнес',
        value: 'Расскажу, чем занимается бизнес, кому продаёт и в каком он состоянии сейчас.',
        target: 'point-a',
        status: 'active',
      },
      {
        id: 'start-file',
        label: 'Загрузить файл',
        value: 'Сначала загружу отчёт или таблицу с данными.',
        target: 'chat',
        status: 'active',
      },
    ],
    provider: { mode: 'demo', label: 'Демо-режим · без внешней AI-модели' },
    persistence: {
      mode: 'local',
      label: 'Локальное сохранение',
      reason: 'База данных не подключена; данные остаются в этом браузере.',
    },
    serverRevision: 0,
    updatedAt: now,
  })
}

export function deterministicOrchestrator(
  currentInput: JourneyState,
  message: string,
  reason = 'OPENROUTER_API_KEY отсутствует или AI-ответ не прошёл проверку схемой.',
): JourneyState {
  const current = journeyStateSchema.parse(currentInput)
  const text = message.trim()
  const now = new Date().toISOString()
  const userMessage = {
    id: makeId('message'),
    role: 'user' as const,
    text,
    createdAt: now,
  }

  if (isGoalMessage(current, text)) {
    return buildGoalTurn(current, userMessage, text, reason)
  }

  const extracted = extractLiteralFacts(text)
  const known = new Set(current.facts.map((fact) => `${fact.label}:${fact.value}`.toLowerCase()))
  const newFacts = extracted.filter((fact) => !known.has(`${fact.label}:${fact.value}`.toLowerCase()))
  const facts = [...current.facts, ...newFacts]
  const domain = detectDomain(`${current.businessDescription} ${text}`)
  const selectedWidgets = [
    ...buildDiscoveryWidgets(domain, facts, current.files),
    ...buildRetirementWidgets(current.widgets, domain),
  ]
  const widgetDecisions = buildWidgetDecisions(selectedWidgets, domain, facts, current.widgets)
  const widgets = upsertWidgets(
    current.widgets,
    selectedWidgets,
    widgetDecisions,
    current.manualWidgetIds ?? [],
  )
  const assistantText = newFacts.length
    ? `Я выделил ${newFacts.length} ${factWord(newFacts.length)} только из вашего сообщения. Подтвердите или исправьте их — после этого они станут Точкой A.`
    : current.facts.some((fact) => fact.status === 'confirmed')
      ? 'Точка A уже содержит подтверждённые факты. Теперь сформулируйте один измеримый результат и срок для Точки B.'
      : 'Я сохранил сообщение, но не стал угадывать факты. Уточните одним сообщением: что вы продаёте, кому и что уже работает сейчас?'

  return journeyStateSchema.parse({
    ...current,
    phase: facts.length ? 'partial' : current.phase,
    businessDescription: mergeBusinessDescription(current.businessDescription, text),
    messages: [
      ...current.messages,
      userMessage,
      { id: makeId('message'), role: 'assistant', text: assistantText, createdAt: now },
    ].slice(-80),
    facts,
    widgets,
    widgetDecisions: upsertWidgetDecisions(
      current.widgetDecisions ?? [],
      widgetDecisions,
    ),
    suggestions: newFacts.length
      ? [suggestion('confirm-facts', 'Подтвердить факты', 'Покажи факты для подтверждения.', 'point-a')]
      : [suggestion('describe-goal', 'Задать Точку B', 'Хочу описать измеримую цель и срок.', 'point-b')],
    provider: { mode: 'demo', label: 'Демо-режим · детерминированная логика' },
    persistence: {
      ...current.persistence,
      reason,
    },
    updatedAt: now,
  })
}

function buildGoalTurn(
  current: JourneyState,
  userMessage: { id: string; role: 'user'; text: string; createdAt: string },
  text: string,
  reason: string,
): JourneyState {
  const now = new Date().toISOString()
  const domain = detectDomain(`${current.businessDescription} ${text}`)
  const parsedTarget = extractGoalTarget(text)
  const goal: JourneyGoal = {
    id: makeId('goal'),
    title: text,
    metric: parsedTarget?.metric,
    target: parsedTarget?.target,
    deadline: extractDeadline(text),
    status: 'confirmed',
  }
  const measurable = Boolean(goal.metric && goal.target && goal.deadline)
  const roadmap = buildRoadmap(domain, goal)
  const selectedWidgets = [
    widget('point_b_goals', 'Точка B', 100, 740, 620, { goals: [goal] }),
    widget('roadmap_actions', 'Путь к Точке B', 95, 1_060, 620, { items: roadmap }),
    ...buildDiscoveryWidgets(domain, current.facts, current.files)
      .filter((item) => item.kind === 'domain_metrics'),
    ...buildDomainTransformationWidgets(domain),
    widget('tasks_reminders', 'Ближайшие действия', 76, 420, 880, {
      items: roadmap.slice(0, 4).map((item) => ({
        id: `task-${item.id}`.slice(0, 120),
        text: item.title,
        due: item.horizon,
        done: item.status === 'done',
      })),
    }),
    ...buildRetirementWidgets(current.widgets, domain),
  ]
  const widgetDecisions = buildWidgetDecisions(selectedWidgets, domain, current.facts, current.widgets)
  const widgets = upsertWidgets(
    current.widgets,
    selectedWidgets,
    widgetDecisions,
    current.manualWidgetIds ?? [],
  )

  return journeyStateSchema.parse({
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
          ? 'Цель записана в Точку B. Я разложил путь на зависимые этапы и добавил только релевантные этой бизнес-модели модули. Неизвестные показатели оставлены вопросами, а не вымышленными цифрами.'
          : 'Цель сохранена как черновик. Чтобы сделать Точку B измеримой, уточните показатель, целевое значение и срок.',
        createdAt: now,
      },
    ].slice(-80),
    goals: [goal, ...current.goals].slice(0, 20),
    roadmap,
    widgets,
    widgetDecisions: upsertWidgetDecisions(
      current.widgetDecisions ?? [],
      widgetDecisions,
    ),
    suggestions: [
      suggestion('discuss-next', 'Обсудить первый этап', 'Давай подробно разберём первый этап.', 'roadmap'),
      suggestion('check-assumptions', 'Проверить пробелы', 'Каких данных не хватает для этого пути?', 'widget'),
    ],
    provider: { mode: 'demo', label: 'Демо-режим · детерминированная логика' },
    persistence: { ...current.persistence, reason },
    updatedAt: now,
  })
}

function extractLiteralFacts(text: string): JourneyFact[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const facts: JourneyFact[] = [
    {
      id: makeId('fact'),
      label: 'Описание бизнеса',
      value: clean,
      category: 'business',
      sourceLabel: 'Сообщение пользователя',
      confidence: 1,
      status: 'pending',
    },
  ]

  const stores = clean.match(/(?:один|1)\s+(?:магазин|точк[а-яё]*)/i)
  if (stores) facts.push(literalFact('Количество точек', '1 магазин', 'operations'))

  if (/помидор|овощ/i.test(clean)) {
    facts.push(literalFact('Формат бизнеса', 'Розничная торговля овощами', 'business'))
  } else if (/страхов|полис|андеррайт/i.test(clean)) {
    facts.push(literalFact('Формат бизнеса', 'Страхование', 'business'))
  } else if (isCommerceRetailDescription(clean)) {
    facts.push(literalFact('Формат бизнеса', 'Розничная торговля', 'business'))
    if (/интернет[-\s]?магазин|онлайн[-\s]?магазин|e[-\s]?commerce|ecommerce/i.test(clean)) {
      facts.push(literalFact('Канал продаж', 'Интернет-магазин', 'sales'))
    }
  }

  const team = clean.match(/(?:команд[а-яё]*|штат[а-яё]*)\D{0,18}(\d{1,5})\s*(?:человек|сотрудник[а-яё]*)?/i)
  if (team?.[1]) facts.push(literalFact('Размер команды', `${team[1]} человек`, 'team'))

  const revenue = clean.match(
    /выручк[а-яё]*\s*(?:около|примерно|~)?\s*([\d.,]+\s*(?:тыс(?:яч[аи])?|млн|миллион[а-яё]*|млрд|миллиард[а-яё]*)?\s*(?:₸|тенге|тг|kzt)?(?:\s*в\s*(?:месяц|год))?)/i,
  )
  if (revenue?.[1]) facts.push(literalFact('Выручка', revenue[1].trim(), 'finance'))

  const crm = clean.match(/(?:есть|используем|нет|без)\s+(?:никакой\s+)?crm|crm\D{0,18}(?:есть|используем|нет|отсутствует)/i)
  if (crm) facts.push(literalFact('CRM', /(?:нет|без)/i.test(crm[0]) ? 'Нет' : 'Есть', 'sales'))

  return facts.slice(0, 8)
}

function literalFact(
  label: string,
  value: string,
  category: JourneyFact['category'],
): JourneyFact {
  return {
    id: makeId('fact'),
    label,
    value,
    category,
    sourceLabel: 'Сообщение пользователя',
    confidence: 1,
    status: 'pending',
  }
}

type Domain = 'tomato-retail' | 'commerce-retail' | 'insurance' | 'generic'

function isCommerceRetailDescription(text: string): boolean {
  return /интернет[-\s]?магазин|онлайн[-\s]?магазин|e[-\s]?commerce|ecommerce|розничн[а-яё]*\s+торговл|outdoor\s*[-/]?\s*(?:apparel|одежд)|(?:магазин|розниц[а-яё]*)[^.]{0,40}(?:одежд|обув|outdoor)/i.test(text)
}

function detectDomain(text: string): Domain {
  if (/помидор|овощ|овощн[а-яё]* магазин/i.test(text)) return 'tomato-retail'
  if (/страхов|полис|андеррайт|renewal\s*rate|дол[яю]\s+продлен|процент\s+продлен|страхов[а-яё]* случа/i.test(text)) return 'insurance'
  if (isCommerceRetailDescription(text)) return 'commerce-retail'
  return 'generic'
}

function buildDiscoveryWidgets(
  domain: Domain,
  facts: JourneyFact[],
  files: JourneyState['files'],
): JourneyWidget[] {
  const result: JourneyWidget[] = [
    widget('business_passport', 'Паспорт бизнеса', 100, 100, 620, {
      facts: facts.filter((fact) => fact.status !== 'rejected'),
    }),
  ]

  if (domain === 'tomato-retail') {
    result.push(
      widget('domain_metrics', 'Экономика и запасы магазина', 92, 420, 620, {
        domain: 'Розничный магазин свежих продуктов',
        purpose: 'Проверить готовность экономики одной точки к масштабированию.',
        metrics: [
          { label: 'Валовая маржа точки', status: 'unknown' },
          { label: 'Списания', status: 'unknown' },
          { label: 'Оборачиваемость запасов', status: 'unknown' },
          { label: 'Дневной поток покупателей', status: 'unknown' },
        ],
        guidance: [
          {
            title: 'Следующий вопрос',
            detail: 'Какая выручка, маржа и доля списаний у текущего магазина за обычный месяц?',
            status: 'question',
          },
        ],
      }),
    )
  } else if (domain === 'commerce-retail') {
    result.push(
      widget('domain_metrics', 'Продажи, ассортимент и наличие', 92, 420, 620, {
        domain: 'Интернет-магазин и розничная торговля',
        purpose: 'Собрать подтверждённую базу продаж, маржи и наличия до выбора рычага роста.',
        metrics: [
          { label: 'Выручка', status: 'unknown' },
          { label: 'Валовая маржа', status: 'unknown' },
          { label: 'Средний чек', status: 'unknown' },
          { label: 'Конверсия заказа', status: 'unknown' },
          { label: 'Доля отсутствующих товаров', status: 'unknown' },
          { label: 'Оборачиваемость запасов', status: 'unknown' },
        ],
        guidance: [
          {
            title: 'Нужен исходный факт',
            detail: 'Подтвердите выручку, заказы, валовую маржу и наличие товаров за один сопоставимый период.',
            status: 'question',
          },
        ],
      }),
    )
  } else if (domain === 'insurance') {
    result.push(
      widget('domain_metrics', 'Экономика страхового портфеля', 92, 420, 620, {
        domain: 'Страхование',
        purpose: 'Понять качество и устойчивость портфеля до выбора рычагов роста.',
        metrics: [
          { label: 'Собранная премия', status: 'unknown' },
          { label: 'Loss ratio', status: 'unknown' },
          { label: 'Частота страховых случаев', status: 'unknown' },
          { label: 'Renewal rate', status: 'unknown' },
        ],
        guidance: [
          {
            title: 'Нужны данные портфеля',
            detail: 'Загрузите обезличенную выгрузку полисов и выплат либо назовите один подтверждённый показатель.',
            status: 'question',
          },
        ],
      }),
    )
  } else {
    result.push(
      widget('crm_readiness', 'CRM readiness', 72, 420, 620, {
        hasCrm: null,
        connectionStatus: 'unknown',
        nextStep: 'Сначала уточнить: есть ли CRM и нужна ли она для этой бизнес-модели.',
        alternatives: [],
      }),
    )
  }

  if (files.length > 0) {
    result.push(widget('knowledge_base', 'База знаний', 70, 740, 880, { files }))
  }
  return result
}

function buildDomainTransformationWidgets(domain: Domain): JourneyWidget[] {
  if (domain === 'tomato-retail') {
    return [
      widget('domain_process', 'Открытие новых магазинов', 91, 100, 880, {
        domain: 'Розничная сеть свежих продуктов',
        purpose: 'Не открывать следующую точку, пока не подтверждена воспроизводимость первой.',
        stages: [
          { id: 'store-unit-economics', name: 'Экономика первой точки', status: 'next', nextAction: 'Подтвердить маржу, списания и денежный цикл.' },
          { id: 'store-supply-standard', name: 'Стандарт закупок и запасов', status: 'blocked', nextAction: 'Описать поставщиков, частоту закупок и контроль качества.', dependsOn: ['store-unit-economics'] },
          { id: 'store-location-model', name: 'Модель выбора локации', status: 'blocked', nextAction: 'Зафиксировать критерии трафика, аренды и зоны доставки.', dependsOn: ['store-unit-economics'] },
          { id: 'store-opening-playbook', name: 'Чек-лист открытия', status: 'blocked', nextAction: 'Собрать бюджет, роли, сроки и контроль запуска.', dependsOn: ['store-supply-standard', 'store-location-model'] },
        ],
      }),
    ]
  }

  if (domain === 'insurance') {
    return [
      widget('domain_process', 'Путь страхового портфеля', 91, 100, 880, {
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

  if (domain === 'commerce-retail') {
    return [
      widget('domain_process', 'Путь заказа и повторной покупки', 91, 100, 880, {
        domain: 'Интернет-магазин и розничная торговля',
        purpose: 'Связать заказ с наличием, резервом, исполнением, доставкой и повторной покупкой.',
        stages: [
          { id: 'commerce-order', name: 'Заказ', status: 'unknown', nextAction: 'Подтвердить канал, статус заказа и источник учёта.' },
          { id: 'commerce-stock', name: 'Наличие и резерв', status: 'unknown', nextAction: 'Проверить, как остаток и резерв подтверждаются до продажи.', dependsOn: ['commerce-order'] },
          { id: 'commerce-fulfillment', name: 'Сборка и отгрузка', status: 'unknown', nextAction: 'Зафиксировать владельца, срок и статус исполнения.', dependsOn: ['commerce-stock'] },
          { id: 'commerce-delivery', name: 'Доставка и возврат', status: 'unknown', nextAction: 'Собрать факты о сроках, отменах и возвратах.', dependsOn: ['commerce-fulfillment'] },
          { id: 'commerce-repeat', name: 'Повторная покупка', status: 'unknown', nextAction: 'Уточнить, как измеряются повторные заказы и удержание.', dependsOn: ['commerce-delivery'] },
        ],
      }),
    ]
  }

  return []
}

function buildRetirementWidgets(current: JourneyWidget[], domain: Domain): JourneyWidget[] {
  if (domain === 'generic') return []
  return current
    .filter((item) => item.kind === 'crm_readiness' && !item.hidden)
    .map((item) => journeyWidgetSchema.parse({ ...item, collapsed: true, hidden: true }))
}

function buildRoadmap(domain: Domain, goal: JourneyGoal): JourneyRoadmapItem[] {
  if (domain === 'tomato-retail') {
    const economy = makeId('roadmap')
    const standard = makeId('roadmap')
    const locations = makeId('roadmap')
    return [
      roadmap(economy, 'Подтвердить экономику первой точки', 'Собрать фактические продажи, валовую маржу, списания, аренду и денежный цикл.', '0–30 дней', 'next'),
      roadmap(standard, 'Стандартизировать закупки и запасы', 'Описать поставщиков, контроль качества, минимальные остатки и ответственность за списания.', '31–60 дней', 'planned', [economy]),
      roadmap(locations, 'Проверить локации и бюджет открытия', 'Сравнить кандидатов по трафику, аренде, логистике и требуемому оборотному капиталу.', '61–90 дней', 'planned', [economy]),
      roadmap(makeId('roadmap'), 'Открывать точки поэтапно', `Проверять фактическую экономику каждой новой точки относительно цели «${goal.title}».`, 'После 90 дней', 'planned', [standard, locations]),
    ]
  }

  if (domain === 'insurance') {
    const baseline = makeId('roadmap')
    const journey = makeId('roadmap')
    const experiment = makeId('roadmap')
    return [
      roadmap(baseline, 'Подтвердить базовый renewal rate', 'Зафиксировать текущую долю продлений, когорту полисов и единый источник измерения.', '0–30 дней', 'next'),
      roadmap(journey, 'Разобрать путь клиента до продления', 'Найти подтверждённые потери между уведомлением, предложением, оплатой и выпуском нового полиса.', '31–60 дней', 'planned', [baseline]),
      roadmap(experiment, 'Запустить один рычаг удержания', 'Выбрать сегмент, действие, владельца и контрольную группу, не подменяя факт прогнозом.', '61–90 дней', 'planned', [journey]),
      roadmap(makeId('roadmap'), 'Масштабировать подтверждённый сценарий', `Сравнить результат с целью «${goal.title}» и расширять только доказавший эффект процесс.`, 'После 90 дней', 'planned', [experiment]),
    ]
  }

  if (domain === 'commerce-retail') {
    const baseline = makeId('roadmap')
    const assortment = makeId('roadmap')
    const fulfillment = makeId('roadmap')
    const experiment = makeId('roadmap')
    return [
      roadmap(baseline, 'Подтвердить базу продаж и маржи', 'Согласовать период, источник выручки, заказов, валовой маржи и наличия товаров.', '0–30 дней', 'next'),
      roadmap(assortment, 'Разобрать ассортимент и наличие', 'Найти подтверждённые дефициты, излишки и позиции, влияющие на достижение цели.', '31–60 дней', 'planned', [baseline]),
      roadmap(fulfillment, 'Проверить путь заказа до доставки', 'Сопоставить фактические статусы наличия, резерва, сборки, отгрузки, доставки и возврата.', '31–60 дней', 'planned', [baseline]),
      roadmap(experiment, 'Запустить один проверяемый рычаг роста', 'Выбрать владельца, сегмент и измеримый сигнал; масштабировать только подтверждённый результат.', '61–90 дней', 'planned', [assortment, fulfillment]),
      roadmap(makeId('roadmap'), 'Сверить фактический результат с Точкой B', `Сопоставить выручку и связанные операционные факты с целью «${goal.title}».`, 'После 90 дней', 'planned', [experiment]),
    ]
  }

  const baseline = makeId('roadmap')
  const experiment = makeId('roadmap')
  return [
    roadmap(baseline, 'Зафиксировать базовую метрику Точки A', 'Согласовать источник и способ измерения текущего значения.', '0–30 дней', 'next'),
    roadmap(experiment, 'Выбрать первый проверяемый рычаг', 'Назначить действие, владельца, срок и ожидаемый сигнал — без подмены результата прогнозом.', '31–60 дней', 'planned', [baseline]),
    roadmap(makeId('roadmap'), 'Сверить прогресс с Точкой B', `Сопоставить факт с целью «${goal.title}» и пересобрать следующий цикл.`, '61–90 дней', 'planned', [experiment]),
  ]
}

function roadmap(
  id: string,
  title: string,
  description: string,
  horizon: string,
  status: JourneyRoadmapItem['status'],
  dependsOn: string[] = [],
): JourneyRoadmapItem {
  return { id, title, description, horizon, progress: 0, status, dependsOn }
}

function isGoalMessage(state: JourneyState, text: string): boolean {
  if (!state.facts.some((fact) => fact.status === 'confirmed')) return false
  return /(?:цель|хочу|планир|открыть|увелич|сниз|достичь|вырасти).*(?:\d|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|месяц|год|%)/i.test(text)
}

function extractGoalTarget(text: string): { metric: string; target: string } | undefined {
  const wordNumbers: Record<string, string> = {
    один: '1', два: '2', три: '3', четыре: '4', пять: '5', шесть: '6', семь: '7', восемь: '8', девять: '9', десять: '10',
  }
  const stores = text.match(/(\d+|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять)\s+(магазин[а-яё]*|точ[а-яё]*)/i)
  if (stores) {
    const value = wordNumbers[stores[1].toLowerCase()] ?? stores[1]
    return { metric: 'Количество магазинов', target: `${value} магазинов` }
  }
  const renewal = text.match(/(?:renewal\s*rate|дол[яю]\s+продлен[а-яё]*|процент\s+продлен[а-яё]*)[^\d]{0,30}(\d+(?:[.,]\d+)?\s*%)/i)
  if (renewal?.[1]) return { metric: 'Renewal rate', target: renewal[1].replace(/\s+/g, '') }
  const revenue = text.match(/выручк[а-яё]*[^.]{0,80}?(?:до|на)\s+([\d.,]+\s*(?:тыс(?:яч[аи])?|млн|миллион[а-яё]*|млрд|миллиард[а-яё]*)?(?:\s*(?:₸|тенге|тг|kzt))?)/i)
  if (revenue?.[1]) return { metric: 'Выручка', target: revenue[1].trim() }
  const number = text.match(/(?:до|на)\s+([\d.,]+\s*(?:%|тыс(?:яч[аи])?|млн|миллион[а-яё]*|млрд)?(?:\s*(?:₸|тенге|тг|kzt))?)/i)
  return number ? { metric: 'Целевой показатель', target: number[1].trim() } : undefined
}

function extractDeadline(text: string): string | undefined {
  return text.match(/(?:за|через|к)\s+(\d+\s*(?:недел[а-яё]*|месяц[а-яё]*|год[а-яё]*|квартал[а-яё]*))/i)?.[1]?.trim()
}

function widget(
  kind: JourneyWidget['kind'],
  title: string,
  priority: number,
  x: number,
  y: number,
  data: Record<string, unknown>,
): JourneyWidget {
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
  current: JourneyWidget[],
  incoming: JourneyWidget[],
  decisions: JourneyWidgetDecision[],
  manualWidgetIds: string[],
): JourneyWidget[] {
  const next = new Map(current.map((item) => [item.kind, item]))
  const decisionsById = new Map(decisions.map((decision) => [decision.widgetId, decision]))
  const manualIds = new Set(manualWidgetIds)
  for (const item of incoming) {
    const previous = next.get(item.kind)
    const resolvedId = previous?.id ?? item.id
    const shouldHide = decisionsById.get(item.id)?.action === 'hide' && !manualIds.has(resolvedId)
    next.set(item.kind, previous
      ? {
          ...item,
          id: resolvedId,
          collapsed: previous.collapsed,
          hidden: shouldHide ? true : previous.hidden,
          focused: previous.focused,
          position: previous.position,
        } as JourneyWidget
      : { ...item, hidden: shouldHide || item.hidden } as JourneyWidget)
  }
  let expanded = 0
  return [...next.values()]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 24)
    .map((item) => {
      if (item.hidden || item.collapsed) return item
      expanded += 1
      return expanded <= 4 ? item : { ...item, collapsed: true } as JourneyWidget
    })
}

function buildWidgetDecisions(
  widgets: JourneyWidget[],
  domain: Domain,
  facts: JourneyFact[],
  existing: JourneyWidget[],
): JourneyWidgetDecision[] {
  const existingIds = new Set(existing.map((widget) => widget.id))
  const evidenceFactIds = facts
    .filter((fact) => fact.status !== 'rejected')
    .map((fact) => fact.id)
    .slice(0, 12)

  return widgets.map((item) => ({
    widgetId: item.id,
    kind: item.kind,
    action: item.hidden ? 'hide' : existingIds.has(item.id) ? 'update' : 'create',
    reason: widgetDecisionReason(item.kind, domain),
    evidenceFactIds,
  }))
}

function widgetDecisionReason(kind: JourneyWidget['kind'], domain: Domain): string {
  const business = domain === 'tomato-retail'
    ? 'магазину свежих продуктов'
    : domain === 'commerce-retail'
      ? 'интернет-магазину и розничному бизнесу'
    : domain === 'insurance'
      ? 'страховому бизнесу'
      : 'этому бизнесу'
  const reasons: Record<JourneyWidget['kind'], string> = {
    business_passport: `Фиксирует проверяемую Точку A по фактам, которые сообщил пользователь о ${business}.`,
    business_health: 'Показывает только подтверждённые зоны зрелости и оставляет пробелы неизвестными.',
    point_b_goals: 'Пользователь сформулировал измеримую Точку B, поэтому цель вынесена отдельно.',
    roadmap_actions: 'Связывает подтверждённую Точку A с целью через зависимые проверяемые этапы.',
    crm_readiness: 'Нужно сначала уточнить наличие CRM, прежде чем советовать подключение или замену.',
    sales_funnel: 'Продажи зависят от последовательных стадий и измеримых переходов между ними.',
    marketing_growth: 'Контекст содержит задачу роста, для которой важно проверить реальные каналы привлечения.',
    finance_cashflow: 'Для решения требуется финансовая опора; неизвестные значения остаются вопросами.',
    operations_team: 'Масштабирование зависит от повторяемых процессов, ролей и операционной мощности.',
    risks_opportunities: 'Достаточно контекста, чтобы зафиксировать проверяемые риски и возможности без рыночных выдумок.',
    news_digest: 'Модуль допустим только как честное состояние подключения проверенного источника.',
    tasks_reminders: 'Дорожная карта содержит ближайшие действия, которые полезно вынести в рабочий список.',
    learning_resources: 'Модуль допустим только после подключения проверенного каталога материалов.',
    knowledge_base: 'В рабочей области есть файлы, поэтому нужен прозрачный статус их анализа.',
    external_sources: 'Для следующего решения нужны данные, которые могут прийти только из подключённой системы.',
    domain_metrics: domain === 'tomato-retail'
      ? 'Для роста сети нужно сначала измерить маржу, списания, запасы и поток покупателей одной точки.'
      : domain === 'commerce-retail'
        ? 'Для роста торговли нужны подтверждённые продажи, маржа, конверсия, наличие и оборачиваемость; неизвестные значения не выдумываются.'
      : domain === 'insurance'
        ? 'Для страхового портфеля важны renewal rate, премия, частота случаев и loss ratio; неизвестные значения не выдумываются.'
        : 'Нужны отраслевые показатели, адаптированные к бизнес-модели, а не универсальная панель.',
    domain_process: domain === 'tomato-retail'
      ? 'Цель сети требует повторяемого процесса закупок, выбора локации и открытия каждой точки.'
      : domain === 'commerce-retail'
        ? 'Цель торговли зависит от связанного пути заказа, наличия, резерва, исполнения, доставки и повторной покупки.'
      : domain === 'insurance'
        ? 'Цель продления зависит от связанного процесса котировки, выпуска, сопровождения и renewal.'
        : 'Цель зависит от повторяемого отраслевого процесса с явными зависимостями.',
  }
  return reasons[kind]
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

function suggestion(
  id: string,
  label: string,
  value: string,
  target: JourneySuggestion['target'],
): JourneySuggestion {
  return { id, label, value, target, status: 'active' }
}

function factWord(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'факт'
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'факта'
  return 'фактов'
}
