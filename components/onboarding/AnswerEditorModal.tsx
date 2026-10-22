'use client'

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import MarkdownPreview from '@/components/onboarding/MarkdownPreview'
import QuestionAttachments from '@/components/onboarding/QuestionAttachments'
import {
  ANSWER_MAX_CHARS, answerEditorReducer, counterText, editorKeyIntent, initialEditorState, isDirty, saveButton,
} from '@/lib/survey/answer-editor'
import { applyToolbarAction, continueListOnEnter, normalizeUrl, type EditState, type ToolbarAction } from '@/lib/survey/markdown-toolbar'

/**
 * The answer editor (PO item 4.1): a click on a text field of the
 * questionnaire opens it. Title = the question, hint = the field's prompt;
 * a textarea with a Markdown toolbar (bold, italic, lists, link) and a
 * «Просмотр» toggle; the character counter; files attached to the question.
 *
 * Saving goes through the wizard's own save path (`onSave` → POST
 * /api/v1/onboarding/survey): validation, the profanity filter, goals sync and
 * the author line all apply. Esc / «Отмена» with unsaved text asks first;
 * Ctrl/⌘+Enter saves. Radix Dialog gives the focus trap; below 640 px the
 * dialog is a full-screen sheet; the text is 16 px so iOS does not zoom.
 */
export interface AnswerEditorTarget {
  key: string
  title: string
  hint?: string | null
  value: unknown
}

export default function AnswerEditorModal({ target, onSave, onClose, companyId, attachments = true }: {
  target: AnswerEditorTarget | null
  /** Resolves when the server confirmed; `error` is shown in the dialog. */
  onSave: (key: string, value: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onClose: () => void
  companyId: string | null
  attachments?: boolean
}) {
  if (!target) return null
  return <EditorDialog key={target.key} target={target} onSave={onSave} onClose={onClose} companyId={companyId} attachments={attachments} />
}

const TOOLBAR: Array<{ action: ToolbarAction; icon: string; label: string; hint: string }> = [
  { action: 'bold', icon: 'format_bold', label: 'Жирный', hint: 'Ctrl+B' },
  { action: 'italic', icon: 'format_italic', label: 'Курсив', hint: 'Ctrl+I' },
  { action: 'ul', icon: 'format_list_bulleted', label: 'Маркированный список', hint: '' },
  { action: 'ol', icon: 'format_list_numbered', label: 'Нумерованный список', hint: '' },
  { action: 'link', icon: 'link', label: 'Ссылка', hint: 'Ctrl+K' },
]

function EditorDialog({ target, onSave, onClose, companyId, attachments }: {
  target: AnswerEditorTarget
  onSave: (key: string, value: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onClose: () => void
  companyId: string | null
  attachments: boolean
}) {
  const [state, dispatch] = useReducer(answerEditorReducer, target.value, initialEditorState)
  const [preview, setPreview] = useState(false)
  const [linkDraft, setLinkDraft] = useState<{ url: string; error: string | null } | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)
  const savingRef = useRef(false)

  useEffect(() => { if (state.closed) onClose() }, [state.closed, onClose])

  // Autosize the textarea (bounded; it scrolls beyond the max height).
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el || preview) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 180), Math.round(window.innerHeight * 0.55))}px`
    const sel = pendingSelection.current
    if (sel) {
      el.focus()
      el.setSelectionRange(sel.start, sel.end)
      pendingSelection.current = null
    }
  }, [state.value, preview])

  const editState = (): EditState => {
    const el = areaRef.current
    return { value: state.value, start: el?.selectionStart ?? state.value.length, end: el?.selectionEnd ?? state.value.length }
  }

  const apply = (next: EditState | null) => {
    if (!next) return
    pendingSelection.current = { start: next.start, end: next.end }
    dispatch({ type: 'edit', value: next.value })
  }

  const runAction = (action: ToolbarAction) => {
    if (preview) setPreview(false)
    if (action === 'link') {
      setLinkDraft({ url: '', error: null })
      return
    }
    apply(applyToolbarAction(editState(), action))
  }

  const confirmLink = () => {
    if (!linkDraft) return
    const url = normalizeUrl(linkDraft.url)
    if (!url) { setLinkDraft({ ...linkDraft, error: 'Введите адрес вида https://example.kz' }); return }
    apply(applyToolbarAction(editState(), 'link', url))
    setLinkDraft(null)
  }

  const save = async () => {
    if (savingRef.current || !isDirty(state)) return
    savingRef.current = true
    dispatch({ type: 'save_start' })
    try {
      const res = await onSave(target.key, state.value)
      dispatch(res.ok ? { type: 'save_ok' } : { type: 'save_fail', error: res.error })
    } catch {
      dispatch({ type: 'save_fail', error: 'Нет связи с сервером. Текст не потерян — попробуйте сохранить ещё раз.' })
    } finally {
      savingRef.current = false
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const intent = editorKeyIntent(e)
    if (intent) {
      e.preventDefault()
      if (intent === 'save') void save()
      else runAction(intent)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      const next = continueListOnEnter(editState())
      if (next) { e.preventDefault(); apply(next) }
    }
  }

  const btn = saveButton(state)
  const hint = target.hint?.trim()

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) dispatch({ type: 'request_close' }) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={hint ? 'answer-editor-hint' : undefined}
          onEscapeKeyDown={(e) => {
            // Esc closes the link field / the confirmation first; unsaved text asks.
            if (linkDraft) { e.preventDefault(); setLinkDraft(null); return }
            if (state.confirmDiscard) { e.preventDefault(); dispatch({ type: 'keep_editing' }); return }
            e.preventDefault()
            dispatch({ type: 'request_close' })
          }}
          onPointerDownOutside={(e) => { e.preventDefault(); dispatch({ type: 'request_close' }) }}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const el = areaRef.current
            if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
          }}
          className="fixed inset-0 z-[201] flex flex-col bg-surface-container-lowest outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[min(720px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:border-white/10 sm:shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start gap-3 border-b border-white/[0.06] px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-5 sm:pt-5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/70">Ответ на вопрос</p>
              <Dialog.Title className="mt-0.5 text-base font-semibold leading-snug text-on-surface sm:text-lg">{target.title}</Dialog.Title>
              {hint && (
                <Dialog.Description id="answer-editor-hint" className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  {hint}
                </Dialog.Description>
              )}
            </div>
            <button
              type="button"
              onClick={() => dispatch({ type: 'request_close' })}
              aria-label="Закрыть редактор"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
            >
              <span className="material-symbols-outlined" aria-hidden>close</span>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Форматирование текста">
              {TOOLBAR.map((t) => (
                <button
                  key={t.action}
                  type="button"
                  onMouseDown={(e) => e.preventDefault() /* keep the selection in the textarea */}
                  onClick={() => runAction(t.action)}
                  disabled={state.saving}
                  title={t.hint ? `${t.label} (${t.hint})` : t.label}
                  aria-label={t.label}
                  className="flex size-10 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-white/[0.06] hover:text-on-surface disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden>{t.icon}</span>
                </button>
              ))}
              <span className="mx-1 h-6 w-px bg-white/[0.08]" aria-hidden />
              <button
                type="button"
                onClick={() => setPreview((p) => !p)}
                aria-pressed={preview}
                className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${preview ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-white/[0.06] hover:text-on-surface'}`}
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden>{preview ? 'edit' : 'visibility'}</span>
                {preview ? 'Редактировать' : 'Просмотр'}
              </button>
            </div>

            {linkDraft && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.05] p-2">
                <label htmlFor="answer-editor-link" className="sr-only">Адрес ссылки</label>
                <input
                  id="answer-editor-link"
                  autoFocus
                  inputMode="url"
                  value={linkDraft.url}
                  onChange={(e) => setLinkDraft({ url: e.target.value, error: null })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmLink() } }}
                  placeholder="https://…"
                  className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-surface-container px-3 py-2 text-base text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary/50 focus:outline-none sm:text-sm"
                />
                <button type="button" onClick={confirmLink} className="h-10 rounded-lg bg-primary/15 px-3 text-xs font-semibold text-primary hover:bg-primary/25">Вставить</button>
                <button type="button" onClick={() => setLinkDraft(null)} className="h-10 rounded-lg px-3 text-xs text-on-surface-variant hover:text-on-surface">Отмена</button>
                {linkDraft.error && <p className="w-full text-[11px] text-error" role="alert">{linkDraft.error}</p>}
              </div>
            )}

            {preview ? (
              <div className="min-h-[180px] rounded-xl border border-white/[0.08] bg-surface-container px-4 py-3">
                <MarkdownPreview text={state.value} emptyText="Пока пусто — вернитесь в редактор и напишите ответ." />
              </div>
            ) : (
              <>
                <label htmlFor="answer-editor-text" className="sr-only">{target.title}</label>
                <textarea
                  id="answer-editor-text"
                  ref={areaRef}
                  value={state.value}
                  maxLength={ANSWER_MAX_CHARS}
                  onChange={(e) => dispatch({ type: 'edit', value: e.target.value })}
                  onKeyDown={onKeyDown}
                  readOnly={state.saving}
                  placeholder="Напишите ответ. Списки: «- пункт» или «1. пункт»."
                  className="block w-full resize-none rounded-xl border border-white/[0.08] bg-surface-container px-4 py-3 text-base leading-relaxed text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 sm:text-[15px]"
                />
              </>
            )}
            <p className="text-right font-mono text-[10px] text-on-surface-variant/70" aria-live="polite">{counterText(state.value.length)}</p>

            {attachments && <QuestionAttachments questionKey={target.key} companyId={companyId} disabled={state.saving} />}
          </div>

          {/* Footer */}
          <div className="border-t border-white/[0.06] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4">
            {state.confirmDiscard ? (
              <div className="flex flex-wrap items-center gap-2" role="alertdialog" aria-label="Несохранённые изменения">
                <p className="w-full text-xs text-on-surface sm:w-auto sm:flex-1">Есть несохранённые изменения. Закрыть без сохранения?</p>
                <button type="button" onClick={() => dispatch({ type: 'keep_editing' })} className="h-11 flex-1 rounded-xl border border-white/[0.1] px-4 text-sm text-on-surface hover:bg-white/[0.04] sm:flex-none">
                  Продолжить редактирование
                </button>
                <button type="button" onClick={() => dispatch({ type: 'discard' })} className="h-11 flex-1 rounded-xl bg-error/15 px-4 text-sm font-semibold text-error hover:bg-error/25 sm:flex-none">
                  Закрыть без сохранения
                </button>
              </div>
            ) : (
              <>
                {state.error && <p className="mb-2 text-xs text-error" role="alert">{state.error}</p>}
                <div className="flex items-center gap-2">
                  <p className="hidden flex-1 text-[11px] text-on-surface-variant/60 sm:block">Ctrl/⌘ + Enter — сохранить, Esc — закрыть</p>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'request_close' })}
                    disabled={state.saving}
                    className="h-11 flex-1 rounded-xl border border-white/[0.1] px-5 text-sm text-on-surface-variant hover:bg-white/[0.04] disabled:opacity-50 sm:flex-none"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={btn.disabled}
                    aria-busy={state.saving}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] px-5 text-sm font-bold text-[#003824] transition-all disabled:opacity-50 sm:flex-none"
                  >
                    {state.saving && <span className="material-symbols-outlined animate-spin text-base" aria-hidden>progress_activity</span>}
                    {btn.label}
                  </button>
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
