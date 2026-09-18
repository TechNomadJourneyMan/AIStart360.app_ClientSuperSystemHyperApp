import { describe, expect, it } from 'vitest'
import { reconcileAutosaveResult } from '@/components/journey/autosave'
import {
  startSerializedAutosaveQueue,
  waitForSerializedAutosaveIdle,
} from '@/components/journey/Workspace'

describe('Journey UI autosave reconciliation', () => {
  it('keeps an edit made during an in-flight save and rebases its CAS revision', () => {
    const sent = { serverRevision: 4, title: 'До правки', position: 10 }
    const editedWhileSaving = { serverRevision: 4, title: 'Новая правка', position: 42 }
    const firstServerResponse = { serverRevision: 5, title: 'До правки', position: 10 }

    const rebased = reconcileAutosaveResult(sent, editedWhileSaving, firstServerResponse)

    expect(rebased).toEqual({
      state: { serverRevision: 5, title: 'Новая правка', position: 42 },
      needsSave: true,
    })

    const secondServerResponse = { ...rebased.state, serverRevision: 6 }
    expect(reconcileAutosaveResult(rebased.state, rebased.state, secondServerResponse)).toEqual({
      state: secondServerResponse,
      needsSave: false,
    })
  })

  it('accepts the server state when no newer local edit exists', () => {
    const sent = { serverRevision: 2, collapsed: false }
    const saved = { serverRevision: 3, collapsed: false }

    expect(reconcileAutosaveResult(sent, sent, saved)).toEqual({
      state: saved,
      needsSave: false,
    })
  })

  it('restarts after settlement when a pending edit arrived behind the active worker', async () => {
    const releases: Array<() => void> = []
    let pending = true
    let current: Promise<void> | null = null
    let drainCount = 0
    let activeWorkers = 0
    let maxActiveWorkers = 0

    const controller = {
      getCurrent: () => current,
      setCurrent: (promise: Promise<void> | null) => {
        current = promise
      },
      hasPending: () => pending,
      drain: () => {
        pending = false
        drainCount += 1
        activeWorkers += 1
        maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers)
        return new Promise<void>((resolve) => {
          releases.push(() => {
            activeWorkers -= 1
            resolve()
          })
        })
      },
    }

    const firstRun = startSerializedAutosaveQueue(controller)
    expect(drainCount).toBe(1)

    // This mirrors the settlement race: enqueue sees the still-present run,
    // so it cannot launch a second worker itself.
    pending = true
    expect(startSerializedAutosaveQueue(controller)).toBe(firstRun)
    expect(drainCount).toBe(1)

    releases[0]()
    await firstRun
    await Promise.resolve()

    expect(drainCount).toBe(2)
    expect(maxActiveWorkers).toBe(1)
    expect(current).not.toBe(firstRun)

    const secondRun = current
    releases[1]()
    await secondRun
    await Promise.resolve()

    expect(current).toBeNull()
    expect(activeWorkers).toBe(0)
  })

  it('waits through an autosave worker handoff before reporting the queue idle', async () => {
    const releases: Array<() => void> = []
    let pending = true
    let current: Promise<void> | null = null
    let drainCount = 0

    const controller = {
      getCurrent: () => current,
      setCurrent: (promise: Promise<void> | null) => {
        current = promise
      },
      hasPending: () => pending,
      drain: () => {
        pending = false
        drainCount += 1
        return new Promise<void>((resolve) => releases.push(resolve))
      },
    }

    startSerializedAutosaveQueue(controller)
    pending = true

    let idleReached = false
    const idle = waitForSerializedAutosaveIdle(controller.getCurrent).then(() => {
      idleReached = true
    })

    releases[0]()
    await Promise.resolve()
    await Promise.resolve()
    expect(drainCount).toBe(2)
    expect(idleReached).toBe(false)

    releases[1]()
    await idle
    expect(current).toBeNull()
    expect(idleReached).toBe(true)
  })
})
