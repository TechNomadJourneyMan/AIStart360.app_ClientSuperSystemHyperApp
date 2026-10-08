'use client'

/**
 * Manual start of an agent (POST /api/giga-admin/agents/:key/run, agents.run).
 * Company-scoped agents need a company; platform agents run without one.
 * Optional JSON input is validated here as an object and by the agent's own
 * schema on the server.
 *
 * Diagnostic pipeline stages («Сбор данных», …) cannot run on their own (they
 * need a diagnostic session): for them the dialog starts the whole diagnostic
 * of the chosen company instead (the orchestrator, run-model.ts).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Modal, cx, gigaFetch, inputClass } from '../kit'
import { CompanyPicker, type PickedCompany } from './CompanyPicker'
import { parseRunInput, scopeLabel } from './model'
import { diagnosticRunRequest, pipelineStageLabel } from './run-model'

export interface RunnableAgent { key: string; name: string; scope: 'company' | 'platform'; enabled: boolean }

export function RunAgentDialog({ agent, open, onClose, onStarted, base }: {
  agent: RunnableAgent | null
  open: boolean
  onClose: () => void
  onStarted?: (taskId: string) => void
  base: string
}) {
  const [company, setCompany] = useState<PickedCompany | null>(null)
  const [inputText, setInputText] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCompany(null); setInputText(''); setShowInput(false); setError(null); setTaskId(null)
  }, [open, agent?.key])

  if (!agent) return null
  const stage = pipelineStageLabel(agent.key)
  const parsed = parseRunInput(inputText)
  const needsCompany = agent.scope === 'company' || !!stage
  const ready = stage ? !!company : agent.enabled && parsed.ok && (!needsCompany || !!company)

  const run = async () => {
    if (!parsed.ok && !stage) return
    setBusy(true)
    setError(null)
    try {
      let r: { taskId: string }
      if (stage) {
        const d = diagnosticRunRequest(company!.id, stage)
        r = await gigaFetch<{ taskId: string }>(d.url, { method: 'POST', json: d.body })
        toast.success(company!.name ? `Диагностика компании «${company!.name}» запущена` : 'Диагностика компании запущена')
      } else {
        const body: Record<string, unknown> = {}
        if (needsCompany && company) body.companyId = company.id
        if (parsed.ok && parsed.value) body.input = parsed.value
        r = await gigaFetch<{ taskId: string }>(`/api/giga-admin/agents/${encodeURIComponent(agent.key)}/run`, { method: 'POST', json: body })
        toast.success(`${agent.name}: задача поставлена в очередь`)
      }
      setTaskId(r.taskId)
      onStarted?.(r.taskId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить агента')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={stage ? 'Запустить диагностику компании' : `Запустить: ${agent.name}`}
      footer={taskId ? (
        <>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
          <Link href={`${base}/agents/tasks/${taskId}`} className="inline-flex items-center gap-1.5 rounded-xl border border-blue-400/40 bg-blue-500 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
            Открыть задачу
          </Link>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant="primary" icon={<Play size={13} />} loading={busy} disabled={!ready} onClick={() => void run()}>{stage ? 'Запустить диагностику компании' : 'Запустить'}</Button>
        </>
      )}
    >
      {taskId ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] p-3">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
          <div className="text-xs text-slate-300">
            <p className="font-medium text-emerald-200">{stage ? 'Диагностика поставлена в очередь' : 'Задача поставлена в очередь'}</p>
            <p className="mt-1">Исполнитель возьмёт её в ближайшие секунды. Статус, попытки, вызовы инструментов и стоимость — на странице задачи.</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{taskId}</p>
          </div>
        </div>
      ) : stage ? (
        <div className="space-y-4 text-xs" data-testid="stage-run">
          <p className="rounded-xl border border-blue-500/25 bg-blue-500/[0.08] px-3 py-2 leading-relaxed text-blue-100">
            «{stage}» — этап диагностики компании. Отдельно он не запускается: этапы работают только внутри диагностики и идут по порядку
            (сбор данных → метрики → качество данных → бенчмарки → гипотезы → рекомендации).
          </p>
          <p className="leading-relaxed text-slate-400">
            Запустите диагностику выбранной компании — оркестратор откроет сессию и выполнит все этапы, включая «{stage}». Запуск записывается в журнал аудита.
          </p>
          <Field label="Для какой компании" hint="Диагностика работает только с данными выбранной компании.">
            <CompanyPicker value={company} onChange={setCompany} autoFocus />
          </Field>
          {error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4 text-xs">
          <p className="leading-relaxed text-slate-400">
            Ручной запуск ставит задачу в общую очередь с повышенным приоритетом. Действия, которые требуют одобрения, агент всё равно не выполнит без решения человека.
            Запуск записывается в журнал аудита.
          </p>
          <p className="text-[11px] text-slate-500">Тип агента: <span className="text-slate-300">{scopeLabel(agent.scope)}</span></p>
          {!agent.enabled && (
            <p role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-200">
              Агент выключен — сервер не примет запуск. Включите его в настройках агента.
            </p>
          )}
          {needsCompany && (
            <Field label="Для какой компании" hint="Агент работает только с данными выбранной компании.">
              <CompanyPicker value={company} onChange={setCompany} autoFocus />
            </Field>
          )}
          <div>
            <button
              type="button"
              onClick={() => setShowInput((v) => !v)}
              aria-expanded={showInput}
              className="text-[11px] text-blue-300 hover:text-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {showInput ? 'Скрыть входные данные' : 'Добавить входные данные (JSON, необязательно)'}
            </button>
            {showInput && (
              <div className="mt-2">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder="{}"
                  aria-label="Входные данные агента (JSON)"
                  aria-invalid={!parsed.ok}
                  className={cx(inputClass, 'font-mono text-[11px]', !parsed.ok && 'border-red-500/50')}
                />
                {!parsed.ok && <p className="mt-1 text-[11px] text-red-300">{parsed.error}</p>}
              </div>
            )}
          </div>
          {error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
