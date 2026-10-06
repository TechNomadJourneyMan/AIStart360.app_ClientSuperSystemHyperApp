'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Modal } from '@/components/ui/Modal'
import { DocumentStatusDetails } from '@/components/documents/DocumentStatus'
import { UploadMetaFields, emptyUploadMeta, uploadMetaToOptions, type UploadMeta } from '@/components/documents/UploadMetaFields'
import { notifyDocumentsChanged, useClientDocuments } from '@/hooks/useClientDocuments'
import {
  CLIENT_DOCUMENT_FORMATS_LABEL,
  CLIENT_DOCUMENT_MAX_LABEL,
  checkClientFile,
  uploadClientDocument,
  type ClientDocument,
  type UploadOutcome,
} from '@/lib/documents/client-upload'
import { documentStatusView, formatDocumentSize } from '@/lib/documents/status-view'

type Phase = 'form' | 'storage' | 'register' | 'result'

const PHASE_TEXT: Record<'storage' | 'register', string> = {
  storage: 'Загрузка в защищённое хранилище…',
  register: 'Проверка файла на сервере…',
}

/**
 * Quick upload of one picked file: the user chooses the document type (and an
 * optional period), the file goes through the upload contract, and the dialog
 * then shows the document's real processing state until it is closed.
 */
export function DocumentUploadDialog({
  file,
  onClose,
  companyId,
  documentsHref,
  onUploaded,
}: {
  /** The picked file; the dialog is open while it is set. */
  file: File | null
  onClose: () => void
  companyId?: string | null
  /** Where the full documents list lives (shown as a link). */
  documentsHref?: string
  /** Called once a document row exists (created or duplicate). */
  onUploaded?: (doc: ClientDocument, outcome: UploadOutcome) => void
}) {
  const [meta, setMeta] = useState<UploadMeta>(emptyUploadMeta)
  const [phase, setPhase] = useState<Phase>('form')
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null)

  useEffect(() => {
    setMeta(emptyUploadMeta())
    setPhase('form')
    setOutcome(null)
  }, [file])

  const trackedId = outcome && (outcome.kind === 'created' || outcome.kind === 'duplicate') ? outcome.document.id : null
  const { documents } = useClientDocuments({ enabled: trackedId !== null })
  const tracked = trackedId
    ? documents.find((d) => d.id === trackedId)
      ?? (outcome && (outcome.kind === 'created' || outcome.kind === 'duplicate') ? outcome.document : null)
    : null

  const busy = phase === 'storage' || phase === 'register'
  const check = file ? checkClientFile(file) : null
  const options = uploadMetaToOptions(meta)

  const close = () => {
    if (!busy) onClose()
  }

  const submit = async () => {
    if (!file || !options || busy) return
    setPhase('storage')
    const res = await uploadClientDocument(file, {
      ...options,
      companyId: companyId ?? null,
      onPhase: (p) => setPhase(p),
    })
    setOutcome(res)
    setPhase('result')
    if (res.kind === 'created' || res.kind === 'duplicate' || (res.kind === 'rejected' && res.document)) {
      notifyDocumentsChanged()
    }
    if (res.kind === 'created' || res.kind === 'duplicate') onUploaded?.(res.document, res)
  }

  // Rendered into <body>: callers sit inside backdrop-blur bars (Header,
  // toolbar), and backdrop-filter traps position:fixed children.
  if (file === null || typeof document === 'undefined') return null

  return createPortal(
    <Modal
      open
      onClose={close}
      title="Загрузка документа"
      description={`${CLIENT_DOCUMENT_FORMATS_LABEL} · до ${CLIENT_DOCUMENT_MAX_LABEL}`}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-surface-container border border-white/[0.04] px-3 py-2.5">
          <span className="material-symbols-outlined text-xl text-primary" aria-hidden>description</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-on-surface">{file.name}</p>
            <p className="text-[10px] font-mono text-on-surface-variant">{formatDocumentSize(file.size)}</p>
          </div>
        </div>

        {check && !check.ok ? (
          <ErrorBox message={check.error} />
        ) : phase === 'form' ? (
          <UploadMetaFields value={meta} onChange={setMeta} idPrefix="quick-upload" />
        ) : busy ? (
          <p className="flex items-center gap-2 text-xs font-mono text-primary" role="status" aria-live="polite">
            <span className="material-symbols-outlined text-sm animate-spin" aria-hidden>progress_activity</span>
            {PHASE_TEXT[phase as 'storage' | 'register']}
          </p>
        ) : outcome ? (
          <OutcomeView outcome={outcome} tracked={tracked} />
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {documentsHref && phase === 'result' && (outcome?.kind === 'created' || outcome?.kind === 'duplicate') && (
            <Link
              href={documentsHref}
              onClick={onClose}
              className="mr-auto inline-flex items-center gap-1 text-xs font-mono text-primary/80 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-lg px-1"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden>folder_open</span>
              Мои документы
            </Link>
          )}
          {phase === 'result' && outcome?.kind === 'failed' && outcome.stage !== 'validation' && (
            <button
              type="button"
              onClick={() => { setPhase('form'); setOutcome(null) }}
              className="px-4 py-2 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Повторить
            </button>
          )}
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="px-4 py-2 rounded-xl border border-white/[0.08] text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {phase === 'result' ? 'Закрыть' : 'Отмена'}
          </button>
          {(phase === 'form' || busy) && check?.ok && (
            <button
              type="button"
              onClick={submit}
              disabled={!options || busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className={`material-symbols-outlined text-base ${busy ? 'animate-spin' : ''}`} aria-hidden>
                {busy ? 'progress_activity' : 'upload'}
              </span>
              {busy ? 'Загружаем…' : 'Загрузить'}
            </button>
          )}
        </div>
      </div>
    </Modal>,
    document.body,
  )
}

function ErrorBox({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-error/10 border border-error/20 px-3 py-2.5" role="alert">
      <span className="material-symbols-outlined text-base text-error mt-px" aria-hidden>error</span>
      <div className="space-y-1">
        <p className="text-xs text-error">{message}</p>
        {children}
      </div>
    </div>
  )
}

function OutcomeView({ outcome, tracked }: { outcome: UploadOutcome; tracked: ClientDocument | null }) {
  if (outcome.kind === 'failed') {
    return (
      <ErrorBox message={outcome.error}>
        {outcome.code === 'NO_COMPANY' && (
          <Link href="/client/onboarding" className="text-xs font-mono text-primary hover:underline">
            Заполнить данные компании →
          </Link>
        )}
      </ErrorBox>
    )
  }
  if (outcome.kind === 'rejected') {
    return <ErrorBox message={`Файл отклонён: ${outcome.error}`} />
  }
  const doc = tracked ?? outcome.document
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-sm text-on-surface">
        <span className="material-symbols-outlined text-base text-primary" aria-hidden>
          {outcome.kind === 'duplicate' ? 'content_copy' : 'cloud_done'}
        </span>
        {outcome.kind === 'duplicate' ? outcome.message : 'Файл загружен, обработка запущена автоматически.'}
      </p>
      <div className="rounded-xl bg-surface-container border border-white/[0.04] px-3 py-2.5">
        <DocumentStatusDetails view={documentStatusView(doc)} />
      </div>
    </div>
  )
}
