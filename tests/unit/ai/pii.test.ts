import { describe, expect, it } from 'vitest'
import { isPersonalDataKey, maskContacts, withoutPersonalData } from '@/lib/ai/pii'

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
})
