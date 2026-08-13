export const STORE_POINT_B_CONFIRMATION_MESSAGE = 'Подтверждаю Точку B'

/** Intentionally does not accept a casual "да" or a bare "подтверждаю". */
export function isExplicitStorePointBConfirmation(message: string): boolean {
  return /^\s*подтверждаю\s+точку\s+(?:b|б)(?:\s*[:—-].*)?[.!]?\s*$/iu.test(message)
}
