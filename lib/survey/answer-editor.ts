/**
 * lib/survey/answer-editor.ts — the state machine of the answer editor modal
 * (PO item 4.1), kept pure so it is unit-tested without a DOM:
 *   open → edit → save (Сохраняем…) → ok: closed / fail: error shown;
 *   close / Esc / «Отмена» with unsaved text → «Закрыть без сохранения?».
 * Also: which fields open the editor, keyboard shortcuts, the counter.
 */

export const ANSWER_MAX_CHARS = 20_000

export interface AnswerEditorState {
  /** The value the editor opened with. */
  initial: string
  value: string
  saving: boolean
  error: string | null
  /** «Закрыть без сохранения?» is shown. */
  confirmDiscard: boolean
  closed: boolean
}

export type AnswerEditorAction =
  | { type: 'edit'; value: string }
  | { type: 'save_start' }
  | { type: 'save_ok' }
  | { type: 'save_fail'; error: string }
  | { type: 'request_close' }
  | { type: 'keep_editing' }
  | { type: 'discard' }

const normalize = (s: string) => s.replace(/\r\n?/g, '\n')

export function initialEditorState(value: unknown): AnswerEditorState {
  const v = typeof value === 'string' ? value : value == null ? '' : String(value)
  return { initial: v, value: v, saving: false, error: null, confirmDiscard: false, closed: false }
}

export function isDirty(s: Pick<AnswerEditorState, 'initial' | 'value'>): boolean {
  return normalize(s.value) !== normalize(s.initial)
}

export function answerEditorReducer(s: AnswerEditorState, a: AnswerEditorAction): AnswerEditorState {
  switch (a.type) {
    case 'edit':
      if (s.saving) return s
      return { ...s, value: a.value.slice(0, ANSWER_MAX_CHARS), error: null, confirmDiscard: false }
    case 'save_start':
      if (s.saving) return s
      return { ...s, saving: true, error: null, confirmDiscard: false }
    case 'save_ok':
      return { ...s, saving: false, initial: s.value, closed: true }
    case 'save_fail':
      return { ...s, saving: false, error: a.error || 'Не удалось сохранить ответ. Попробуйте ещё раз.' }
    case 'request_close':
      if (s.saving) return s
      return isDirty(s) ? { ...s, confirmDiscard: true } : { ...s, closed: true }
    case 'keep_editing':
      return { ...s, confirmDiscard: false }
    case 'discard':
      return { ...s, value: s.initial, confirmDiscard: false, closed: true }
  }
}

/** The save button: «Сохранить» / «Сохраняем…»; disabled while saving or unchanged. */
export function saveButton(s: AnswerEditorState): { label: string; disabled: boolean } {
  return { label: s.saving ? 'Сохраняем…' : 'Сохранить', disabled: s.saving || !isDirty(s) }
}

/** «1 234 / 20 000 символов». */
export function counterText(length: number, max: number = ANSWER_MAX_CHARS): string {
  const f = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ')
  return `${f(length)} / ${f(max)} символов`
}

export type EditorKeyIntent = 'save' | 'bold' | 'italic' | 'link' | null

/** Ctrl/⌘+Enter saves; Ctrl/⌘+B / I / K format. */
export function editorKeyIntent(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): EditorKeyIntent {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'enter') return 'save'
  // Russian layout: и = b, ш = i, л = k on the same keys.
  if (k === 'b' || k === 'и') return 'bold'
  if (k === 'i' || k === 'ш') return 'italic'
  if (k === 'k' || k === 'л') return 'link'
  return null
}

/**
 * Does a click on this field open the editor? Multi-line text (textarea) and
 * text inputs marked `data-rich-editor`, named by a writable survey key.
 * Numbers, selects, radios, checkboxes keep their inline controls.
 */
export function opensAnswerEditor(
  el: { tagName: string; id?: string | null; type?: string | null; readOnly?: boolean; disabled?: boolean; richEditor?: boolean },
  isWritableKey: (key: string) => boolean,
): boolean {
  if (!el.id || el.readOnly || el.disabled || !isWritableKey(el.id)) return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') return !!el.richEditor && (!el.type || el.type === 'text')
  return false
}
