import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatDock } from '@/components/journey/ChatDock'
import { createEmptyWorkspace, type JourneyWorkspaceView } from '@/components/journey/model'
import {
  resolveOpenJourneyBoardView,
  shouldFocusJourneyConversation,
} from '@/components/journey/Workspace'

function goalState(): JourneyWorkspaceView {
  return {
    ...createEmptyWorkspace('journey-store-board-preview'),
    phase: 'partial',
    facts: [{
      id: 'fact:store:company',
      label: 'Компания',
      value: 'Интернет-магазин HONOR / MyHonor',
      category: 'business',
      sourceLabel: 'Store Control Center',
      status: 'confirmed',
    }],
  }
}

const noop = () => undefined

function renderDock({
  context = 'store',
  mode = 'desktop',
  boardPreview = false,
}: {
  context?: 'default' | 'store'
  mode?: 'desktop' | 'mobile'
  boardPreview?: boolean
} = {}): string {
  return renderToStaticMarkup(createElement(ChatDock, {
    state: goalState(),
    busy: false,
    expanded: false,
    mode,
    statusMessage: 'Готово',
    onExpandedChange: noop,
    onSend: noop,
    onFiles: noop,
    onFactConfirm: noop,
    onFactsConfirmAll: noop,
    onFactEdit: noop,
    onFactReject: noop,
    onFactRestore: noop,
    onSuggestionAccept: noop,
    onSuggestionReject: noop,
    onSuggestionHide: noop,
    onOpenBoard: noop,
    boardPreview,
    onReturnToConversation: noop,
    context,
  }))
}

describe('Store Journey pre-Point-B board preview', () => {
  it('keeps conversation first by default and exposes the board action only in Store goal stage', () => {
    const storeHtml = renderDock()
    const defaultHtml = renderDock({ context: 'default' })

    expect(storeHtml).toContain('data-conversation-first="true"')
    expect(storeHtml).toContain('aria-label="История сообщений"')
    expect(storeHtml).toContain('Открыть доску')
    expect(defaultHtml).toContain('aria-label="История сообщений"')
    expect(defaultHtml).not.toContain('Открыть доску')
  })

  it('lets an explicit Store goal action switch focus to the canvas', () => {
    expect(resolveOpenJourneyBoardView({
      context: 'store',
      experienceStage: 'goal',
    })).toEqual({
      chatExpanded: false,
      mobileView: 'board',
      storeBoardPreviewOpen: true,
    })
    expect(shouldFocusJourneyConversation({
      context: 'store',
      conversationFirst: true,
      experienceStage: 'goal',
      phase: 'partial',
      storeBoardPreviewOpen: false,
    })).toBe(true)
    expect(shouldFocusJourneyConversation({
      context: 'store',
      conversationFirst: true,
      experienceStage: 'goal',
      phase: 'partial',
      storeBoardPreviewOpen: true,
    })).toBe(false)

    const boardHtml = renderDock({ boardPreview: true })
    expect(boardHtml).toContain('data-board-preview="true"')
    expect(boardHtml).not.toContain('aria-label="История сообщений"')
    expect(boardHtml).toContain('aria-label="Вернуться к диалогу"')
    expect(boardHtml).toContain('К диалогу')
  })

  it('does not unlock a pre-ready board in ordinary Journey or outside the goal stage', () => {
    expect(resolveOpenJourneyBoardView({
      context: 'default',
      experienceStage: 'goal',
    }).storeBoardPreviewOpen).toBe(false)
    expect(resolveOpenJourneyBoardView({
      context: 'store',
      experienceStage: 'confirm',
    }).storeBoardPreviewOpen).toBe(false)
    expect(shouldFocusJourneyConversation({
      context: 'default',
      conversationFirst: true,
      experienceStage: 'goal',
      phase: 'partial',
      storeBoardPreviewOpen: true,
    })).toBe(true)
    expect(shouldFocusJourneyConversation({
      context: 'store',
      conversationFirst: true,
      experienceStage: 'confirm',
      phase: 'partial',
      storeBoardPreviewOpen: true,
    })).toBe(true)
    expect(shouldFocusJourneyConversation({
      context: 'store',
      conversationFirst: false,
      experienceStage: 'ready',
      phase: 'error',
      storeBoardPreviewOpen: true,
    })).toBe(true)
  })

  it('keeps mobile chat history visible even when the desktop preview flag is set', () => {
    const mobileHtml = renderDock({ mode: 'mobile', boardPreview: true })

    expect(mobileHtml).toContain('data-board-preview="false"')
    expect(mobileHtml).toContain('aria-label="История сообщений"')
    expect(mobileHtml).not.toContain('aria-label="Вернуться к диалогу"')
  })
})
