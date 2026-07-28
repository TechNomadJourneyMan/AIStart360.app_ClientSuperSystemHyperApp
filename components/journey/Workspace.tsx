'use client'

import * as Tooltip from '@radix-ui/react-tooltip'
import {
  AlertCircle,
  Bot,
  Database,
  HardDrive,
  Layers3,
  LoaderCircle,
  Map as MapIcon,
  MessageCircle,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { journeyWidgetSchema } from '@/lib/journey/schema'
import {
  createJourneyConnectCode,
  getJourney,
  JourneyRequestError,
  patchJourney,
  postJourneyDocument,
  postJourneyMessage,
  redeemJourneyConnectCode,
} from './api'
import { reconcileAutosaveResult } from './autosave'
import { ChatDock } from './ChatDock'
import { DeviceConnectDialog } from './DeviceConnectDialog'
import { afterFactsConfirmed, refreshKnowledgeWidget, runLocalTurn } from './demo-machine'
import {
  createJourneyDemoScenarioState,
  journeyDemoIdentityStorageKey,
  type JourneyDemoScenario,
} from './demo-scenarios'
import { getCurrentConfirmedJourneyGoal, isJourneyConversationFirst } from './JourneyExperience'
import { JourneyCanvas, JourneyMobileBoard } from './JourneyCanvas'
import {
  createEmptyWorkspace,
  createIdentity,
  isJourneyWorkspaceView,
  journeyStateStorageKey,
  LOCAL_IDENTITY_KEY,
  LOCAL_STATE_KEY,
  makeId,
  MAX_FILE_BYTES,
  SUPPORTED_FILE_EXTENSIONS,
  type JourneyIdentity,
  type JourneySuggestionView,
  type JourneyWidgetView,
  type JourneyWorkspaceView,
} from './model'
import { ModulesPanel } from './ModulesPanel'
import {
  allowsJourneyLocalDemo,
  isJourneyPublicDemo,
  selectJourneyInitialState,
} from './runtime'
import { preserveUserWidgetState } from './widget-state'

type MobileView = 'board' | 'chat' | 'modules'

interface PendingAutosave {
  identity: JourneyIdentity
  state: JourneyWorkspaceView
}

interface AutosaveQueueController {
  getCurrent: () => Promise<void> | null
  setCurrent: (promise: Promise<void> | null) => void
  hasPending: () => boolean
  drain: () => Promise<void>
}

/**
 * Starts at most one autosave worker and closes the small settlement window
 * where a new job can be queued after the worker drained but before its
 * promise reference is cleared.
 */
export function startSerializedAutosaveQueue(controller: AutosaveQueueController): Promise<void> {
  const existing = controller.getCurrent()
  if (existing) return existing

  const running = controller.drain()
  controller.setCurrent(running)

  const settle = () => {
    if (controller.getCurrent() !== running) return
    controller.setCurrent(null)
    if (controller.hasPending()) void startSerializedAutosaveQueue(controller)
  }
  void running.then(settle, settle)

  return running
}

/** Waits through worker handoffs until the serialized autosave queue is idle. */
export async function waitForSerializedAutosaveIdle(
  getCurrent: () => Promise<void> | null,
): Promise<void> {
  let current = getCurrent()
  while (current) {
    await current
    current = getCurrent()
  }
}

export function JourneyWorkspace({
  initialDemoScenario,
}: {
  initialDemoScenario?: JourneyDemoScenario
} = {}) {
  const publicDemo = isJourneyPublicDemo()
  const demoScenario = allowsJourneyLocalDemo() ? initialDemoScenario : undefined
  const scenarioLocalDemo = Boolean(demoScenario)
  const identityStorageKey = demoScenario
    ? journeyDemoIdentityStorageKey(demoScenario)
    : LOCAL_IDENTITY_KEY
  const [identity, setIdentity] = useState<JourneyIdentity | null>(null)
  const [state, setState] = useState<JourneyWorkspaceView>(() => ({
    ...createEmptyWorkspace('guest-loading'),
    phase: 'loading',
  }))
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [chatExpanded, setChatExpanded] = useState(true)
  const [mobileView, setMobileView] = useState<MobileView>('chat')
  const [statusMessage, setStatusMessage] = useState('Подключаем рабочее пространство…')
  const [actionError, setActionError] = useState('')
  const [draftSeed, setDraftSeed] = useState('')
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false)
  const isDesktop = useDesktopViewport()
  const stateRef = useRef(state)
  const identityRef = useRef<JourneyIdentity | null>(null)
  const serverAvailableRef = useRef(false)
  const accessVerifiedRef = useRef(false)
  const skipNextPatchRef = useRef(false)
  const pendingAutosaveRef = useRef<PendingAutosave | null>(null)
  const autosavePromiseRef = useRef<Promise<void> | null>(null)

  const commit = useCallback((next: JourneyWorkspaceView) => {
    const arranged = resolveWidgetCollisions(limitExpandedWidgets(next))
    stateRef.current = arranged
    setState(arranged)
  }, [])

  const invalidateJourneyAccess = useCallback((message = 'Доступ к рабочему пространству истёк или был отозван.') => {
    const current = identityRef.current
    if (current) clearJourneyCache(current.workspaceId, identityStorageKey)
    pendingAutosaveRef.current = null
    identityRef.current = null
    serverAvailableRef.current = false
    accessVerifiedRef.current = false
    setIdentity(null)
    const inaccessible: JourneyWorkspaceView = {
      ...createEmptyWorkspace(current?.workspaceId ?? 'access-unavailable'),
      phase: 'error',
      messages: [
        {
          id: makeId('message'),
          role: 'system',
          text: `${message} Подключите устройство повторно с помощью нового одноразового кода.`,
          createdAt: new Date().toISOString(),
        },
      ],
      provider: { mode: 'unavailable', label: 'Доступ не подтверждён' },
      persistence: {
        mode: 'unavailable',
        label: 'Синхронизация остановлена',
        reason: message,
      },
      updatedAt: new Date().toISOString(),
    }
    commit(inaccessible)
    setActionError(message)
    setStatusMessage('Подключите устройство повторно · локальный fallback не включён')
  }, [commit, identityStorageKey])

  const reloadRemoteAfterConflict = useCallback(async (
    currentIdentity: JourneyIdentity,
    message = 'На другом устройстве появилась новая версия. Загружено актуальное состояние — повторите действие.',
  ) => {
    try {
      const result = await getJourney(currentIdentity, stateRef.current)
      serverAvailableRef.current = true
      accessVerifiedRef.current = result.state.persistence.mode === 'database'
      skipNextPatchRef.current = true
      commit(result.state)
      setActionError(message)
      setStatusMessage('Загружена свежая серверная версия')
    } catch (cause) {
      if (isAuthorizationError(cause)) {
        invalidateJourneyAccess()
        return
      }
      setActionError('Не удалось загрузить свежую серверную версию. Локальные изменения не отправлены.')
      setStatusMessage('Конфликт синхронизации требует повторной загрузки')
    }
  }, [commit, invalidateJourneyAccess])

  const drainAutosaveQueue = useCallback(async () => {
    while (pendingAutosaveRef.current) {
      const job = pendingAutosaveRef.current
      pendingAutosaveRef.current = null
      const activeIdentity = identityRef.current
      if (!activeIdentity || activeIdentity.workspaceId !== job.identity.workspaceId) continue

      try {
        const result = await patchJourney(job.identity, job.state)
        if (identityRef.current?.workspaceId !== job.identity.workspaceId) continue

        const reconciled = reconcileAutosaveResult(job.state, stateRef.current, result.state)
        skipNextPatchRef.current = true
        commit(reconciled.state)

        if (reconciled.needsSave) {
          pendingAutosaveRef.current = {
            identity: job.identity,
            state: stateRef.current,
          }
        }
      } catch (cause) {
        pendingAutosaveRef.current = null
        if (isConflictError(cause)) {
          await reloadRemoteAfterConflict(job.identity)
          break
        }
        if (isAuthorizationError(cause)) {
          invalidateJourneyAccess()
          break
        }
        setStatusMessage('Изменения сохранены локально; синхронизация с базой не удалась')
        break
      }
    }
  }, [commit, invalidateJourneyAccess, reloadRemoteAfterConflict])

  const startAutosaveQueue = useCallback(() => {
    return startSerializedAutosaveQueue({
      getCurrent: () => autosavePromiseRef.current,
      setCurrent: (promise) => {
        autosavePromiseRef.current = promise
      },
      hasPending: () => pendingAutosaveRef.current !== null,
      drain: drainAutosaveQueue,
    })
  }, [drainAutosaveQueue])

  const awaitAutosaveIdle = useCallback(
    () => waitForSerializedAutosaveIdle(() => autosavePromiseRef.current),
    [],
  )

  useEffect(() => {
    let active = true

    const initialize = async () => {
      const storedIdentity = readStoredIdentity(identityStorageKey)
      const generatedIdentity = createIdentity()
      const nextIdentity: JourneyIdentity = demoScenario
        ? {
            workspaceId: storedIdentity?.workspaceId
              ?? `demo-${demoScenario}-${generatedIdentity.workspaceId}`,
          }
        : storedIdentity ?? generatedIdentity
      identityRef.current = nextIdentity
      setIdentity(nextIdentity)
      writeStoredIdentity(nextIdentity, identityStorageKey)

      const allowLocalDemo = allowsJourneyLocalDemo()
      const storedState = readStoredState(nextIdentity.workspaceId)
      const local = storedState ?? (
        demoScenario
          ? createJourneyDemoScenarioState(demoScenario, nextIdentity.workspaceId)
          : createEmptyWorkspace(nextIdentity.workspaceId)
      )
      const safeEmpty: JourneyWorkspaceView = {
        ...createEmptyWorkspace(nextIdentity.workspaceId),
        phase: 'loading',
      }
      if (!active) return
      commit(allowLocalDemo ? local : safeEmpty)
      setStatusMessage(
        allowLocalDemo && local.messages.length > 1
          ? 'Локальное состояние восстановлено'
          : 'Проверяем серверный доступ к рабочему пространству…',
      )

      // A shareable scenario is a deliberately browser-local presentation.
      // Never resolve it against an authenticated canonical workspace: a
      // signed-in visitor must not replace the demo with private account data,
      // and the demo must not write into that account through autosave.
      if (demoScenario) {
        serverAvailableRef.current = false
        accessVerifiedRef.current = false
        commit(local)
        setChatExpanded(false)
        setMobileView('board')
        setStatusMessage('Демо-проект HONOR загружен · неизвестные показатели нужно подтвердить')
        setHydrated(true)
        return
      }

      try {
        const result = await getJourney(nextIdentity, allowLocalDemo ? local : safeEmpty)
        if (!active) return
        if (!allowLocalDemo && result.state.persistence.mode !== 'database') {
          throw new JourneyRequestError('Серверная авторизация Journey временно недоступна.', 503)
        }
        const resolvedIdentity: JourneyIdentity = result.state.workspaceId === nextIdentity.workspaceId
          ? nextIdentity
          : { workspaceId: result.state.workspaceId }
        if (resolvedIdentity.workspaceId !== nextIdentity.workspaceId) {
          identityRef.current = resolvedIdentity
          setIdentity(resolvedIdentity)
          writeStoredIdentity(resolvedIdentity, identityStorageKey)
        }
        serverAvailableRef.current = true
        accessVerifiedRef.current = result.state.persistence.mode === 'database'
        // With no DB configured the GET endpoint returns an honest empty/local
        // envelope. It must never outrank richer browser state on reload.
        const chosen = selectJourneyInitialState(local, result.state, allowLocalDemo)
        skipNextPatchRef.current = true
        commit(chosen)
        setChatExpanded(chosen.phase !== 'ready')
        setMobileView(chosen.phase === 'ready' ? 'board' : 'chat')
        setStatusMessage(
          demoScenario
            ? 'Демо-проект HONOR загружен · неизвестные показатели нужно подтвердить'
            : chosen.provider.mode === 'live'
            ? 'AI подключён и готов к диалогу'
            : 'Демо-режим: ответы помечаются явно',
        )
      } catch (cause) {
        if (!active) return
        if (isAuthorizationError(cause)) {
          invalidateJourneyAccess()
          return
        }
        serverAvailableRef.current = false
        accessVerifiedRef.current = false
        if (!allowLocalDemo) {
          clearJourneyStateCache(nextIdentity.workspaceId)
          const reason = cause instanceof JourneyRequestError && cause.status === 503
            ? 'Серверная проверка доступа временно недоступна.'
            : 'Не удалось безопасно подтвердить серверный доступ.'
          commit(createFailClosedWorkspace(nextIdentity.workspaceId, reason))
          setChatExpanded(true)
          setMobileView('chat')
          setActionError(`${reason} Ранее сохранённые данные скрыты.`)
          setStatusMessage('Серверный доступ не подтверждён · локальный fallback выключен')
          return
        }
        const localOnly: JourneyWorkspaceView = {
          ...local,
          provider: { mode: 'demo', label: 'Демо-логика' },
          persistence: {
            mode: 'local',
            label: 'Сохранение на устройстве',
            reason: 'Journey API недоступен; данные остаются только в этом браузере.',
          },
        }
        commit(localOnly)
        setChatExpanded(localOnly.phase !== 'ready')
        setMobileView(localOnly.phase === 'ready' ? 'board' : 'chat')
        setStatusMessage('Локальный демо-режим · без внешней AI-модели')
      } finally {
        if (active) setHydrated(true)
      }
    }

    void initialize()
    return () => {
      active = false
    }
  }, [commit, demoScenario, identityStorageKey, invalidateJourneyAccess])

  useEffect(() => {
    if (!hydrated || !identity || busy) return
    writeStoredState(state)

    if (skipNextPatchRef.current) {
      skipNextPatchRef.current = false
      return
    }
    if (!serverAvailableRef.current) return

    const timeout = window.setTimeout(() => {
      pendingAutosaveRef.current = { identity, state }
      void startAutosaveQueue()
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [busy, hydrated, identity, startAutosaveQueue, state])

  const sendMessage = async (text: string) => {
    const initialIdentity = identityRef.current
    if (!initialIdentity || busy || !text.trim()) return

    setBusy(true)
    setActionError('')
    setChatExpanded(true)
    setMobileView('chat')
    await awaitAutosaveIdle()
    const currentIdentity = identityRef.current
    if (!currentIdentity || currentIdentity.workspaceId !== initialIdentity.workspaceId) {
      setBusy(false)
      return
    }
    const base = stateRef.current
    setStatusMessage(base.provider.mode === 'live' ? 'AI анализирует контекст…' : 'Демо-логика разбирает сообщение…')
    commit({ ...base, phase: 'analyzing', updatedAt: new Date().toISOString() })

    try {
      if (!serverAvailableRef.current) throw new Error('Journey API unavailable')
      const result = await postJourneyMessage(currentIdentity, base, text)
      skipNextPatchRef.current = true
      const rebased = preserveUserWidgetState(result.state, stateRef.current)
      commit(rebased)
      if (isDesktop && rebased.phase === 'ready') setChatExpanded(false)
      setStatusMessage(rebased.provider.mode === 'live' ? 'Ответ готов · изменения сохранены' : 'Ответ готов · демонстрационный режим')
    } catch (cause) {
      if (isConflictError(cause)) {
        await reloadRemoteAfterConflict(currentIdentity, 'Диалог изменился на другом устройстве. Свежая версия загружена — отправьте сообщение ещё раз.')
        return
      }
      if (isAuthorizationError(cause)) {
        invalidateJourneyAccess()
        return
      }
      if (process.env.NODE_ENV === 'production' && !accessVerifiedRef.current && !scenarioLocalDemo) {
        setActionError('Серверный доступ не подтверждён. Демо-fallback не может открыть или изменить данные этого Journey.')
        setStatusMessage('Сначала восстановите безопасное серверное подключение')
        return
      }
      const fallback = preserveUserWidgetState(runLocalTurn(base, text), stateRef.current)
      commit(fallback)
      if (isDesktop && fallback.phase === 'ready') setChatExpanded(false)
      setStatusMessage('Ответ создан локальной демо-логикой · не внешней AI-моделью')
    } finally {
      setBusy(false)
    }
  }

  const uploadFiles = async (files: File[]) => {
    const initialIdentity = identityRef.current
    if (!initialIdentity || busy) return
    setActionError('')

    const invalid = files.find((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
      return !SUPPORTED_FILE_EXTENSIONS.includes(extension) || file.size > MAX_FILE_BYTES
    })
    if (invalid) {
      const extension = invalid.name.split('.').pop()?.toLowerCase() ?? ''
      setActionError(
        !SUPPORTED_FILE_EXTENSIONS.includes(extension)
          ? `Формат .${extension || '?'} не поддерживается. Используйте PDF, DOCX, CSV или TXT. Excel временно отключён проверкой безопасности.`
          : `Файл «${invalid.name}» больше 4 МБ.`,
      )
      return
    }

    setBusy(true)
    setChatExpanded(true)
    setMobileView('chat')
    await awaitAutosaveIdle()
    const currentIdentity = identityRef.current
    if (!currentIdentity || currentIdentity.workspaceId !== initialIdentity.workspaceId) {
      setBusy(false)
      return
    }

    for (const file of files) {
      const fileId = makeId('file')
      const uploading = {
        id: fileId,
        name: file.name,
        sizeBytes: file.size,
        mime: file.type,
        status: 'uploading' as const,
        statusLabel: 'Загрузка…',
      }
      const base: JourneyWorkspaceView = {
        ...stateRef.current,
        phase: 'analyzing',
        files: [...stateRef.current.files, uploading],
        updatedAt: new Date().toISOString(),
      }
      commit(refreshKnowledgeWidget(base))
      setStatusMessage(`Загружаем «${file.name}»…`)

      try {
        if (!serverAvailableRef.current) throw new Error('Journey API unavailable')
        const analyzing: JourneyWorkspaceView = {
          ...stateRef.current,
          files: stateRef.current.files.map((item) =>
            item.id === fileId ? { ...item, status: 'analyzing', statusLabel: 'Анализируется…' } : item,
          ),
        }
        commit(refreshKnowledgeWidget(analyzing))
        const result = await postJourneyDocument(currentIdentity, analyzing, file)
        skipNextPatchRef.current = true
        commit(preserveUserWidgetState(result.state, stateRef.current))
        setStatusMessage(`Анализ «${file.name}» завершён`)
      } catch (cause) {
        if (isConflictError(cause)) {
          await reloadRemoteAfterConflict(currentIdentity, 'Доска обновилась на другом устройстве. Свежая версия загружена — добавьте файл ещё раз.')
          break
        }
        if (isAuthorizationError(cause)) {
          invalidateJourneyAccess()
          break
        }
        if (process.env.NODE_ENV === 'production' && !accessVerifiedRef.current && !scenarioLocalDemo) {
          setActionError('Серверный доступ не подтверждён. Файл не сохранён и не анализировался.')
          setStatusMessage('Сначала восстановите безопасное серверное подключение')
          break
        }
        const localOnly: JourneyWorkspaceView = {
          ...stateRef.current,
          phase: stateRef.current.facts.length ? 'partial' : 'empty',
          files: stateRef.current.files.map((item) =>
            item.id === fileId
              ? {
                  ...item,
                  status: 'local-only',
                  statusLabel: 'Без анализа · только локально',
                }
              : item,
          ),
          messages: [
            ...stateRef.current.messages,
            {
              id: makeId('message'),
              role: 'assistant',
              text: `Файл «${file.name}» сохранён в локальном состоянии, но содержимое не анализировалось: серверный обработчик недоступен. Я не буду делать выводы из имени файла.`,
              createdAt: new Date().toISOString(),
            },
          ],
          provider: { mode: 'demo', label: 'Демо-логика' },
          persistence: {
            mode: 'local',
            label: 'Сохранение на устройстве',
            reason: 'Содержимое файла не отправлено и не проанализировано.',
          },
          updatedAt: new Date().toISOString(),
        }
        commit(refreshKnowledgeWidget(localOnly))
        setStatusMessage(`«${file.name}» сохранён локально без анализа`)
      }
    }

    setBusy(false)
  }

  const updateFacts = (updater: (facts: JourneyWorkspaceView['facts']) => JourneyWorkspaceView['facts']) => {
    const current = stateRef.current
    const facts = updater(current.facts)
    const previousFacts = new Map(current.facts.map((fact) => [fact.id, fact]))
    const changedFactIds = new Set(facts
      .filter((fact) => {
        const previous = previousFacts.get(fact.id)
        return !previous || previous.value !== fact.value || previous.status !== fact.status
      })
      .map((fact) => fact.id))
    const widgetDecisions = (current.widgetDecisions ?? []).filter((decision) =>
      !decision.evidenceFactIds.some((factId) => changedFactIds.has(factId)),
    )
    let next: JourneyWorkspaceView = {
      ...current,
      facts,
      widgetDecisions,
      updatedAt: new Date().toISOString(),
    }
    if (!facts.some((fact) => fact.status === 'pending') && facts.some((fact) => fact.status === 'confirmed')) {
      next = afterFactsConfirmed(next)
      setChatExpanded(true)
      setStatusMessage('Точка A обновлена · сформулируйте измеримую Точку B')
    }
    commit(next)
  }

  const confirmFact = (id: string) => {
    updateFacts((facts) => facts.map((fact) => (fact.id === id ? { ...fact, status: 'confirmed' as const } : fact)))
  }

  const confirmAllFacts = () => {
    updateFacts((facts) => facts.map((fact) => (fact.status === 'pending' ? { ...fact, status: 'confirmed' as const } : fact)))
  }

  const editFact = (id: string, value: string) => {
    updateFacts((facts) => facts.map((fact) => (fact.id === id ? { ...fact, value, status: 'pending' as const } : fact)))
  }

  const rejectFact = (id: string) => {
    updateFacts((facts) => facts.map((fact) => (fact.id === id ? { ...fact, status: 'rejected' as const } : fact)))
  }

  const restoreFact = (id: string) => {
    updateFacts((facts) => facts.map((fact) => (fact.id === id ? { ...fact, status: 'pending' as const } : fact)))
  }

  const updateWidgets = (updater: (widgets: JourneyWorkspaceView['widgets']) => JourneyWorkspaceView['widgets']) => {
    const current = stateRef.current
    commit({ ...current, widgets: updater(current.widgets), updatedAt: new Date().toISOString() })
  }

  const toggleWidget = (id: string) => {
    updateWidgets((widgets) => {
      const toggled = widgets.map((widget) =>
        widget.id === id ? patchWidget(widget, { collapsed: !widget.collapsed, hidden: false }) : widget,
      )
      return limitExpandedWidgetList(toggled, id)
    })
  }

  const focusWidget = (id: string) => {
    updateWidgets((widgets) => limitExpandedWidgetList(widgets.map((widget) =>
      patchWidget(widget, {
        focused: widget.id === id ? !widget.focused : false,
        collapsed: widget.id === id ? false : widget.collapsed,
        hidden: widget.id === id ? false : widget.hidden,
      }),
    ), id))
  }

  const hideWidget = (id: string) => {
    updateWidgets((widgets) => widgets.map((widget) =>
      widget.id === id ? patchWidget(widget, { hidden: true, focused: false }) : widget,
    ))
  }

  const restoreWidget = (id: string) => {
    updateWidgets((widgets) => widgets.map((widget) =>
      widget.id === id ? patchWidget(widget, { hidden: false, collapsed: true }) : widget,
    ))
  }

  const moveWidget = (id: string, position: { x: number; y: number }) => {
    const current = stateRef.current
    const manualWidgetIds = [...new Set([...(current.manualWidgetIds ?? []), id])].slice(0, 24)
    commit({
      ...current,
      manualWidgetIds,
      widgets: current.widgets.map((widget) =>
        widget.id === id ? patchWidget(widget, { position }) : widget,
      ),
      updatedAt: new Date().toISOString(),
    })
    setStatusMessage('Позиция модуля сохранена')
  }

  const reorderWidget = (activeId: string, overId: string) => {
    if (activeId === overId) return
    const current = stateRef.current
    const availableIds = new Set(current.widgets.map((widget) => widget.id))
    const ordered = [
      ...(current.widgetOrder ?? []).filter((id) => availableIds.has(id)),
      ...[...current.widgets]
        .sort((a, b) => b.priority - a.priority)
        .map((widget) => widget.id)
        .filter((id) => !(current.widgetOrder ?? []).includes(id)),
    ]
    const from = ordered.indexOf(activeId)
    const to = ordered.indexOf(overId)
    if (from < 0 || to < 0) return
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved)
    commit({
      ...current,
      widgetOrder: ordered.slice(0, 24),
      updatedAt: new Date().toISOString(),
    })
    setStatusMessage('Порядок модулей сохранён')
  }

  const resetWidgetLayout = () => {
    const current = stateRef.current
    commit({
      ...current,
      manualWidgetIds: [],
      widgetOrder: [],
      updatedAt: new Date().toISOString(),
    })
    setStatusMessage('Расположение модулей восстановлено')
  }

  const discussWidget = (widget: JourneyWidgetView) => {
    setDraftSeed(`Обсудим модуль «${widget.title}». Что здесь важнее всего уточнить следующим?`)
    setChatExpanded(true)
    setMobileView('chat')
    setStatusMessage(`Готов обсудить модуль «${widget.title}»`)
  }

  const updateSuggestion = (id: string, status: JourneySuggestionView['status']) => {
    const current = stateRef.current
    commit({
      ...current,
      suggestions: current.suggestions.map((item) => (item.id === id ? { ...item, status } : item)),
      updatedAt: new Date().toISOString(),
    })
  }

  const acceptSuggestion = (suggestion: JourneySuggestionView) => {
    updateSuggestion(suggestion.id, 'hidden')
    setDraftSeed(suggestion.value)
    setChatExpanded(true)
    setMobileView('chat')
  }

  const createDeviceCode = async () => {
    if (demoScenario) {
      throw new JourneyRequestError('Подключение устройств отключено в демонстрационном проекте.', 403)
    }
    const currentIdentity = identityRef.current
    if (!currentIdentity) {
      throw new JourneyRequestError('Сначала восстановите доступ к рабочему пространству.', 401)
    }
    try {
      return await createJourneyConnectCode(currentIdentity)
    } catch (cause) {
      if (isAuthorizationError(cause)) invalidateJourneyAccess()
      throw cause
    }
  }

  const redeemDeviceCode = async (code: string, deviceLabel: string) => {
    if (demoScenario) {
      throw new JourneyRequestError('Подключение устройств отключено в демонстрационном проекте.', 403)
    }
    const previousWorkspaceId = identityRef.current?.workspaceId
    const result = await redeemJourneyConnectCode(code, deviceLabel, stateRef.current)
    const linkedIdentity: JourneyIdentity = { workspaceId: result.workspaceId }
    pendingAutosaveRef.current = null
    if (previousWorkspaceId && previousWorkspaceId !== result.workspaceId) {
      clearJourneyCache(previousWorkspaceId, identityStorageKey)
    }
    identityRef.current = linkedIdentity
    serverAvailableRef.current = true
    accessVerifiedRef.current = true
    skipNextPatchRef.current = true
    writeStoredIdentity(linkedIdentity, identityStorageKey)
    writeStoredState(result.state)
    setIdentity(linkedIdentity)
    commit(result.state)
    setChatExpanded(result.state.phase !== 'ready')
    setActionError('')
    setStatusMessage('Устройство подключено · загружена актуальная доска')
    setMobileView('board')
  }

  if (!hydrated) return <WorkspaceSkeleton />

  const conversationFirst = isJourneyConversationFirst(state)
  const focusConversation = conversationFirst || state.phase === 'error'
  const openBoard = () => {
    setMobileView('board')
    setChatExpanded(false)
  }

  const sharedChatProps = {
    state,
    busy,
    expanded: chatExpanded,
    statusMessage,
    actionError,
    draftSeed,
    onExpandedChange: setChatExpanded,
    onSend: sendMessage,
    onFiles: uploadFiles,
    onFactConfirm: confirmFact,
    onFactsConfirmAll: confirmAllFacts,
    onFactEdit: editFact,
    onFactReject: rejectFact,
    onFactRestore: restoreFact,
    onSuggestionAccept: acceptSuggestion,
    onSuggestionReject: (id: string) => updateSuggestion(id, 'rejected'),
    onSuggestionHide: (id: string) => updateSuggestion(id, 'hidden'),
    onOpenBoard: openBoard,
  }

  return (
    <Tooltip.Provider>
      <div
        className="relative flex h-dvh min-h-[520px] flex-col overflow-hidden bg-background text-on-surface"
        data-demo-scenario={demoScenario}
      >
        <WorkspaceHeader
          state={state}
          onDeviceConnect={demoScenario ? undefined : () => setDeviceDialogOpen(true)}
        />

        {(publicDemo || demoScenario) && (
          <div
            className="z-30 flex shrink-0 items-center justify-center gap-1.5 bg-warning/10 px-3 py-1.5 text-center text-[11px] leading-4 text-warning"
            data-testid={demoScenario ? 'demo-project-banner' : undefined}
            role="status"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            {demoScenario ? (
              <>
                <span className="sm:hidden">HONOR GROUP · публичные факты + тестовая цель</span>
                <span className="hidden sm:inline">HONOR GROUP · публичный профиль myhonor.shop и явно тестовая цель. Неизвестные показатели не выдуманы; данные остаются в этом браузере.</span>
                <a
                  href="https://myhonor.shop"
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-semibold underline underline-offset-2"
                >
                  источник
                </a>
              </>
            ) : (
              <>
                <span className="sm:hidden">Публичное демо · не вводите конфиденциальные данные</span>
                <span className="hidden sm:inline">Публичное демо: данные остаются только в этом браузере. Не загружайте конфиденциальную информацию.</span>
              </>
            )}
          </div>
        )}

        {!demoScenario && (
          <DeviceConnectDialog
            open={deviceDialogOpen}
            onOpenChange={setDeviceDialogOpen}
            canCreateCode={Boolean(identity && state.persistence.mode === 'database')}
            persistenceLabel={state.persistence.label}
            onCreateCode={createDeviceCode}
            onRedeemCode={redeemDeviceCode}
          />
        )}

        {actionError && (
          <div className="absolute left-1/2 top-16 z-40 hidden w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2 rounded-xl border border-error/20 bg-surface-container-lowest px-3 py-2 text-xs text-error shadow-card md:flex" role="alert">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            {actionError}
          </div>
        )}

        <main className="relative min-h-0 flex-1">
          {isDesktop ? (
            focusConversation ? (
              <>
                <DiscoveryBackdrop state={state} />
                <div className="absolute inset-0 z-40 flex items-center justify-center px-4 py-5">
                  <ChatDock {...sharedChatProps} mode="desktop" />
                </div>
              </>
            ) : (
              <>
                <JourneyCanvas
                  state={state}
                  onWidgetToggle={toggleWidget}
                  onWidgetFocus={focusWidget}
                  onWidgetHide={hideWidget}
                  onWidgetRestore={restoreWidget}
                  onWidgetMove={moveWidget}
                  onWidgetResetLayout={resetWidgetLayout}
                  onWidgetDiscuss={discussWidget}
                  onSuggestionAccept={acceptSuggestion}
                  onSuggestionReject={(id) => updateSuggestion(id, 'rejected')}
                  onSuggestionHide={(id) => updateSuggestion(id, 'hidden')}
                />
                <div className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2">
                  <ChatDock {...sharedChatProps} mode="desktop" />
                </div>
              </>
            )
          ) : (
            <div className="size-full">
              {mobileView === 'board' && <JourneyMobileBoard state={state} />}
              {mobileView === 'chat' && <ChatDock {...sharedChatProps} mode="mobile" />}
              {mobileView === 'modules' && (
                <ModulesPanel
                  widgets={state.widgets}
                  widgetOrder={state.widgetOrder}
                  widgetDecisions={(state as JourneyWorkspaceView & { widgetDecisions?: unknown }).widgetDecisions}
                  onToggle={toggleWidget}
                  onFocus={focusWidget}
                  onHide={hideWidget}
                  onRestore={restoreWidget}
                  onDiscuss={discussWidget}
                  onReorder={reorderWidget}
                />
              )}
            </div>
          )}
        </main>

        {!isDesktop && <MobileNavigation value={mobileView} onChange={setMobileView} widgetCount={state.widgets.filter((widget) => !widget.hidden).length} />}
      </div>
    </Tooltip.Provider>
  )
}

function DiscoveryBackdrop({ state }: { state: JourneyWorkspaceView }) {
  const confirmedFacts = state.facts.filter((fact) => fact.status === 'confirmed').length
  const currentGoal = getCurrentConfirmedJourneyGoal(state)
  const measurableGoal = currentGoal?.metric && currentGoal.target && currentGoal.deadline
    ? currentGoal
    : null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0 opacity-45"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.11) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="absolute inset-x-[8%] top-[9%] flex items-center justify-between gap-10 opacity-35 blur-[0.25px]">
        <DiscoveryNode
          eyebrow="Точка A"
          title={confirmedFacts ? `${confirmedFacts} подтверждённых фактов` : 'Текущий бизнес'}
        />
        <div className="h-px min-w-24 flex-1 bg-gradient-to-r from-primary/15 via-primary/70 to-primary/15" />
        <DiscoveryNode eyebrow="Путь" title={state.roadmap.length ? `${state.roadmap.length} этапа` : 'Приоритеты и действия'} />
        <div className="h-px min-w-24 flex-1 bg-gradient-to-r from-primary/15 via-primary/70 to-primary/15" />
        <DiscoveryNode eyebrow="Точка B" title={measurableGoal?.target ?? 'Измеримая цель'} accent />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(11,14,17,0.05)_0%,rgba(11,14,17,0.5)_72%)]" />
    </div>
  )
}

function DiscoveryNode({
  eyebrow,
  title,
  accent = false,
}: {
  eyebrow: string
  title: string
  accent?: boolean
}) {
  return (
    <div className={cn(
      'w-52 rounded-2xl border bg-surface-container-lowest/90 px-4 py-3 shadow-card',
      accent ? 'border-primary/40' : 'border-white/10',
    )}>
      <p className="text-[10px] text-on-surface-variant">{eyebrow}</p>
      <p className="mt-1 truncate text-sm font-semibold text-on-surface">{title}</p>
    </div>
  )
}

function WorkspaceHeader({
  state,
  onDeviceConnect,
}: {
  state: JourneyWorkspaceView
  onDeviceConnect?: () => void
}) {
  const persisted = state.persistence.mode === 'database'
  return (
    <header className="relative z-30 flex min-h-14 shrink-0 items-center gap-3 border-b border-white/5 bg-surface-container-lowest px-3 pt-[env(safe-area-inset-top)] sm:px-5">
      <Link href="/" aria-label="AIStart360" className="flex min-w-0 items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
          <Sparkles className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-on-surface">AIStart<span className="text-primary">360</span></p>
          <p className="hidden text-[10px] text-on-surface-variant sm:block">AI-first workspace · эксперимент</p>
        </div>
      </Link>

      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
        <StatusBadge
          icon={state.provider.mode === 'live' ? Bot : Sparkles}
          label={
            state.provider.mode === 'live'
              ? 'AI подключён'
              : state.provider.mode === 'demo'
                ? 'Демо-режим · локальная логика'
                : 'AI недоступен'
          }
          shortLabel={
            state.provider.mode === 'live'
              ? 'AI подключён'
              : state.provider.mode === 'demo'
                ? 'Демо-режим'
                : 'AI недоступен'
          }
          tone={state.provider.mode === 'live' ? 'ok' : state.provider.mode === 'demo' ? 'warn' : 'error'}
        />
        <StatusBadge
          icon={persisted ? Database : HardDrive}
          label={state.persistence.label}
          tone={persisted ? 'ok' : 'neutral'}
          className="hidden sm:flex"
        />
        {onDeviceConnect && (
          <button
            type="button"
            onClick={onDeviceConnect}
            aria-label="Подключить другое устройство"
            className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-on-surface-variant hover:bg-white/5 hover:text-primary sm:px-2.5"
          >
            <Smartphone className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">Устройства</span>
          </button>
        )}
        <Link
          href="/client/welcome"
          prefetch={false}
          className="ml-0.5 hidden rounded-lg px-2.5 py-2 text-xs text-on-surface-variant hover:bg-white/5 hover:text-on-surface sm:block"
        >
          В кабинет
        </Link>
      </div>
    </header>
  )
}

function StatusBadge({
  icon: Icon,
  label,
  shortLabel,
  tone,
  className,
}: {
  icon: typeof Bot
  label: string
  shortLabel?: string
  tone: 'ok' | 'warn' | 'error' | 'neutral'
  className?: string
}) {
  return (
    <span title={label} className={cn(
      'flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px]',
      tone === 'ok' && 'bg-primary/10 text-primary',
      tone === 'warn' && 'bg-tertiary-container/10 text-tertiary-container',
      tone === 'error' && 'bg-error/10 text-error',
      tone === 'neutral' && 'bg-white/5 text-on-surface-variant',
      className,
    )}>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="sm:hidden">{shortLabel ?? label}</span>
      <span className="hidden max-w-64 truncate sm:inline">{label}</span>
    </span>
  )
}

function MobileNavigation({
  value,
  onChange,
  widgetCount,
}: {
  value: MobileView
  onChange: (value: MobileView) => void
  widgetCount: number
}) {
  const items: Array<{
    id: MobileView
    label: string
    ariaLabel?: string
    icon: typeof MapIcon
  }> = [
    { id: 'board' as const, label: 'Путь', icon: MapIcon },
    { id: 'chat' as const, label: 'Спросить AI', ariaLabel: 'Диалог · спросить AI', icon: MessageCircle },
    { id: 'modules' as const, label: 'Модули', icon: Layers3 },
  ]
  return (
    <nav role="tablist" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-surface-container-lowest px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden" aria-label="Разделы AI workspace">
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => {
          const Icon = item.icon
          const selected = value === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-label={item.ariaLabel ?? item.label}
              aria-selected={selected}
              onClick={() => onChange(item.id)}
              className={cn(
                'flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[11px]',
                selected ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface',
              )}
            >
              <span className="relative">
                <Icon className="size-4" aria-hidden />
                {item.id === 'modules' && widgetCount > 0 && (
                  <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-on-primary tabular-nums">
                    {Math.min(widgetCount, 9)}
                  </span>
                )}
              </span>
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function WorkspaceSkeleton() {
  return (
    <div className="flex h-dvh min-h-[520px] flex-col bg-background" aria-label="Загрузка AI workspace">
      <div className="flex min-h-14 items-center gap-3 border-b border-white/5 px-4">
        <div className="skeleton size-8 rounded-xl" />
        <div className="skeleton h-3 w-32 rounded" />
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute left-[7%] top-[25%] h-64 w-[25%] rounded-3xl border border-white/5 bg-surface-container-lowest p-5">
          <div className="skeleton h-4 w-28 rounded" />
          <div className="skeleton mt-6 h-2 w-full rounded" />
          <div className="skeleton mt-3 h-2 w-4/5 rounded" />
        </div>
        <div className="absolute left-[39%] top-[22%] h-72 w-[32%] rounded-3xl border border-white/5 bg-surface-container-lowest p-5">
          <div className="skeleton h-4 w-40 rounded" />
          <div className="skeleton mt-6 h-12 w-full rounded-xl" />
        </div>
        <div className="absolute right-[5%] top-[25%] h-64 w-[22%] rounded-3xl border border-white/5 bg-surface-container-lowest p-5">
          <div className="skeleton h-4 w-24 rounded" />
        </div>
        <div className="absolute bottom-5 left-1/2 flex w-[min(760px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-surface-container-lowest p-4">
          <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />
          <span className="text-xs text-on-surface-variant">Подключаем рабочее пространство…</span>
        </div>
      </div>
    </div>
  )
}

function readStoredIdentity(storageKey = LOCAL_IDENTITY_KEY): JourneyIdentity | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const workspaceId = (parsed as { workspaceId?: unknown }).workspaceId
    const accessToken = (parsed as { accessToken?: unknown }).accessToken
    if (typeof workspaceId !== 'string' || !workspaceId.trim() || workspaceId.length > 200) return null
    if (accessToken !== undefined && (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 500)) return null
    return {
      workspaceId: workspaceId.trim(),
      ...(typeof accessToken === 'string' ? { accessToken: accessToken.trim() } : {}),
    }
  } catch {
    return null
  }
}

function writeStoredIdentity(identity: JourneyIdentity, storageKey = LOCAL_IDENTITY_KEY): void {
  window.localStorage.setItem(storageKey, JSON.stringify({
    workspaceId: identity.workspaceId,
    ...(identity.accessToken ? { accessToken: identity.accessToken } : {}),
  }))
}

function useDesktopViewport(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : false,
  )

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return desktop
}

function readStoredState(workspaceId: string): JourneyWorkspaceView | null {
  try {
    const scoped = window.localStorage.getItem(journeyStateStorageKey(workspaceId))
    const legacy = window.localStorage.getItem(LOCAL_STATE_KEY)
    const parsed: unknown = JSON.parse(scoped ?? legacy ?? 'null')
    if (!isJourneyWorkspaceView(parsed) || parsed.workspaceId !== workspaceId) return null
    if (!scoped) window.localStorage.setItem(journeyStateStorageKey(workspaceId), JSON.stringify(parsed))
    return parsed
  } catch {
    return null
  }
}

function writeStoredState(state: JourneyWorkspaceView): void {
  window.localStorage.setItem(journeyStateStorageKey(state.workspaceId), JSON.stringify(state))
  // Remove the old global state only after the scoped copy has been written.
  window.localStorage.removeItem(LOCAL_STATE_KEY)
}

function clearJourneyCache(workspaceId: string, identityStorageKey = LOCAL_IDENTITY_KEY): void {
  window.localStorage.removeItem(identityStorageKey)
  clearJourneyStateCache(workspaceId)
}

function clearJourneyStateCache(workspaceId: string): void {
  window.localStorage.removeItem(journeyStateStorageKey(workspaceId))
  window.localStorage.removeItem(LOCAL_STATE_KEY)
}

function createFailClosedWorkspace(workspaceId: string, reason: string): JourneyWorkspaceView {
  const now = new Date().toISOString()
  return {
    ...createEmptyWorkspace(workspaceId),
    phase: 'error',
    messages: [
      {
        id: makeId('message'),
        role: 'system',
        text: `${reason} Обновите страницу позже или войдите повторно.`,
        createdAt: now,
      },
    ],
    suggestions: [],
    provider: { mode: 'unavailable', label: 'Доступ не подтверждён' },
    persistence: {
      mode: 'unavailable',
      label: 'Данные скрыты',
      reason,
    },
    updatedAt: now,
  }
}

function isAuthorizationError(error: unknown): boolean {
  return error instanceof JourneyRequestError && (error.status === 401 || error.status === 403)
}

function isConflictError(error: unknown): boolean {
  return error instanceof JourneyRequestError && error.status === 409
}

function patchWidget(
  widget: JourneyWidgetView,
  patch: Partial<Pick<JourneyWidgetView, 'collapsed' | 'hidden' | 'focused' | 'position'>>,
): JourneyWidgetView {
  return journeyWidgetSchema.parse({ ...widget, ...patch })
}

function limitExpandedWidgets(state: JourneyWorkspaceView): JourneyWorkspaceView {
  return { ...state, widgets: limitExpandedWidgetList(state.widgets) }
}

function limitExpandedWidgetList(
  widgets: JourneyWorkspaceView['widgets'],
  preferredId?: string,
): JourneyWorkspaceView['widgets'] {
  const expanded = widgets
    .filter((widget) => !widget.hidden && !widget.collapsed)
    .sort((a, b) => {
      if (a.id === preferredId) return -1
      if (b.id === preferredId) return 1
      return b.priority - a.priority
    })
  if (expanded.length <= 4) return widgets
  const keep = new Set(expanded.slice(0, 4).map((widget) => widget.id))
  return widgets.map((widget) =>
    !widget.hidden && !widget.collapsed && !keep.has(widget.id)
      ? patchWidget(widget, { collapsed: true })
      : widget,
  )
}

function resolveWidgetCollisions(
  state: JourneyWorkspaceView,
): JourneyWorkspaceView {
  const manualIds = new Set(state.manualWidgetIds ?? [])
  const expandedSlots = [
    { x: 100, y: 650 },
    { x: 470, y: 650 },
    { x: 840, y: 650 },
    { x: 1210, y: 650 },
    { x: 100, y: 900 },
    { x: 470, y: 900 },
    { x: 840, y: 900 },
    { x: 1210, y: 900 },
  ]
  // Collapsed modules stay as small, directly operable headers above the
  // expanded row. They also remain available in WidgetDock.
  const visible = state.widgets
    .filter((widget) => !widget.hidden)
    .sort((a, b) => {
      if (manualIds.has(a.id) !== manualIds.has(b.id)) return manualIds.has(a.id) ? -1 : 1
      if (a.collapsed !== b.collapsed) return a.collapsed ? 1 : -1
      return b.priority - a.priority
    })
  const positions = new Map<string, { x: number; y: number }>()
  const occupied = visible
    .filter((widget) => !widget.collapsed && manualIds.has(widget.id))
    .map((widget) => widget.position)

  for (const widget of visible) {
    if (widget.collapsed || manualIds.has(widget.id)) {
      positions.set(widget.id, widget.position)
      continue
    }
    const slot = expandedSlots.find((candidate) => !occupied.some((position) => (
      Math.abs(candidate.x - position.x) < 340 && Math.abs(candidate.y - position.y) < 300
    )))
    const position = slot ?? widget.position
    positions.set(widget.id, position)
    occupied.push(position)
  }

  if (![...positions].some(([id, position]) => {
    const current = state.widgets.find((widget) => widget.id === id)?.position
    return current && (current.x !== position.x || current.y !== position.y)
  })) return state

  return {
    ...state,
    widgets: state.widgets.map((widget) => {
      const position = positions.get(widget.id)
      return position ? patchWidget(widget, { position }) : widget
    }),
  }
}
