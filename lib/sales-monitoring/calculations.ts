import { DomainError } from './errors'

const MONEY_SCALE = BigInt(100)
const QUANTITY_SCALE = BigInt(1000)

function parseFixed(value: string, decimals: number): bigint {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new DomainError('INVALID_DECIMAL', `Некорректное число: ${value}`)
  }
  const negative = value.startsWith('-')
  const normalized = negative ? value.slice(1) : value
  const [whole, fraction = ''] = normalized.split('.')
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  const result = BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(padded || '0')
  return negative ? -result : result
}

function formatFixed(value: bigint, decimals: number): string {
  const negative = value < BigInt(0)
  const abs = negative ? -value : value
  const scale = BigInt(10) ** BigInt(decimals)
  const whole = abs / scale
  const fraction = (abs % scale).toString().padStart(decimals, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export function moneyToMinor(value: string): bigint {
  return parseFixed(value, 2)
}

export function minorToMoney(value: bigint): string {
  return formatFixed(value, 2)
}

export function quantityToMilli(value: string): bigint {
  return parseFixed(value, 3)
}

export function milliToQuantity(value: bigint): string {
  return formatFixed(value, 3)
}

function multiplyMoneyByQuantity(moneyMinor: bigint, quantityMilli: bigint): bigint {
  const product = moneyMinor * quantityMilli
  const half = QUANTITY_SCALE / BigInt(2)
  return product >= BigInt(0)
    ? (product + half) / QUANTITY_SCALE
    : (product - half) / QUANTITY_SCALE
}

export interface CalculatedSaleLine {
  revenueMinor: bigint
  costMinor: bigint
  grossProfitMinor: bigint
  discountMinor: bigint
  bonusMinor: bigint
}

export function calculateSaleLine(input: {
  quantity: string
  unitPrice: string
  unitCost: string
  discountAmount?: string
  bonusRate?: string
}): CalculatedSaleLine {
  const quantity = quantityToMilli(input.quantity)
  const unitPrice = moneyToMinor(input.unitPrice)
  const unitCost = moneyToMinor(input.unitCost)
  const discount = moneyToMinor(input.discountAmount ?? '0.00')
  const grossRevenue = multiplyMoneyByQuantity(unitPrice, quantity)
  const revenue = grossRevenue - discount
  const cost = multiplyMoneyByQuantity(unitCost, quantity)
  const grossProfit = revenue - cost

  if (revenue < BigInt(0)) {
    throw new DomainError('DISCOUNT_EXCEEDS_REVENUE', 'Скидка не может превышать выручку строки', 422)
  }

  const bonusRateMillionths = parseFixed(input.bonusRate ?? '0', 6)
  const bonusBase = grossProfit > BigInt(0) ? grossProfit : BigInt(0)
  const bonus = (bonusBase * bonusRateMillionths + BigInt(500000)) / BigInt(1000000)

  return {
    revenueMinor: revenue,
    costMinor: cost,
    grossProfitMinor: grossProfit,
    discountMinor: discount,
    bonusMinor: bonus,
  }
}

export function sumMinor(values: bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, BigInt(0))
}

export function allocateAmount(
  total: string,
  coefficients: Array<{ key: string; coefficient: string }>,
): Array<{ key: string; amount: string }> {
  if (coefficients.length === 0) return []
  const totalMinor = moneyToMinor(total)
  const weights = coefficients.map((item) => ({
    ...item,
    weight: parseFixed(item.coefficient, 8),
  }))
  const weightTotal = weights.reduce((sum, item) => sum + item.weight, BigInt(0))
  if (weightTotal <= BigInt(0)) throw new DomainError('INVALID_ALLOCATION', 'Сумма коэффициентов должна быть больше нуля')

  const raw = weights.map((item) => {
    const numerator = totalMinor * item.weight
    return {
      key: item.key,
      floor: numerator / weightTotal,
      remainder: numerator % weightTotal,
    }
  })
  let remaining = totalMinor - raw.reduce((sum, item) => sum + item.floor, BigInt(0))
  raw.sort((a, b) => (a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1))
  for (const item of raw) {
    if (remaining <= BigInt(0)) break
    item.floor += BigInt(1)
    remaining -= BigInt(1)
  }
  return raw.map((item) => ({ key: item.key, amount: minorToMoney(item.floor) }))
}

export function calculateLinearPlan(
  monthlyPlan: string,
  elapsedWorkingDays: number,
  totalWorkingDays: number,
): string {
  if (totalWorkingDays <= 0 || elapsedWorkingDays < 0) {
    throw new DomainError('INVALID_WORKING_DAYS', 'Некорректный календарь рабочих дней')
  }
  const clamped = Math.min(elapsedWorkingDays, totalWorkingDays)
  const planMinor = moneyToMinor(monthlyPlan)
  return minorToMoney((planMinor * BigInt(clamped) + BigInt(Math.floor(totalWorkingDays / 2))) / BigInt(totalWorkingDays))
}

export const FIXED_SCALES = { money: MONEY_SCALE, quantity: QUANTITY_SCALE } as const
