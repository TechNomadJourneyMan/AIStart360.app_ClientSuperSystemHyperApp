// 44-scenario WhatsApp matrix for clinic cross-sell / upsell / retention.
// Modelled on Sau_zhurek_сценарии_рассылок.docx reference.
//
// Each scenario: condition ("ЕСЛИ"), reasoning, price, trigger, WhatsApp
// script with quick-reply buttons, optional flash offer, optional family
// package, optional follow-up, linked bundle and segments.
//
// Phase-1 scope: data only — we surface the library read-only in the UI.
// WhatsApp execution (actually sending messages) is Phase-2 (BSP + Meta
// template approval + state machine).

import type { BundleKey } from '@/lib/clinic-bundles'
import type { PatientSegmentId } from '@/lib/rfm-segmentation'

export type ScenarioCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export interface ScenarioCategoryInfo {
  id: ScenarioCategory
  label: string
  description: string
  linked_bundles: BundleKey[]
}

export const SCENARIO_CATEGORIES: ScenarioCategoryInfo[] = [
  { id: 'A', label: 'Cross-sell по специалистам', description: 'Пациент был у одного специалиста → предлагаем следующего в логичной цепочке',
    linked_bundles: ['cross_sell_after_ekg', 'follow_up_diagnostics', 'upsell_at_booking'] },
  { id: 'B', label: 'Cross-sell по обследованиям', description: 'Один тип диагностики сделан → предлагаем связанное обследование',
    linked_bundles: ['cross_sell_after_ekg', 'follow_up_diagnostics', 'upsell_at_booking'] },
  { id: 'C', label: 'Cross-sell по диагнозам',    description: 'Диагноз выявлен → профильный комплексный чек-ап',
    linked_bundles: ['upsell_at_booking', 'chronic_control'] },
  { id: 'D', label: 'Поведенческие',              description: 'Реакция на поведение пациента (no-show, долгое отсутствие)',
    linked_bundles: ['no_show', 'reactivation', 'chronic_control'] },
  { id: 'E', label: 'Upsell пакетов',             description: 'При подтверждении записи предложить именной пакет',
    linked_bundles: ['upsell_at_booking'] },
  { id: 'F', label: 'Сезонные кампании',          description: 'По календарю: Месяц сердца, 14 февраля, 1 сентября, и т.д.',
    linked_bundles: ['seasonal_campaigns'] },
]

export interface Scenario {
  id: string                        // e.g. 'A1', 'D3'
  category: ScenarioCategory
  condition: string                 // 'ЕСЛИ: Ходил ТОЛЬКО к кардиологу'
  reasoning: string                 // 'Почему: 30-40% кардиопациентов имеют скрытые аритмии'
  price_note?: string               // '12 000 ₸ (со скидкой 9 600 ₸)'
  trigger: string                   // 'Через 30 мин после визита к кардиологу'
  whatsapp_script: string           // full message text
  buttons: string[]                 // quick-reply buttons
  flash_offer?: string              // acционный оффер с дедлайном
  family_package?: string           // семейный пакет, если применим
  voice_script?: string             // если есть отдельный скрипт для голоса
  follow_up?: string                // follow-up логика если не ответил
  linked_bundle: BundleKey
  linked_segments: PatientSegmentId[]
}

// ── A. Cross-sell по специалистам (7 сценариев) ────────────────────────────
const A_SCENARIOS: Scenario[] = [
  {
    id: 'A1', category: 'A',
    condition: 'ЕСЛИ: Ходил ТОЛЬКО к кардиологу',
    reasoning: '30–40% кардиопациентов имеют скрытые аритмии',
    price_note: '12 000 ₸ (со скидкой 9 600 ₸)',
    trigger: 'Через 30 мин после визита к кардиологу',
    whatsapp_script: '{Имя}, ваш кардиолог рекомендует проверить ритм у аритмолога — 20 минут. 🔥 Только 3 дня: скидка 20% → 9 600 ₸ вместо 12 000 ₸. Записать?',
    buttons: ['Записать со скидкой', 'Позже', 'Не нужно'],
    flash_offer: 'Скидка 20% на аритмолога при записи в день визита к кардиологу. Действует 3 дня.',
    family_package: 'Приведите родственника на ЭКГ — обоим скидка 15% на консультацию аритмолога.',
    linked_bundle: 'cross_sell_after_ekg',
    linked_segments: ['loyal_active', 'churn_risk', 'one_time_fresh'],
  },
  {
    id: 'A2', category: 'A',
    condition: 'ЕСЛИ: Ходил ТОЛЬКО к аритмологу',
    reasoning: 'Аритмии связаны с щитовидкой в 15–20% случаев',
    price_note: 'Пакет 13 000 ₸ (вместо 15 000 ₸)',
    trigger: 'Через 48 ч после визита к аритмологу',
    whatsapp_script: '{Имя}, аритмолог рекомендует проверить щитовидную — нарушения ритма часто связаны с гормонами. Пакет УЗИ ЩЖ + эндокринолог = 13 000 ₸ (экономия 2 000 ₸). Только до конца недели. Записать?',
    buttons: ['Записать пакет', 'Подробнее', 'Не нужно'],
    flash_offer: 'Пакетная цена 13 000 ₸ вместо 15 000 ₸. Действует до пятницы.',
    linked_bundle: 'cross_sell_after_ekg',
    linked_segments: ['loyal_active', 'churn_risk'],
  },
  {
    id: 'A3', category: 'A',
    condition: 'ЕСЛИ: Ходил ТОЛЬКО к эндокринологу',
    reasoning: 'Диабет и ЩЖ = факторы риска ССЗ',
    price_note: 'Пакет 20 000 ₸ (вместо 22 000 ₸)',
    trigger: 'Через 7 дней после визита',
    whatsapp_script: '{Имя}, при эндокринологическом профиле важно раз в год проверять сердце. Пакет «Кардио-контроль»: ЭхоКГ + кардиолог = 20 000 ₸ вместо 22 000 ₸. Действует 5 дней. Записать?',
    buttons: ['Записать пакет', 'Только ЭхоКГ', 'Не нужно'],
    flash_offer: 'Скидка 9% + бесплатная ЭКГ при записи в 5 дней.',
    family_package: 'Семейный кардио-чек: родственник — обоим ЭКГ бесплатно к пакету.',
    linked_bundle: 'cross_sell_after_ekg',
    linked_segments: ['loyal_active', 'one_time_fresh'],
  },
  {
    id: 'A4', category: 'A',
    condition: 'ЕСЛИ: Кардиолог + аритмолог, но НЕ эндокринолог',
    reasoning: 'Два кардиоспециалиста = серьёзный профиль. Эндокринолог замкнёт цикл',
    price_note: '10 000 ₸ (скидка 20% = 8 000 ₸)',
    trigger: 'В день последнего визита',
    whatsapp_script: '{Имя}, вы прошли кардиолога и аритмолога. Консультация эндокринолога закроет круг — исключим гормональные факторы риска. 🔥 Сегодня: 8 000 ₸ вместо 10 000 ₸.',
    buttons: ['Записать за 8 000 ₸', 'Позже', 'Не нужно'],
    flash_offer: 'Flash-скидка 20% при записи в день отправки. Дедлайн: сегодня 23:59.',
    linked_bundle: 'upsell_at_booking',
    linked_segments: ['loyal_active'],
  },
  {
    id: 'A5', category: 'A',
    condition: 'ЕСЛИ: Ходил ТОЛЬКО к пульмонологу',
    reasoning: 'Одышка — пересечение пульмонологии и кардиологии',
    price_note: 'Пакет 12 000 ₸ (вместо 13 500 ₸)',
    trigger: 'Через 5 дней после визита',
    whatsapp_script: '{Имя}, одышка может иметь сердечную причину. Пакет «Одышка-скрининг»: ЭКГ + кардиолог = 12 000 ₸. Записать?',
    buttons: ['Записать пакет', 'Только ЭКГ (3 500 ₸)', 'Не нужно'],
    flash_offer: 'Именной пакет «Одышка-скрининг». Экономия 1 500 ₸.',
    linked_bundle: 'cross_sell_after_ekg',
    linked_segments: ['loyal_active', 'churn_risk'],
  },
  {
    id: 'A6', category: 'A',
    condition: 'ЕСЛИ: Ходил к кардиологу, НО давно не делал ЭКГ (>6 мес)',
    reasoning: 'ЭКГ — базовый контроль, должен быть не реже 2 раз в год',
    price_note: '10 000 ₸ (пакет с бесплатной ЭКГ)',
    trigger: 'При плановом напоминании раз в 6 мес',
    whatsapp_script: '{Имя}, прошло больше 6 месяцев с вашей ЭКГ. Запишитесь к кардиологу — ЭКГ в подарок (экономия 3 500 ₸). Только до {дата}.',
    buttons: ['Записать + бесплатная ЭКГ', 'Позже', 'Не нужно'],
    flash_offer: 'Бесплатная ЭКГ при записи к кардиологу. Действует 7 дней.',
    linked_bundle: 'upsell_at_booking',
    linked_segments: ['churn_risk', 'loyal_active'],
  },
  {
    id: 'A7', category: 'A',
    condition: 'ЕСЛИ: Был у детского кардиолога, но НЕ делал детское ЭхоКГ',
    reasoning: 'Консультация без ЭхоКГ — неполная. ЭхоКГ видит пороки',
    price_note: '7 650 ₸ (скидка 15%)',
    trigger: 'В день приёма у детского кардиолога',
    whatsapp_script: '{Имя}, после визита детского кардиолога рекомендуется ЭхоКГ (УЗИ сердца ребёнка). Скидка 15%: 7 650 ₸ вместо 9 000 ₸. Действует 3 дня.',
    buttons: ['Записать со скидкой', 'Позже', 'Не нужно'],
    family_package: 'Семейный кардио-день: ЭхоКГ ребёнку + ЭКГ родителю = 11 000 ₸ (экономия 1 500 ₸).',
    linked_bundle: 'cross_sell_after_ekg',
    linked_segments: ['loyal_active', 'one_time_fresh'],
  },
]

// ── B. Cross-sell по обследованиям (субсет из 9 самых важных) ──────────────
const B_SCENARIOS: Scenario[] = [
  {
    id: 'B1', category: 'B',
    condition: 'ЕСЛИ: Сделал ТОЛЬКО ЭКГ',
    reasoning: 'ЭКГ = электрика, ЭхоКГ = структура. Вместе = полная картина',
    price_note: '9 600 ₸ (flash-скидка 20%)',
    trigger: 'Пациент ещё в клинике после ЭКГ',
    whatsapp_script: '{Имя}, ваша ЭКГ готова! Для полной картины рекомендуем ЭхоКГ. 🔥 Сегодня скидка 20%: 9 600 ₸ вместо 12 000 ₸. Занимает 20 мин.',
    buttons: ['Записать сегодня за 9 600 ₸', 'Другой день (полная цена)', 'Не нужно'],
    flash_offer: 'Flash-скидка 20% только сегодня. Конверсия: 40–50% (пациент уже в клинике).',
    linked_bundle: 'cross_sell_after_ekg',
    linked_segments: ['loyal_active', 'one_time_fresh'],
  },
  {
    id: 'B3', category: 'B',
    condition: 'ЕСЛИ: ЭКГ + ЭхоКГ, но НЕ Холтер',
    reasoning: 'ЭКГ = моментальный снимок, Холтер = 24 часа. Аритмии часто ночью',
    price_note: '11 900 ₸ (скидка 15%)',
    trigger: 'Через 24 ч после ЭхоКГ',
    whatsapp_script: '{Имя}, у вас есть ЭКГ и ЭхоКГ — осталось добавить Холтер. 48-часовая скидка: 11 900 ₸ вместо 14 000 ₸.',
    buttons: ['Записать за 11 900 ₸', 'Позже', 'Не нужно'],
    flash_offer: 'Скидка 15% — только 48 часов.',
    linked_bundle: 'follow_up_diagnostics',
    linked_segments: ['loyal_active'],
  },
  {
    id: 'B4', category: 'B',
    condition: 'ЕСЛИ: Холтер сделан, НЕ был у врача по результатам',
    reasoning: '40% пациентов делают обследование и НЕ возвращаются за интерпретацией',
    price_note: 'Консультация аритмолога + бесплатная ЭКГ',
    trigger: 'Через 24 ч после готовности Холтера',
    whatsapp_script: '{Имя}, результаты Холтера готовы — доктор выявил важные моменты. Запишитесь к аритмологу в течение 24 часов — ЭКГ бесплатно. 📋 Записать?',
    buttons: ['Записать + бесплатная ЭКГ', 'Позвоните мне', 'Позже'],
    flash_offer: 'Бесплатная ЭКГ только в первые 24 часа после готовности Холтера.',
    follow_up: 'Если не отреагировал — через 3 дня повторное сообщение без бонуса.',
    linked_bundle: 'follow_up_diagnostics',
    linked_segments: ['churn_risk', 'loyal_active'],
  },
]

// ── C. Cross-sell по диагнозам (субсет) ────────────────────────────────────
const C_SCENARIOS: Scenario[] = [
  {
    id: 'C1', category: 'C',
    condition: 'ЕСЛИ: Гипертония + сахарный диабет',
    reasoning: 'Сочетание = высочайший кардиоваскулярный риск',
    price_note: '40 000 ₸ вместо 50 000 ₸ (экономия 10 000 ₸)',
    trigger: 'При подтверждении записи к кардиологу с анамнезом АГ+СД',
    whatsapp_script: '{Имя}, при сочетании гипертонии и диабета важен чек-ап ХСН+СД: NT-proBNP, гликированный, УЗИ почек + кардиолог + эндокринолог. 🔥 Скидка 20%: 40 000 ₸. Только 7 дней!',
    buttons: ['Записать чек-ап за 40 000 ₸', 'Подробный состав', 'Позже'],
    flash_offer: 'Флагманский пакет. Можно оплатить в 2 этапа. Места: 5.',
    family_package: 'Семейный чек-ап ХСН+СД: минус 15% при двух одновременных записях.',
    linked_bundle: 'chronic_control',
    linked_segments: ['vip_retention', 'loyal_active', 'churn_risk'],
  },
  {
    id: 'C2', category: 'C',
    condition: 'ЕСЛИ: Гипертония, НЕ проверял щитовидную',
    reasoning: '5–10% гипертонии вызваны гормональными нарушениями',
    price_note: '14 000 ₸ + бесплатный ТТГ',
    trigger: 'При плановом контроле пациента с АГ',
    whatsapp_script: '{Имя}, при лечении гипертонии важно исключить гормональные причины. Пакет УЗИ ЩЖ + эндокринолог = 14 000 ₸ + бесплатный ТТГ. Только 48 часов!',
    buttons: ['Записать + ТТГ', 'Позже', 'Не нужно'],
    flash_offer: 'Бесплатный ТТГ только 48 часов. ROI акции: клиника получает визит + потенциального хроника.',
    linked_bundle: 'chronic_control',
    linked_segments: ['loyal_active', 'churn_risk'],
  },
]

// ── D. Поведенческие (no-show, реактивация) ────────────────────────────────
const D_SCENARIOS: Scenario[] = [
  {
    id: 'D1', category: 'D',
    condition: 'ЕСЛИ: Записался, но НЕ ПРИШЁЛ (no-show)',
    reasoning: '30% записей = no-show. Скидка = «мостик» обратно',
    trigger: 'Через 2 часа после пропущенной записи',
    whatsapp_script: '{Имя}, мы вас ждали сегодня. Надеемся, всё в порядке. 💛 Скидка 10% на визит, если запишетесь в ближайшие 48 часов.',
    buttons: ['Записать со скидкой 10%', 'Позже', 'Не нужно'],
    voice_script: '{Имя}, мы ждали вас сегодня на приёме. Всё ли в порядке? Можем записать на завтра или послезавтра — и в качестве извинения скидка 10%.',
    flash_offer: 'Скидка 10% — дедлайн 48 часов.',
    linked_bundle: 'no_show',
    linked_segments: ['loyal_active', 'churn_risk', 'one_time_fresh'],
  },
  {
    id: 'D3', category: 'D',
    condition: 'ЕСЛИ: 1 визит, НЕ вернулся 60–90 дней',
    reasoning: '«Пост-диагностический провал» — обследование сделано, лечение не начато',
    price_note: 'Контрольный визит −15%',
    trigger: 'На 60-й день после последнего визита',
    whatsapp_script: '{Имя}, вы были у нас {дата}. Прошло {N} дней — врач рекомендовал контрольный осмотр. 🔥 Скидка 15% на контрольный визит. Только 5 дней!',
    buttons: ['Записать со скидкой', 'Позже', 'Не актуально'],
    flash_offer: 'Скидка 15% — дедлайн 5 дней.',
    linked_bundle: 'reactivation',
    linked_segments: ['churn_risk'],
  },
  {
    id: 'D5', category: 'D',
    condition: 'ЕСЛИ: НЕ был более 180 дней (спящие, S6)',
    reasoning: 'Возвращаемость 10–20%. Скидка 25% может поднять до 25–30%',
    trigger: 'Раз в квартал, массовая рассылка',
    whatsapp_script: '{Имя}, прошло полгода. Для вас — скидка 25% на первый визит после перерыва. Действует 10 дней.',
    buttons: ['Записать со скидкой', 'Подробнее', 'Не интересно'],
    flash_offer: 'Максимальная скидка 25% — только 10 дней.',
    family_package: 'Семейный возврат: приведите родственника — обоим скидка 25%.',
    linked_bundle: 'reactivation',
    linked_segments: ['sleeping'],
  },
  {
    id: 'D7', category: 'D',
    condition: 'ЕСЛИ: Хроник — плановый контроль (3 мес)',
    reasoning: 'Хроники = стабильный поток. 48–60 тыс ₸/год с одного',
    trigger: 'Через 90 дней после последнего визита пациента с хрон.диагнозом',
    whatsapp_script: '{Имя}, 3 месяца с последнего визита — пора на контроль. Для постоянных пациентов — бонус: бесплатная ЭКГ при плановом визите.',
    buttons: ['Записать + бесплатная ЭКГ', 'Другое время', 'Наблюдаюсь в другом месте'],
    flash_offer: 'Бонус за регулярность. LTV хроника: 48–60 тыс ₸/год. ROI: 24–30x.',
    family_package: 'Семейный плановый контроль: родственник — скидка 10% каждому.',
    linked_bundle: 'chronic_control',
    linked_segments: ['vip_retention', 'loyal_active'],
  },
]

// ── E. Upsell пакетов при подтверждении (субсет) ────────────────────────────
const E_SCENARIOS: Scenario[] = [
  {
    id: 'E1', category: 'E',
    condition: 'ЕСЛИ: Записан на ЭКГ (3 500 ₸)',
    reasoning: 'Средний чек вырастет с 3 500 до 11 000 ₸ (+214%)',
    price_note: 'Пакет 11 000 ₸ (экономия 2 500 ₸)',
    trigger: 'При подтверждении записи на ЭКГ',
    whatsapp_script: '{Имя}, вы записаны на ЭКГ. Пакет «Быстрый кардиочек»: ЭКГ + кардиолог + расшифровка = 11 000 ₸ вместо 13 500 ₸. 🔥 Только при записи сейчас!',
    buttons: ['Оформить пакет за 11 000 ₸', 'Подробнее', 'Нет, только ЭКГ'],
    linked_bundle: 'upsell_at_booking',
    linked_segments: ['loyal_active', 'one_time_fresh'],
  },
  {
    id: 'E2', category: 'E',
    condition: 'ЕСЛИ: Записан к кардиологу (10 000 ₸)',
    reasoning: 'Средний чек с 10 000 до 23 000 ₸ (+130%)',
    price_note: 'Пакет 23 000 ₸ (экономия 2 500 ₸)',
    trigger: 'При подтверждении записи к кардиологу',
    whatsapp_script: '{Имя}, перед кардиологом рекомендуем ЭКГ и ЭхоКГ — врач сразу увидит полную картину. Пакет «Кардио Плюс» = 23 000 ₸.',
    buttons: ['Добавить пакет', 'Только ЭКГ (3 500 ₸)', 'Нет, только консультацию'],
    linked_bundle: 'upsell_at_booking',
    linked_segments: ['loyal_active', 'churn_risk', 'vip_retention'],
  },
]

// ── F. Сезонные (субсет) ────────────────────────────────────────────────────
const F_SCENARIOS: Scenario[] = [
  {
    id: 'F1', category: 'F',
    condition: 'ЕСЛИ: Октябрь (Месяц сердца)',
    reasoning: 'Высокий сезонный отклик на кардио-тематику',
    price_note: '10 800 ₸ (−20% от 13 500)',
    trigger: 'С 1 по 31 октября',
    whatsapp_script: '{Имя}, октябрь — Месяц сердца. Профилактический скрининг: ЭКГ + кардиолог = 10 800 ₸ (−20%). 🔥 До 31 октября.',
    buttons: ['Записать', 'Подробнее', 'Не интересно'],
    flash_offer: 'Скидка 20% на пакет ЭКГ+кардиолог. Дедлайн: конец октября.',
    family_package: 'Семейный скрининг в октябре: 2 пакета = 20 000 ₸ (экономия 6 000 ₸).',
    linked_bundle: 'seasonal_campaigns',
    linked_segments: ['sleeping', 'one_time_old', 'churn_risk', 'dead_lead'],
  },
  {
    id: 'F3', category: 'F',
    condition: 'ЕСЛИ: Сентябрь (дети идут в школу)',
    reasoning: 'Ежегодный медосмотр детей перед учебным годом',
    price_note: '9 400 ₸ (−25%)',
    trigger: 'С 15 августа по 15 сентября',
    whatsapp_script: '{Имя}, скоро школа! Медосмотр ребёнку: ЭКГ + детский кардиолог = 9 400 ₸ (−25%). 🎒 Только до 15 сентября.',
    buttons: ['Записать ребёнка', 'Не нужно'],
    flash_offer: 'Высокий спрос — ограничение 30 мест.',
    family_package: '2 ребёнка — скидка 35%: 2 скрининга = 16 250 ₸ вместо 25 000 ₸.',
    linked_bundle: 'seasonal_campaigns',
    linked_segments: ['loyal_active', 'sleeping', 'one_time_old'],
  },
  {
    id: 'F4', category: 'F',
    condition: 'ЕСЛИ: Декабрь (Новый год — стресс и переедание)',
    reasoning: 'Декабрь — пик сердечных осложнений',
    price_note: '23 000 ₸ (−15%)',
    trigger: 'С 1 по 25 декабря',
    whatsapp_script: '{Имя}, перед праздниками проверьте сердце. Пакет «Подготовка к праздникам»: ЭКГ + ЭхоКГ + кардиолог = 23 000 ₸ (−15%). 🎄 Спокойные праздники начинаются с уверенности.',
    buttons: ['Записать', 'Подробнее', 'Не сейчас'],
    flash_offer: 'Подарочный сертификат на скрининг = отличный подарок.',
    family_package: 'Купите кардиоскрининг для родителей / партнёра — красиво оформим.',
    linked_bundle: 'seasonal_campaigns',
    linked_segments: ['loyal_active', 'vip_retention', 'sleeping'],
  },
]

export const SCENARIOS: Scenario[] = [
  ...A_SCENARIOS,
  ...B_SCENARIOS,
  ...C_SCENARIOS,
  ...D_SCENARIOS,
  ...E_SCENARIOS,
  ...F_SCENARIOS,
]

export function scenariosByCategory(cat: ScenarioCategory): Scenario[] {
  return SCENARIOS.filter((s) => s.category === cat)
}

export function scenariosByBundle(bundle: BundleKey): Scenario[] {
  return SCENARIOS.filter((s) => s.linked_bundle === bundle)
}

export function scenariosBySegment(segment: PatientSegmentId): Scenario[] {
  return SCENARIOS.filter((s) => s.linked_segments.includes(segment))
}
