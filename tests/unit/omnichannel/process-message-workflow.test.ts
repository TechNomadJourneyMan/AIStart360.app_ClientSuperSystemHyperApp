import { beforeEach, describe, expect, it, vi } from 'vitest'

const workflowRuntime = vi.hoisted(() => ({
  getWorkflowMetadata: vi.fn(),
  sleep: vi.fn(),
}))

const repository = vi.hoisted(() => ({
  getMessageContext: vi.fn(),
}))

const processor = vi.hoisted(() => ({
  process: vi.fn(),
}))

vi.mock('workflow', () => ({
  getWorkflowMetadata: workflowRuntime.getWorkflowMetadata,
  sleep: workflowRuntime.sleep,
}))

vi.mock('@/lib/omnichannel/repository', () => ({
  getMessageContext: repository.getMessageContext,
}))

vi.mock('@/lib/functions/process-omnichannel-message', () => ({
  processOmnichannelMessageDirect: processor.process,
}))

import { processOmnichannelMessageWorkflow } from '@/workflows/process-omnichannel-message'

function messageContext(input: {
  replyDelaySeconds?: number
  status?: string
  metadata?: Record<string, unknown>
} = {}) {
  return {
    message: {
      status: input.status ?? 'received',
      metadata: input.metadata ?? {},
    },
    settings: {
      replyDelaySeconds: input.replyDelaySeconds ?? 0,
    },
  }
}

const baseData = {
  message_id: 'message-1',
  conversation_id: 'conversation-1',
  force_draft: false,
}

describe('processOmnichannelMessageWorkflow', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
    workflowRuntime.sleep.mockResolvedValue(undefined)
    workflowRuntime.getWorkflowMetadata.mockReturnValue({
      workflowRunId: 'wrun-message-1',
    })
    repository.getMessageContext.mockResolvedValue(messageContext())
    processor.process.mockResolvedValue({ action: 'draft' })
  })

  it('runs the shared processor with the durable delay marked as applied', async () => {
    await expect(processOmnichannelMessageWorkflow(baseData)).resolves.toEqual({
      action: 'draft',
    })

    expect(repository.getMessageContext).toHaveBeenCalledWith('message-1')
    expect(workflowRuntime.sleep).not.toHaveBeenCalled()
    expect(processor.process).toHaveBeenCalledOnce()
    expect(processor.process).toHaveBeenCalledWith({
      ...baseData,
      delay_already_applied: true,
      processing_owner: 'workflow:wrun-message-1',
    })
  })

  it('uses durable sleep until the ingestion-anchored quiet-window deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-15T10:00:20.000Z')
    repository.getMessageContext.mockResolvedValue(messageContext({
      replyDelaySeconds: 20,
      metadata: { ingestedAt: '2026-07-15T10:00:05.000Z' },
    }))

    await processOmnichannelMessageWorkflow(baseData)

    expect(workflowRuntime.sleep).toHaveBeenCalledOnce()
    expect(workflowRuntime.sleep).toHaveBeenCalledWith(
      new Date('2026-07-15T10:00:25.000Z'),
    )
    expect(processor.process).toHaveBeenCalledWith(expect.objectContaining({
      delay_already_applied: true,
    }))
  })

  it('does not sleep again when the ingestion-anchored deadline has elapsed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-15T10:00:30.000Z')
    repository.getMessageContext.mockResolvedValue(messageContext({
      replyDelaySeconds: 20,
      metadata: { ingestedAt: '2026-07-15T10:00:05.000Z' },
    }))

    await processOmnichannelMessageWorkflow(baseData)

    expect(workflowRuntime.sleep).not.toHaveBeenCalled()
    expect(processor.process).toHaveBeenCalledWith(expect.objectContaining({
      delay_already_applied: true,
    }))
  })

  it('bounds the durable quiet window to one day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-15T10:00:00.000Z')
    repository.getMessageContext.mockResolvedValue(messageContext({
      replyDelaySeconds: 999_999,
      metadata: { ingestedAt: '2026-07-15T10:00:00.000Z' },
    }))

    await processOmnichannelMessageWorkflow(baseData)

    expect(workflowRuntime.sleep).toHaveBeenCalledWith(
      new Date('2026-07-16T10:00:00.000Z'),
    )
  })

  it('anchors a missing or invalid ingestion timestamp to the persisted delay step time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-15T10:00:00.000Z')
    repository.getMessageContext.mockResolvedValue(messageContext({
      replyDelaySeconds: 15,
      metadata: { ingestedAt: 'not-a-date' },
    }))

    await processOmnichannelMessageWorkflow(baseData)

    expect(workflowRuntime.sleep).toHaveBeenCalledWith(
      new Date('2026-07-15T10:00:15.000Z'),
    )
  })

  it('skips the delay lookup for forced drafts and already-delayed queue events', async () => {
    await processOmnichannelMessageWorkflow({
      ...baseData,
      force_draft: true,
    })
    await processOmnichannelMessageWorkflow({
      ...baseData,
      delay_already_applied: true,
    })

    expect(repository.getMessageContext).not.toHaveBeenCalled()
    expect(workflowRuntime.sleep).not.toHaveBeenCalled()
    expect(processor.process).toHaveBeenCalledTimes(2)
  })

  it('defensively skips the quiet window for imported history', async () => {
    repository.getMessageContext.mockResolvedValue(messageContext({
      status: 'imported',
      replyDelaySeconds: 30,
      metadata: { ingestedAt: '2026-07-15T10:00:00.000Z' },
    }))

    await processOmnichannelMessageWorkflow(baseData)

    expect(workflowRuntime.sleep).not.toHaveBeenCalled()
    expect(processor.process).toHaveBeenCalledWith(expect.objectContaining({
      force_draft: false,
      delay_already_applied: true,
    }))
  })
})
