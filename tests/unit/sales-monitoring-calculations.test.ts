import { describe, expect, it } from 'vitest'
import {
  allocateAmount,
  calculateLinearPlan,
  calculateSaleLine,
  minorToMoney,
  moneyToMinor,
} from '@/lib/sales-monitoring/calculations'

describe('sales monitoring financial calculations', () => {
  it('keeps monetary calculations in fixed point', () => {
    const line = calculateSaleLine({
      quantity: '2.500',
      unitPrice: '10000.00',
      unitCost: '6000.00',
      discountAmount: '1000.00',
      bonusRate: '0.10',
    })

    expect(minorToMoney(line.revenueMinor)).toBe('24000.00')
    expect(minorToMoney(line.costMinor)).toBe('15000.00')
    expect(minorToMoney(line.grossProfitMinor)).toBe('9000.00')
    expect(minorToMoney(line.bonusMinor)).toBe('900.00')
  })

  it('does not accrue a bonus on negative gross profit', () => {
    const line = calculateSaleLine({
      quantity: '1',
      unitPrice: '5000.00',
      unitCost: '7000.00',
      bonusRate: '0.20',
    })

    expect(minorToMoney(line.grossProfitMinor)).toBe('-2000.00')
    expect(minorToMoney(line.bonusMinor)).toBe('0.00')
  })

  it('allocates every minor unit without losing the total', () => {
    const allocation = allocateAmount('1000000.00', [
      { key: 'almaty', coefficient: '50' },
      { key: 'astana', coefficient: '30' },
      { key: 'oskemen', coefficient: '20' },
    ])

    expect(allocation).toEqual([
      { key: 'almaty', amount: '500000.00' },
      { key: 'astana', amount: '300000.00' },
      { key: 'oskemen', amount: '200000.00' },
    ])
    expect(
      allocation.reduce((sum, item) => sum + moneyToMinor(item.amount), BigInt(0)),
    ).toBe(moneyToMinor('1000000.00'))
  })

  it('uses elapsed working days for the linear period plan', () => {
    expect(calculateLinearPlan('2200000.00', 5, 22)).toBe('500000.00')
  })
})
