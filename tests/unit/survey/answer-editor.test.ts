import { describe, it, expect } from 'vitest'
import {
  ANSWER_MAX_CHARS, answerEditorReducer, counterText, editorKeyIntent, initialEditorState, isDirty, opensAnswerEditor, saveButton,
  type AnswerEditorAction, type AnswerEditorState,
} from '@/lib/survey/answer-editor'
import { isWritableSurveyKey } from '@/lib/survey/steps'

const run = (s: AnswerEditorState, ...actions: AnswerEditorAction[]) => actions.reduce(answerEditorReducer, s)

describe('answer editor controller', () => {
  it('opens with the field value; non-strings become text', () => {
    expect(initialEditorState('abc')).toMatchObject({ initial: 'abc', value: 'abc', saving: false, closed: false })
    expect(initialEditorState(undefined).value).toBe('')
    expect(initialEditorState(42).value).toBe('42')
  })

  it('dirty check ignores line-ending differences', () => {
    expect(isDirty({ initial: 'a\nb', value: 'a\r\nb' })).toBe(false)
    expect(isDirty({ initial: 'a', value: 'a ' })).toBe(true)
  })

  it('cancel without changes closes at once', () => {
    expect(run(initialEditorState('x'), { type: 'request_close' }).closed).toBe(true)
  })

  it('cancel / Esc with changes asks; «Продолжить» keeps the text; «Закрыть без сохранения» drops it', () => {
    const asked = run(initialEditorState('x'), { type: 'edit', value: 'xy' }, { type: 'request_close' })
    expect(asked).toMatchObject({ confirmDiscard: true, closed: false, value: 'xy' })
    expect(run(asked, { type: 'keep_editing' })).toMatchObject({ confirmDiscard: false, closed: false, value: 'xy' })
    expect(run(asked, { type: 'discard' })).toMatchObject({ closed: true, value: 'x' })
    // Typing again hides the question.
    expect(run(asked, { type: 'edit', value: 'xyz' }).confirmDiscard).toBe(false)
  })

  it('save: «Сохраняем…» and disabled while saving; ok closes; a failure keeps the text and shows the error', () => {
    const edited = run(initialEditorState('x'), { type: 'edit', value: 'новый ответ' })
    expect(saveButton(edited)).toEqual({ label: 'Сохранить', disabled: false })
    const saving = run(edited, { type: 'save_start' })
    expect(saveButton(saving)).toEqual({ label: 'Сохраняем…', disabled: true })
    // No edits / closing while the request is in flight.
    expect(run(saving, { type: 'edit', value: 'другое' }).value).toBe('новый ответ')
    expect(run(saving, { type: 'request_close' }).closed).toBe(false)
    expect(run(saving, { type: 'save_ok' })).toMatchObject({ closed: true, saving: false, initial: 'новый ответ' })
    const failed = run(saving, { type: 'save_fail', error: 'Ответ содержит недопустимые слова.' })
    expect(failed).toMatchObject({ saving: false, closed: false, value: 'новый ответ', error: 'Ответ содержит недопустимые слова.' })
    expect(run(saving, { type: 'save_fail', error: '' }).error).toMatch(/Не удалось сохранить/)
  })

  it('unchanged text cannot be saved; the text is capped', () => {
    expect(saveButton(initialEditorState('x')).disabled).toBe(true)
    const long = run(initialEditorState(''), { type: 'edit', value: 'я'.repeat(ANSWER_MAX_CHARS + 50) })
    expect(long.value).toHaveLength(ANSWER_MAX_CHARS)
  })

  it('counter', () => {
    expect(counterText(1234)).toBe('1 234 / 20 000 символов')
    expect(counterText(0)).toBe('0 / 20 000 символов')
  })

  it('keyboard: Ctrl/⌘+Enter saves, Ctrl+B / I / K format (also on the Russian layout)', () => {
    expect(editorKeyIntent({ key: 'Enter', ctrlKey: true })).toBe('save')
    expect(editorKeyIntent({ key: 'Enter', metaKey: true })).toBe('save')
    expect(editorKeyIntent({ key: 'Enter' })).toBeNull()
    expect(editorKeyIntent({ key: 'b', ctrlKey: true })).toBe('bold')
    expect(editorKeyIntent({ key: 'и', metaKey: true })).toBe('bold')
    expect(editorKeyIntent({ key: 'I', ctrlKey: true })).toBe('italic')
    expect(editorKeyIntent({ key: 'k', ctrlKey: true })).toBe('link')
    expect(editorKeyIntent({ key: 'b', ctrlKey: true, altKey: true })).toBeNull()
  })

  it('which fields open the editor: textareas and marked text inputs of survey keys only', () => {
    const open = (el: Parameters<typeof opensAnswerEditor>[0]) => opensAnswerEditor(el, isWritableSurveyKey)
    expect(open({ tagName: 'TEXTAREA', id: 's2n_goal_12m_what' })).toBe(true)
    expect(open({ tagName: 'TEXTAREA', id: 's2n_goal_12m_what', readOnly: true })).toBe(false)
    expect(open({ tagName: 'TEXTAREA', id: 'answer-editor-text' })).toBe(false)
    expect(open({ tagName: 'TEXTAREA', id: '' })).toBe(false)
    expect(open({ tagName: 'INPUT', id: 's4m_strategic_planning', type: 'text', richEditor: true })).toBe(true)
    expect(open({ tagName: 'INPUT', id: 's1_company_name', type: 'text' })).toBe(false)
    expect(open({ tagName: 'INPUT', id: 's4_dept_count', type: 'number', richEditor: true })).toBe(false)
    expect(open({ tagName: 'SELECT', id: 's4m_control_method' })).toBe(false)
  })
})
