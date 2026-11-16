/**
 * lib/notifications/client-notice-queue.ts — уведомления клиенту, которые не должны
 * держать HTTP-запрос сотрудника (R4, ревью WB-5).
 *
 * Отказ по заявке на оплату и «Доступ открыт» при массовой смене тарифа отправляют
 * письмо (Resend: до 3 попыток по 10 с) и Telegram на КАЖДОГО клиента. Внутри запроса
 * сто заявок упирались бы в дедлайн 60 с (504), а сотня одновременных писем — в лимит
 * частоты Resend. Здесь отправка уходит из запроса в очередь процесса:
 *   • не больше CLIENT_NOTICE_CONCURRENCY отправок одновременно (правило проекта для
 *     фоновой работы — ≤ 2, инцидент 504 от 2026-10-15), остальные ждут по порядку;
 *   • каждая задача — фоновая работа lib/background.ts: вне дедлайна запроса, ошибки
 *     пишутся в лог, при SIGTERM процесс ждёт её завершения (до своего предела);
 *   • повтор не страшен: у самих уведомлений есть ключи идемпотентности.
 * Очередь живёт на globalThis: у маршрутов Next свои копии модулей.
 */
import { runInBackground } from '@/lib/background'

export const CLIENT_NOTICE_CONCURRENCY = 2

interface QueueState {
  running: number
  waiting: Array<() => void>
}

const KEY = Symbol.for('aistart360.client-notice-queue')

function state(): QueueState {
  const g = globalThis as Record<symbol, QueueState | undefined>
  return (g[KEY] ??= { running: 0, waiting: [] })
}

async function acquire(): Promise<void> {
  const q = state()
  if (q.running < CLIENT_NOTICE_CONCURRENCY) {
    q.running += 1
    return
  }
  // The slot is handed over by release(): `running` stays counted for the waiter.
  await new Promise<void>((resolve) => q.waiting.push(resolve))
}

function release(): void {
  const q = state()
  const next = q.waiting.shift()
  if (next) next()
  else q.running = Math.max(0, q.running - 1)
}

/**
 * Поставить отправку в очередь. Возвращает промис её завершения (никогда не
 * отклоняется) — вызывающему ждать его НЕ нужно, это для тестов и логов.
 */
export function enqueueClientNotice(label: string, work: () => Promise<unknown>): Promise<void> {
  return runInBackground(label, async () => {
    await acquire()
    try {
      await work()
    } finally {
      release()
    }
  })
}

/** Сколько отправок сейчас идёт и сколько ждёт (для тестов и диагностики). */
export function clientNoticeQueueSize(): { running: number; waiting: number } {
  const q = state()
  return { running: q.running, waiting: q.waiting.length }
}
