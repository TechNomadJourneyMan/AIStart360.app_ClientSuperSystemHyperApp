/**
 * lib/gri/pulse-streak.ts — «Стрик пульса» (Фаза 5, идея №11).
 *
 * Чистая функция: длина серии ПОДРЯД идущих недель GRI-пульса, заканчивающейся
 * текущей ИЛИ прошлой неделей. Если пульс текущей недели ещё не снят, стрик
 * не сгорает до конца недели (якорем становится прошлая неделя). Пропущенная
 * неделя рвёт серию.
 *
 * Недели — UTC-понедельники в формате ISO YYYY-MM-DD (та же система координат,
 * что mondayOfWeekUTC в app/api/v1/gri/pulse/route.ts).
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Понедельник (UTC) недели, содержащей момент `ms`, как YYYY-MM-DD.
 * Зеркало mondayOfWeekUTC из app/api/v1/gri/pulse/route.ts.
 */
function mondayOfWeekUTC(ms: number): string {
  const now = new Date(ms)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay() // 0..6, Sun=0
  const diff = dow === 0 ? 6 : dow - 1 // дней с понедельника
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

/** Понедельник предыдущей недели для ISO-даты понедельника. */
function prevWeek(isoMonday: string): string {
  return new Date(new Date(`${isoMonday}T00:00:00Z`).getTime() - WEEK_MS)
    .toISOString()
    .slice(0, 10)
}

/**
 * Длина текущего стрика еженедельных пульсов.
 *
 * @param weekStarts — массив week_start (ISO YYYY-MM-DD, понедельники UTC);
 *                     порядок и дубликаты не важны.
 * @param now        — текущий момент (мс, Date.now()).
 * @returns число подряд идущих недель, заканчивающихся текущей или прошлой
 *          неделей; 0 — если серии нет.
 */
export function computePulseStreak(weekStarts: string[], now: number = Date.now()): number {
  if (weekStarts.length === 0) return 0

  const weeks = new Set(weekStarts)
  const currentWeek = mondayOfWeekUTC(now)

  // Якорь: текущая неделя, если пульс уже снят; иначе прошлая неделя
  // (грейс-период — серия не сгорает, пока текущая неделя не закончилась).
  let cursor = weeks.has(currentWeek) ? currentWeek : prevWeek(currentWeek)

  let streak = 0
  while (weeks.has(cursor)) {
    streak += 1
    cursor = prevWeek(cursor)
  }
  return streak
}
