'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export type ShareReportType = 'survey' | 'gri' | 'point_a' | 'point_b'

// Map the share type (snake_case) → the PDF export route's type (kebab-case).
const PDF_TYPE: Record<ShareReportType, string> = {
  survey: 'survey',
  gri: 'gri',
  point_a: 'point-a',
  point_b: 'point-b',
}

const TYPE_LABEL: Record<ShareReportType, string> = {
  survey: 'анкеты',
  gri: 'GRI',
  point_a: 'Точки А',
  point_b: 'Точки Б',
}

const TYPE_SHORT: Record<ShareReportType, string> = {
  survey: 'Анкета',
  gri: 'GRI',
  point_a: 'Точка А',
  point_b: 'Точка Б',
}

interface ShareButtonProps {
  type: ShareReportType
  companyId: string | null | undefined
  /** Visual size of the trigger button (default sm). */
  size?: 'sm' | 'md'
  className?: string
  /**
   * Trigger button text. Defaults to «Поделиться». Pass a string to override,
   * or `true` to append the report name (e.g. «Поделиться · GRI») — handy when
   * several buttons sit side by side on a staff page.
   */
  triggerLabel?: string | boolean
}

/** Extract the token out of a public link like `/r/<token>` or full URL. */
function tokenFromUrl(url: string): string | null {
  const match = url.match(/\/r\/([^/?#]+)/)
  return match ? match[1] : null
}

/**
 * «Поделиться» — generates a read-only public link to one report (анкета / GRI /
 * Точка А / Точка Б) for the given company, with copy-to-clipboard, open in a
 * new tab, revoke access, plus a «Скачать PDF» (blob download with spinner).
 * Owner / staff only — the API enforces authorization.
 */
export function ShareButton({
  type,
  companyId,
  size = 'sm',
  className,
  triggerLabel,
}: ShareButtonProps) {
  const buttonText =
    typeof triggerLabel === 'string'
      ? triggerLabel
      : triggerLabel === true
        ? `Поделиться · ${TYPE_SHORT[type]}`
        : 'Поделиться'
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  const handleOpen = () => {
    setLink(null)
    setToken(null)
    setOpen(true)
  }

  const createLink = async () => {
    if (!companyId) {
      toast.error('Компания не определена — обновите страницу')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, companyId }),
      })
      const json = (await res.json()) as { url?: string; token?: string; error?: string }
      if (!res.ok || !json.url) {
        toast.error(
          json.error === 'forbidden'
            ? 'Недостаточно прав для этой компании'
            : 'Не удалось создать ссылку',
        )
        return
      }
      const fullUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${json.url}`
          : json.url
      setLink(fullUrl)
      setToken(json.token ?? tokenFromUrl(json.url))
      toast.success('Ссылка создана')
    } catch {
      toast.error('Ошибка сети — попробуйте ещё раз')
    } finally {
      setCreating(false)
    }
  }

  const copyLink = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Ссылка скопирована')
    } catch {
      toast.error('Не удалось скопировать')
    }
  }

  const openLink = () => {
    if (!link) return
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  const revokeLink = async () => {
    if (!token) {
      // Nothing server-side to revoke — just reset locally.
      setLink(null)
      setToken(null)
      return
    }
    setRevoking(true)
    try {
      const res = await fetch('/api/share', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        toast.error('Не удалось отозвать доступ')
        return
      }
      setLink(null)
      setToken(null)
      toast.success('Доступ отозван')
    } catch {
      toast.error('Ошибка сети — попробуйте ещё раз')
    } finally {
      setRevoking(false)
    }
  }

  const downloadPdf = async () => {
    setDownloading(true)
    try {
      const url = `/api/export/report?type=${PDF_TYPE[type]}${
        companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''
      }`
      const res = await fetch(url)
      if (!res.ok) {
        // Read the error payload safely — distinguish "no report yet" / auth /
        // permission from a genuine server fault so the user gets actionable copy.
        let errCode: string | undefined
        try {
          const body = (await res.json()) as { error?: string }
          errCode = body?.error
        } catch {
          errCode = undefined
        }
        if (res.status === 404 || errCode === 'no_data') {
          toast('Отчёт ещё не сформирован — заполните диагностику')
        } else if (res.status === 403 || errCode === 'forbidden') {
          toast.error('Недостаточно прав')
        } else if (res.status === 401) {
          toast.error('Войдите снова')
        } else {
          toast.error('Не удалось сформировать PDF')
        }
        return
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `aistart360-${PDF_TYPE[type]}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke after a tick so the download has a chance to start.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch {
      toast.error('Не удалось сформировать PDF')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={
          className ??
          `flex items-center gap-1.5 font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] hover:border-primary/30 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${
            size === 'md' ? 'text-sm px-4 py-2' : 'text-xs px-3 py-1.5'
          }`
        }
        aria-label={`Поделиться отчётом — ${TYPE_SHORT[type]}`}
      >
        <span className="material-symbols-outlined text-sm">share</span>
        {buttonText}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Поделиться отчётом"
        description={`Ссылка только для просмотра ${TYPE_LABEL[type]} — без входа в систему.`}
        size="md"
      >
        <div className="space-y-5">
          {/* Share link block */}
          <div className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
              Публичная ссылка
            </p>

            {link ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={link}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 bg-surface-container rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-mono text-on-surface truncate focus:outline-none focus:ring-2 focus:ring-primary/40"
                    aria-label="Публичная ссылка на отчёт"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon="content_copy"
                    onClick={copyLink}
                    aria-label="Копировать ссылку"
                  >
                    Копировать
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon="open_in_new"
                    onClick={openLink}
                    aria-label="Открыть ссылку в новой вкладке"
                  >
                    Открыть
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon="link_off"
                    loading={revoking}
                    onClick={revokeLink}
                    aria-label="Отозвать доступ по ссылке"
                  >
                    Отозвать доступ
                  </Button>
                </div>

                <p className="text-xs text-on-surface-variant">
                  Любой, у кого есть ссылка, увидит отчёт в режиме «только
                  просмотр». Вы можете отозвать доступ в любой момент.
                </p>
              </div>
            ) : (
              <Button
                variant="primary"
                size="md"
                leftIcon="link"
                loading={creating}
                onClick={createLink}
                className="w-full"
              >
                Создать ссылку
              </Button>
            )}
          </div>

          {/* PDF download block */}
          <div className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
              Скачать файл
            </p>
            <Button
              variant="secondary"
              size="md"
              leftIcon={downloading ? undefined : 'picture_as_pdf'}
              loading={downloading}
              onClick={downloadPdf}
              aria-label="Скачать отчёт в PDF"
            >
              {downloading ? 'Формируем PDF…' : 'Скачать PDF'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

export default ShareButton
