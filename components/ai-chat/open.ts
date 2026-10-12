/**
 * Open the unified AI chat from anywhere (a «Спросить AI» button, Гри, a
 * block's details): the host (components/ai-chat/ChatHost.tsx) listens.
 */
export interface OpenChatDetail {
  surface?: 'point_a' | 'gri' | 'point_b' | 'dashboard' | 'global'
  focus?: { block?: string | null; metric?: string | null; label?: string | null }
  /** Ask right away. */
  question?: string
}

export const OPEN_CHAT_EVENT = 'aistart360:open-ai-chat'

export function openAiChat(detail: OpenChatDetail = {}): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }))
}
