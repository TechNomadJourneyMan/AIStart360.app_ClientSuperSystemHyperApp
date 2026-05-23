'use client'

import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
}

interface CrmOption {
  id: string
  name: string
  icon: string
  description: string
  href?: string
}

const CRMS: CrmOption[] = [
  {
    id: 'amocrm',
    name: 'amoCRM',
    icon: 'sync_alt',
    description: 'Прямая выгрузка сделок, контактов и воронок через REST API.',
  },
  {
    id: 'bitrix24',
    name: 'Bitrix24',
    icon: 'apartment',
    description: 'Импорт лидов, сделок и активностей через вебхуки Bitrix24.',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    icon: 'hub',
    description: 'OAuth-подключение к HubSpot CRM, синхронизация в обе стороны.',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    icon: 'cloud',
    description: 'Connected App + Bulk API 2.0 для импорта контактов и opportunity.',
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    icon: 'view_kanban',
    description: 'API-токен → импорт сделок, активностей и пользовательских полей.',
  },
  {
    id: 'csv',
    name: 'Загрузить CSV / Excel',
    icon: 'upload_file',
    description: 'Если у вас нет CRM или своя БД — загрузите выгрузку файлом.',
    href: '/client/onboarding/documents',
  },
]

export function CRMConnectModal({ open, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      setSelected(null)
      setRequested(false)
    }
  }, [open])

  if (!open) return null

  const handleRequest = () => {
    if (!selected) return
    // Persist the user's intent so other parts of the app can show a
    // "запрос на подключение CRM отправлен" state without a real integration.
    try {
      const payload = { crm: selected, requested_at: new Date().toISOString() }
      localStorage.setItem('aistart_crm_connect_request', JSON.stringify(payload))
    } catch {
      // ignore
    }
    setRequested(true)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-container rounded-2xl border border-white/[0.06] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-surface-container/95 backdrop-blur border-b border-white/[0.04] p-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
              Интеграции · CRM
            </p>
            <h2 className="font-headline text-lg font-bold text-on-surface">
              Подключите вашу CRM
            </h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Выберите систему — AIStart360 подтянет клиентов, сделки и воронки для RFM-анализа.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="w-8 h-8 rounded-lg bg-surface-container-high hover:bg-white/[0.08] flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="p-4 space-y-3">
          {requested ? (
            <div className="text-center py-8 space-y-3">
              <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-2xl text-primary">check_circle</span>
              </div>
              <h3 className="font-headline text-base font-bold text-on-surface">
                Запрос отправлен
              </h3>
              <p className="text-sm text-on-surface-variant max-w-md mx-auto">
                Мы получили заявку на подключение <span className="text-primary font-mono">{CRMS.find(c => c.id === selected)?.name}</span>. Менеджер свяжется в течение 24 часов и поможет с настройкой.
              </p>
              <div className="flex items-center justify-center gap-2 pt-2">
                <a
                  href="https://tidycal.com/istart/gtm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-on-primary bg-primary hover:bg-primary/90 px-3 py-2 rounded-lg transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">event_available</span>
                  Ускорить — записаться на звонок
                  <span className="material-symbols-outlined text-[12px] opacity-70">open_in_new</span>
                </a>
                <button
                  onClick={onClose}
                  className="text-xs font-mono text-on-surface-variant hover:text-on-surface px-3 py-2 rounded-lg transition-colors"
                >
                  Закрыть
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CRMS.map((crm) => {
                  const isSelected = selected === crm.id
                  return crm.href ? (
                    <a
                      key={crm.id}
                      href={crm.href}
                      className="flex items-start gap-3 p-3 rounded-xl border border-white/[0.06] hover:border-primary/30 hover:bg-primary/[0.04] transition-all text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-base text-primary">
                          {crm.icon}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-on-surface">{crm.name}</p>
                        <p className="text-[11px] text-on-surface-variant leading-snug">
                          {crm.description}
                        </p>
                      </div>
                    </a>
                  ) : (
                    <button
                      key={crm.id}
                      type="button"
                      onClick={() => setSelected(crm.id)}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-all text-left ${
                        isSelected
                          ? 'border-primary/50 bg-primary/[0.06]'
                          : 'border-white/[0.06] hover:border-primary/30 hover:bg-primary/[0.04]'
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-primary/20' : 'bg-surface-container-high'
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-base ${
                            isSelected ? 'text-primary' : 'text-on-surface-variant'
                          }`}
                        >
                          {crm.icon}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-on-surface">{crm.name}</p>
                          {isSelected && (
                            <span className="material-symbols-outlined text-[16px] text-primary">
                              radio_button_checked
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-on-surface-variant leading-snug">
                          {crm.description}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
                <button
                  onClick={onClose}
                  className="text-xs font-mono text-on-surface-variant hover:text-on-surface px-3 py-2 rounded-lg transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={handleRequest}
                  disabled={!selected}
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-on-primary bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">send</span>
                  Запросить подключение
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
