import { detectDeterministicRisk } from '@/lib/omnichannel/guardrails'

export const MYHONOR_MARKETING_TIMEZONE = 'Asia/Almaty'

interface LocalClock {
  weekday: string
  hour: number
  minute: number
}

function localClock(
  value: Date,
  timeZone = MYHONOR_MARKETING_TIMEZONE,
): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return {
    weekday: part('weekday'),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  }
}

export function isMyHonorMarketingQuietTime(
  value: Date,
  timeZone = MYHONOR_MARKETING_TIMEZONE,
): boolean {
  const local = localClock(value, timeZone)
  const weekend = local.weekday === 'Sat' || local.weekday === 'Sun'
  const start = weekend ? 11 : 10
  const end = weekend ? 18 : 20
  return local.hour < start || local.hour >= end
}

export function nextMyHonorMarketingSendTime(
  value: Date,
  timeZone = MYHONOR_MARKETING_TIMEZONE,
): Date {
  if (!isMyHonorMarketingQuietTime(value, timeZone)) return value
  const candidate = new Date(value)
  candidate.setUTCSeconds(0, 0)
  for (let step = 0; step < 10 * 24 * 4; step += 1) {
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 15)
    if (!isMyHonorMarketingQuietTime(candidate, timeZone)) return candidate
  }
  throw new Error('could not calculate a permitted marketing time')
}

export function isMyHonorMarketingOptOut(text: string): boolean {
  return detectDeterministicRisk(text).optOut
}

export interface MyHonorFrequencyState {
  lastMarketingSentAt: string | null
  marketingSentLast30Days: number
  frequencyCapDays: number
  monthlyCap: number
}

export function myHonorFrequencyExclusion(
  state: MyHonorFrequencyState,
  now = new Date(),
): string | null {
  if (state.marketingSentLast30Days >= state.monthlyCap) {
    return 'monthly_frequency_cap'
  }
  if (!state.lastMarketingSentAt) return null
  const previous = Date.parse(state.lastMarketingSentAt)
  if (!Number.isFinite(previous)) return 'invalid_last_marketing_timestamp'
  const minimumGap = state.frequencyCapDays * 24 * 60 * 60 * 1000
  return now.getTime() - previous < minimumGap ? 'frequency_cap' : null
}
