import type { VerticalId } from '@/lib/verticals'

/** Persist an explicit business-type choice for the authenticated account. */
export async function persistSelectedVertical(vertical: VerticalId): Promise<void> {
  const response = await fetch('/api/v1/organizations/set-vertical', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical }),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Не удалось сохранить тип бизнеса (${response.status})`)
  }
}
