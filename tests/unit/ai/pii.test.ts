import { describe, expect, it } from 'vitest'
import { isPersonalDataKey, maskContacts, maskPersonalText, withoutPersonalData } from '@/lib/ai/pii'

describe('personal data never goes to a model', () => {
  it('recognises contact and identity survey keys', () => {
    for (const k of ['s1_contact_name', 's1_contact_phone', 's1_contact_email', 's1_company_name', 's1_brand', 's1_website', 's1_social_media', 's1_telegram', 'owner_full_name', 'company_iin']) {
      expect(isPersonalDataKey(k), k).toBe(true)
    }
    for (const k of ['s1_industry', 's1_employee_count', 's1_current_revenue_year', 's6_main_pain', 's8n_metrics_table', 's3n_client_portrait']) {
      expect(isPersonalDataKey(k), k).toBe(false)
    }
  })

  it('masks emails and phone numbers inside free text', () => {
    expect(maskContacts('Пишите на ceo@veter.kz или звоните +7 (701) 123-45-67')).toBe('Пишите на [email] или звоните [телефон]')
    expect(maskContacts('Выручка 540 000 000 за год')).toBe('Выручка 540 000 000 за год')
  })

  it('drops personal rows and masks the rest', () => {
    const rows = withoutPersonalData([
      { question_key: 's1_contact_phone', answer: '+77011234567' },
      { question_key: 's6_main_pain', answer: 'Долго нанимаем, пишите hr@x.kz' },
      { question_key: 's1_employee_count', answer: 42 },
    ])
    expect(rows).toEqual([
      { question_key: 's6_main_pain', answer: 'Долго нанимаем, пишите [email]' },
      { question_key: 's1_employee_count', answer: 42 },
    ])
  })

  it('masks the real stored shape: answer = { value } (strings, arrays, tables)', () => {
    const rows = withoutPersonalData([
      { question_key: 's6_main_pain', answer: { value: 'пишите hr@firm.kz или звоните +7 701 123 45 67' } },
      { question_key: 's10_problems_faced', answer: { value: ['Уволился менеджер, звоните 8 (727) 250-00-00', 'Нет CRM'] } },
      { question_key: 's11_influence_map', answer: { value: [{ role: 'Директор', note: 'ФИО: Иванов Иван Иванович', contact_phone: '+77011234567' }] } },
      { question_key: 's8n_metrics_table', answer: { value: { revenue: 1_500_000_000, comment: 'Выручка 1 500 000 000 тенге, рост 2023-2024 12%' } } },
    ])
    expect(rows).toEqual([
      { question_key: 's6_main_pain', answer: { value: 'пишите [email] или звоните [телефон]' } },
      { question_key: 's10_problems_faced', answer: { value: ['Уволился менеджер, звоните [телефон]', 'Нет CRM'] } },
      { question_key: 's11_influence_map', answer: { value: [{ role: 'Директор', note: 'ФИО: [имя]' }] } },
      { question_key: 's8n_metrics_table', answer: { value: { revenue: 1_500_000_000, comment: 'Выручка 1 500 000 000 тенге, рост 2023-2024 12%' } } },
    ])
    expect(JSON.stringify(rows)).not.toMatch(/hr@firm|701 123|250-00-00|Иванов|77011234567/)
  })

  it('leaves business figures alone: grouped amounts, year ranges, long sums', () => {
    for (const s of [
      'Выручка 1 500 000 000 тенге, рост 2023-2024 12%',
      'Сумма 8 500 000 000 ₸ и 85000000000 ₸; маржа 35,5%',
      'Дебиторка 120000000000, период 01.01.2025-31.12.2025',
    ]) expect(maskContacts(s)).toBe(s)
  })

  it('masks phones of every common shape, IIN/BIN and person names', () => {
    expect(maskContacts('8 (727) 250-00-00, 87011234567, +998 90 123 45 67, +1 212 555-1234'))
      .toBe('[телефон], [телефон], [телефон], [телефон]')
    expect(maskContacts('ИИН 900101300123, БИН: 123456789012')).toBe('ИИН [ИИН], БИН: [ИИН]')
    expect(maskPersonalText('пациентка Смирнова А.В., директор — Ахметов Серик Болатұлы, Клиентов: 120'))
      .toBe('пациентка [имя], директор — [имя], Клиентов: 120')
  })
})
