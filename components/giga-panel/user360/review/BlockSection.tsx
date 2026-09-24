'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { BookmarkPlus, FileText, Plus } from 'lucide-react'
import { Badge, Button, GigaApiError, Panel, gigaFetch, inputClass } from '../../kit'
import { CommentItem } from './CommentItem'
import { TemplatePicker } from './TemplatePicker'
import type { DraftComment } from './types'

/** Один блок разбора: его черновые комментарии и поле нового комментария. */
export function BlockSection({ userId, block, label, comments, onChanged, onDelete }: {
  userId: string
  block: string
  label: string
  comments: DraftComment[]
  onChanged: () => void
  onDelete: (c: DraftComment) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState(false)
  const [savingTpl, setSavingTpl] = useState(false)

  const add = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/review/comments`, { method: 'POST', json: { block, text: text.trim() } })
      setText('')
      setOpen(false)
      toast.success('Добавлено в черновик')
      onChanged()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const saveTemplate = async () => {
    const body = text.trim()
    if (!body) return
    const title = body.split('\n')[0].slice(0, 80)
    setSavingTpl(true)
    try {
      await gigaFetch('/api/giga-admin/expert-templates', { method: 'POST', json: { block, title, body, is_shared: true } })
      toast.success('Шаблон сохранён в общую библиотеку')
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить шаблон')
    } finally {
      setSavingTpl(false)
    }
  }

  return (
    <Panel
      title={<span className="flex items-center gap-2">{label}{comments.length > 0 && <Badge tone="blue">{comments.length}</Badge>}</span>}
      actions={!open && <Button size="sm" icon={<Plus size={12} />} onClick={() => setOpen(true)}>Комментарий</Button>}
      bodyClassName={comments.length || open ? 'p-4 space-y-2' : 'hidden'}
    >
      {comments.map((c) => (
        <CommentItem key={c.id} userId={userId} comment={c} onChanged={onChanged} onDelete={onDelete} />
      ))}

      {open && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={5000}
            autoFocus
            placeholder="Наблюдение → почему это важно → следующий шаг для клиента"
            className={inputClass}
            aria-label={`Комментарий к блоку ${label}`}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon={<FileText size={12} />} onClick={() => setPicker(true)}>Вставить шаблон</Button>
              <Button size="sm" variant="ghost" icon={<BookmarkPlus size={12} />} loading={savingTpl} disabled={!text.trim()} onClick={() => void saveTemplate()}>
                Сохранить как шаблон
              </Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setText('') }} disabled={busy}>Отмена</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void add()}>В черновик</Button>
            </div>
          </div>
        </div>
      )}

      <TemplatePicker
        open={picker}
        onClose={() => setPicker(false)}
        block={block}
        blockLabel={label}
        onPick={(body) => setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${body}` : body))}
      />
    </Panel>
  )
}
