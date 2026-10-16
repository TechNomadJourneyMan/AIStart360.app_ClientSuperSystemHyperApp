/**
 * lib/moderation/chat.ts — фильтр мата для AI-чатов (без серверных
 * зависимостей). Вопрос с матом не отклоняем: модели и в историю уходит
 * замаскированный текст, а к ответу сверху добавляется вежливая приписка.
 * Ответ модели тоже маскируется перед показом и сохранением.
 */
import { hasProfanity, maskProfanity } from './profanity'

/** Короткая вежливая приписка к ответу, когда в вопросе был мат. */
export const PROFANITY_CHAT_NOTE = 'Пожалуйста, давайте общаться без грубых слов — так мы быстрее поможем.'

/** Вопрос пользователя → текст для модели/истории и флаг «был мат». */
export function maskUserQuestion(text: string): { text: string; masked: boolean } {
  if (!hasProfanity(text)) return { text, masked: false }
  return { text: maskProfanity(text), masked: true }
}

/** Ответ AI для показа: мат замаскирован, при необходимости — приписка сверху. */
export function safeAnswer(answer: string, questionMasked: boolean): string {
  const clean = maskProfanity(answer)
  return questionMasked ? `${PROFANITY_CHAT_NOTE}\n\n${clean}` : clean
}
