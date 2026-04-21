// Call-list XLSX generator — mirrors the 4-sheet structure of the
// Обзвон_контакты_Сау_Журек.xlsx reference file:
//   1. Обзор стратегии       — key numbers + segment breakdown
//   2. Список обзвона        — 2 747 patients sorted by priority, 16 columns
//   3. Скрипты звонков       — per-segment call scripts (8 sections)
//   4. Инструкция оператору  — call-center SOP
//
// Output: Buffer (xlsx bytes) that the API route streams back as download.

import * as XLSX from 'xlsx'
import type { SegmentedPatient, SegmentationResult, PatientSegmentId } from '@/lib/rfm-segmentation'
import { SEGMENT_LABELS } from '@/lib/rfm-segmentation'
import type { BundleCalculation } from '@/lib/clinic-bundles'
import type { RevenueAudit } from '@/lib/revenue-audit'

export interface CallListInput {
  clinic_name: string
  segmentation: SegmentationResult
  bundles: BundleCalculation[]
  audit: RevenueAudit
  /** Full patient list enriched with display-name/phone for call-center UI.
   *  Must come from patient_segments (DB) + optional PII overlay from original file. */
  patients: Array<SegmentedPatient & { phone?: string | null }>
}

// ── Per-segment call scripts (templates from Sau_Zhurek reference doc) ─────
const SEGMENT_SCRIPTS: Record<PatientSegmentId, {
  purpose: string
  opening: string
  qualifier: string
  offer: string
  objections: string
}> = {
  vip_retention: {
    purpose: 'Плановый контроль + забота о постоянном пациенте',
    opening: 'Здравствуйте, [ФИО]! Это [Имя оператора] из клиники [название]. Вам удобно говорить 1–2 минуты? Я звоню, потому что Вы наш постоянный пациент, и доктор рекомендует проходить плановый контроль каждые 3 месяца.',
    qualifier: 'Что сейчас Вас беспокоит больше всего — давление, ритм, одышка, другое? Принимаете ли Вы сейчас препараты, которые назначил врач?',
    offer: 'По Вашему профилю подойдёт один из профильных чек-апов. Мы готовы записать на удобное время на этой неделе.',
    objections: '«Нет времени» → вечернее/субботнее окно. «Всё хорошо» → «Именно поэтому важно пройти контроль, чтобы не пропустить скрытые изменения». «Дорого» → для постоянных пациентов персональная цена.',
  },
  vip_reactivation: {
    purpose: 'Возврат VIP: врач ждёт + контрольный чек-ап',
    opening: 'Здравствуйте, [ФИО]! Это [Имя оператора] из клиники [название]. Давно не виделись — Вы были у нас [N] месяцев назад. Доктор справлялся о Вас — как самочувствие?',
    qualifier: 'Что-то изменилось в самочувствии? Принимаете ли Вы препараты?',
    offer: 'Предлагаю контрольный чек-ап по Вашему профилю. Для постоянных — скидка 10–15%.',
    objections: '«Наблюдаюсь в другом месте» → запомнить и поблагодарить. «Нет времени» → короткий чек-ап за 1 визит.',
  },
  loyal_active: {
    purpose: 'Cross-sell профильного чек-апа',
    opening: 'Здравствуйте, [ФИО]! Это клиника [название]. Вы недавно были у нас [дата визита].',
    qualifier: 'Доктор рекомендовал какие-то обследования? Прошли их?',
    offer: 'Предлагаю дополнительное обследование или чек-ап по профилю — сэкономит время.',
    objections: '«Уже прошёл» → уточнить и поблагодарить. «Ничего не беспокоит» → сезонный скрининг со скидкой.',
  },
  churn_risk: {
    purpose: 'Пост-диагностический провал: закрыть цикл',
    opening: 'Здравствуйте, [ФИО]! [N] дней назад вы проходили у нас [обследование]. Мы хотели уточнить, что с результатами.',
    qualifier: 'Вы показали результаты врачу? Начали рекомендованное лечение?',
    offer: 'Запишитесь на контрольный приём для разбора результатов и корректировки назначений.',
    objections: '«Некогда» → перезвонить в удобное время. «Результаты уже видел другой врач» → уточнить впечатления.',
  },
  sleeping: {
    purpose: 'Мягкая реактивация через сезонный повод',
    opening: 'Здравствуйте, [ФИО]! Это [название]. Прошло уже больше полугода.',
    qualifier: 'Как Ваше самочувствие? Что беспокоит?',
    offer: 'Сезонный скрининг со скидкой 20–25%. Не обязывает — просто проверка.',
    objections: '«Забыл о клинике» → мягко напомнить о плюсах клиники, не давить.',
  },
  one_time_fresh: {
    purpose: 'Второй визит — критично для LTV',
    opening: 'Здравствуйте, [ФИО]! Вы были у нас недавно. Доктор рекомендовал [повторный приём / обследование]?',
    qualifier: 'Прошли ли Вы рекомендованное? Как самочувствие?',
    offer: 'Расширенная диагностика или второй приём для контроля лечения.',
    objections: '«Дорого» → разбить на этапы. «Нет жалоб» → профилактический чек-ап.',
  },
  one_time_old: {
    purpose: 'Годовой контроль',
    opening: 'Здравствуйте, [ФИО]! Это [название]. Вы были у нас около года назад.',
    qualifier: 'Прошёл год — самое время на профилактику. Как Вы себя чувствуете?',
    offer: 'Ежегодный чек-ап по специальной цене возврата.',
    objections: '«Не было проблем» → профилактика дешевле лечения.',
  },
  dead_lead: {
    purpose: 'Верификация контакта + акционный первичный приём',
    opening: 'Здравствуйте, [ФИО]! Вы записывались к нам, но не смогли прийти. Всё в порядке?',
    qualifier: 'Что тогда помешало? Нужен ли Вам приём сейчас?',
    offer: 'Акция 50% на первичный приём кардиолога — всего 10 мест.',
    objections: '«Не нужно» → аккуратно закрыть. «Кто вы?» → напомнить клинику, возможно ошибка базы.',
  },
}

// ── Sheet 1: Обзор стратегии ────────────────────────────────────────────────

function sheetOverview(input: CallListInput): XLSX.WorkSheet {
  const seg = input.segmentation
  const rows: unknown[][] = []
  rows.push([`${input.clinic_name} · Стратегия работы с клиентской базой`])
  rows.push([])
  rows.push(['Дата анализа', new Date().toLocaleDateString('ru-RU')])
  rows.push(['Всего пациентов в базе', seg.totals.total_patients])
  rows.push(['Суммарный LTV', `${(seg.totals.total_ltv_kzt / 1_000_000).toFixed(1)} M ₸`])
  rows.push(['Средний чек', `${seg.totals.avg_check_kzt.toLocaleString('ru-RU')} ₸`])
  rows.push(['Активные (≤90 дн)', seg.totals.active_last_90d])
  rows.push(['Спящие (>180 дн)', seg.totals.sleeping_180d_plus])
  rows.push(['Мёртвые лиды (0 визитов)', seg.totals.dead_leads])
  rows.push([])
  rows.push(['Пороги сегментации'])
  rows.push(['VIP LTV, ₸',           seg.thresholds.vip_ltv_kzt])
  rows.push(['Активный порог, дн',   seg.thresholds.recency_active_days])
  rows.push(['Спящий порог, дн',     seg.thresholds.recency_sleeping_days])
  rows.push([])
  rows.push(['8 сегментов по приоритету обзвона'])
  rows.push(['Приоритет', 'Сегмент', 'Количество', 'Суммарный LTV, ₸', 'Средний LTV, ₸', 'Средняя давность, дн'])
  for (const s of seg.summary) {
    rows.push([s.priority, s.label, s.count, s.total_ltv_kzt, s.avg_ltv_kzt, s.avg_recency_days])
  }
  rows.push([])
  rows.push(['Карта потерь выручки — оценка'])
  rows.push(['Категория', 'Потери/мес, ₸', 'Тяжесть'])
  for (const l of input.audit.losses) {
    rows.push([l.label, l.estimated_loss_kzt, l.severity])
  }
  rows.push(['ИТОГО', input.audit.total_loss_kzt, ''])
  rows.push([])
  rows.push(['9 связок роста — потенциал'])
  rows.push(['Приоритет', 'Связка', 'Целевые пациенты', 'Конверсия %', 'Выручка/мес, ₸', 'Срок эффекта', 'Сложность'])
  for (const b of input.bundles) {
    rows.push([b.priority, b.label, b.target_patient_count, b.estimated_conversion, b.estimated_revenue_kzt, b.effect_timeline, b.complexity])
  }
  rows.push(['ИТОГО', '', '', '', input.bundles.reduce((s, b) => s + b.estimated_revenue_kzt, 0), '', ''])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 24 }, { wch: 44 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
  return ws
}

// ── Sheet 2: Список обзвона (main deliverable) ──────────────────────────────

function sheetCallList(input: CallListInput): XLSX.WorkSheet {
  // Sort by priority → within priority by LTV desc
  const patients = [...input.patients].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return b.monetary_kzt - a.monetary_kzt
  })

  const header = [
    'Приоритет',
    'Сегмент',
    'Имя / ФИО',
    'Телефон',
    'Кол-во визитов',
    'Сумма, ₸',
    'Дней с последнего визита',
    'Что предлагать (основной оффер)',
    'Статус обзвона',
    'Результат',
    'Дата следующего контакта',
    'Комментарий',
  ]
  const rows: unknown[][] = [header]

  for (const p of patients) {
    const seg = p.segment
    const script = SEGMENT_SCRIPTS[seg]
    rows.push([
      p.priority,
      SEGMENT_LABELS[seg],
      p.display_name ?? '(нет ФИО в базе)',
      p.phone ?? '(скрыт)',
      p.frequency,
      p.monetary_kzt,
      p.recency_days < 99999 ? p.recency_days : '-',
      script.offer,
      '',   // Статус обзвона — выбирается оператором
      '',   // Результат
      '',   // Дата след. контакта
      '',   // Комментарий
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 10 }, { wch: 18 }, { wch: 26 }, { wch: 18 },
    { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 50 }, { wch: 16 }, { wch: 30 }, { wch: 18 }, { wch: 30 },
  ]
  // Freeze header
  ws['!freeze'] = { xSplit: 4, ySplit: 1 }
  return ws
}

// ── Sheet 3: Скрипты звонков ───────────────────────────────────────────────

function sheetScripts(): XLSX.WorkSheet {
  const rows: unknown[][] = []
  rows.push(['Скрипты звонков по сегментам — единая структура'])
  rows.push(['Приветствие → Контекст → Повод звонка → Уточняющий вопрос → Оффер → Работа с возражениями'])
  rows.push([])
  rows.push(['Сегмент', 'Повод звонка', 'Открытие (скрипт)', 'Уточняющий вопрос', 'Что предложить', 'Работа с возражениями'])
  for (const [id, s] of Object.entries(SEGMENT_SCRIPTS)) {
    rows.push([SEGMENT_LABELS[id as PatientSegmentId], s.purpose, s.opening, s.qualifier, s.offer, s.objections])
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 22 }, { wch: 40 }, { wch: 80 }, { wch: 50 }, { wch: 60 }, { wch: 60 }]
  return ws
}

// ── Sheet 4: Инструкция оператору ──────────────────────────────────────────

function sheetInstructions(input: CallListInput): XLSX.WorkSheet {
  const rows: unknown[][] = [
    [`Инструкция оператору колл-центра · ${input.clinic_name}`],
    [],
    ['1. Порядок работы', 'Открывайте лист «Список обзвона». Отсортирован по приоритету: сначала VIP (S1-S2), затем риск оттока (S4), лояльные (S3), свежие разовые (S7), спящие (S6), старые разовые (S8), мёртвые лиды (S5).'],
    [],
    ['2. Нормативы', 'Цель: 30–40 результативных диалогов в день. Недозвон: 2 попытки (утром + вечером) перед статусом «Не отвечает». Средняя длительность звонка: 4–6 минут.'],
    [],
    ['3. Подбор чек-апа', 'В ходе разговора уточните жалобы пациента. По 4 направлениям (гипертония / ИБС / аритмия / ХСН+СД) подберите подходящий чек-ап. Если профиль неясен — предложите базовый кардиоскрининг.'],
    [],
    ['4. Согласие на WhatsApp', 'Обязательно получайте устное согласие: «[Имя], мы можем отправить Вам напоминания о приёме в WhatsApp? Это бесплатно, только по вопросам Вашего лечения». Пометьте в CRM.'],
    [],
    ['5. Возражения', 'Не продавайте — предлагайте. Не давите. Если отказ — поблагодарите и запишите причину. Причина отказа — ценная рыночная информация.'],
    [],
    ['6. Статусы обзвона', 'Недозвон · Не отвечает · Занято · Отказ · Записан · Перезвонить · Неверный номер · Не в сети'],
    [],
    ['7. Этика', 'Не обсуждайте диагноз по телефону — только с лечащим врачом. Не давайте рекомендаций, только приглашайте. Соблюдайте конфиденциальность: называйте имя пациента только после верификации ФИО.'],
    [],
    ['8. Цены и условия', 'Акции утверждены заранее и указаны в скрипте. Самостоятельно скидки не давать. По сложным вопросам переводите на администратора клиники.'],
    [],
    ['9. Срочные случаи', 'Если пациент жалуется на боли в груди / одышку / аритмию в момент звонка — рекомендуйте немедленно вызвать скорую и сообщите администратору клиники.'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 30 }, { wch: 100 }]
  return ws
}

// ── Main export ─────────────────────────────────────────────────────────────

export function generateCallListXlsx(input: CallListInput): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheetOverview(input), '1_Обзор_стратегии')
  XLSX.utils.book_append_sheet(wb, sheetCallList(input), '2_Список_обзвона')
  XLSX.utils.book_append_sheet(wb, sheetScripts(), '3_Скрипты_звонков')
  XLSX.utils.book_append_sheet(wb, sheetInstructions(input), '4_Инструкция_оператору')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
