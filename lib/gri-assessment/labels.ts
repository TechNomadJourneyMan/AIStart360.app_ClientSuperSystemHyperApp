import type { SectionId } from './sections'

/** Russian names of the 7 GRI blocks (sections.ts keeps the English shortTitle). */
export const GRI_BLOCK_RU: Record<SectionId, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}
