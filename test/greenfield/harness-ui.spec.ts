import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  assistantText,
  canCancelTask,
  createHarnessClient,
  createHarnessViewState,
  isTerminalTask,
  mergeTaskView,
  taskNeedsApproval,
  taskStateLabel
} from '../../app/src/js/harness-model.js'

const root = process.cwd()
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), 'utf8')

function task(overrides: Record<string, unknown> = {}) {
  return {
    task_id: 'task-1',
    context_id: 'context-1',
    owner_id: 'owner-1',
    device_id: 'device-1',
    auth_session_id: 'session-1',
    idempotency_key: 'key-1',
    capability_id: 'system.status.read',
    active_capability_id: 'system.status.read',
    state: 'working',
    input_hash: 'hash',
    messages: [],
    artifacts: [],
    approval: null,
    error: null,
    trace_id: 'trace-1',
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:01.000Z',
    completed_at: null,
    step_count: 1,
    max_steps: 12,
    ...overrides
  }
}

describe('harness owner shell model', () => {
  it('merges incremental events without duplicating prior events', () => {
    const initial = mergeTaskView(createHarnessViewState(), {
      task: task(),
      latest_sequence: 1,
      events: [
        {
          event_id: 'event-1',
          sequence: 1,
          type: 'task.created'
        }
      ]
    })
    const updated = mergeTaskView(initial, {
      task: task({ state: 'completed' }),
      latest_sequence: 2,
      events: [
        {
          event_id: 'event-1',
          sequence: 1,
          type: 'task.created'
        },
        {
          event_id: 'event-2',
          sequence: 2,
          type: 'task.completed'
        }
      ]
    })

    expect(updated.events.map((event) => event.event_id)).toEqual([
      'event-1',
      'event-2'
    ])
    expect(updated.latestSequence).toBe(2)
    expect(isTerminalTask(updated.task)).toBe(true)
  })

  it('derives approval, cancellation, and owner response presentation', () => {
    const card = {
      capabilities: [
        {
          capability_id: 'system.status.read',
          supports_cancellation: true
        }
      ]
    }
    const approvalTask = task({
      state: 'approval_required',
      approval: { approval_id: 'approval-1' }
    })
    expect(taskNeedsApproval(approvalTask)).toBe(true)
    expect(taskStateLabel(approvalTask)).toBe('Approval required')
    expect(canCancelTask(approvalTask, card)).toBe(true)

    const completed = task({
      state: 'completed',
      messages: [
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'Grounded answer' }]
        }
      ]
    })
    expect(assistantText(completed)).toBe('Grounded answer')
    expect(canCancelTask(completed, card)).toBe(false)
  })

  it('sends credentials only in request headers and never in task JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ success: true, task: task(), events: [] })
    })
    const client = createHarnessClient(fetchImpl, '')
    await client.startTask({
      deviceId: 'device-1',
      apiKey: 'owner-secret',
      contextId: 'context-1',
      idempotencyKey: 'key-1',
      capabilityId: 'system.status.read',
      input: 'status'
    })

    const request = fetchImpl.mock.calls[0]?.[1]
    expect(request.headers['X-API-Key']).toBe('owner-secret')
    expect(request.body).not.toContain('owner-secret')
  })

  it('keeps credentials memory-only and inserts server data through textContent', () => {
    const panel = read('app/src/js/harness-panel.js')

    expect(panel).not.toContain('localStorage')
    expect(panel).not.toContain('sessionStorage')
    expect(panel).not.toContain('document.cookie')
    expect(panel).toContain("apiKeyInput.value = ''")
    expect(panel).toContain('credentials = null')
    expect(panel).toContain('element.textContent = text')
    expect(panel).not.toContain('artifact.innerHTML')
  })

  it('renders actual event, artifact, approval, trace, and cancellation surfaces', () => {
    const panel = read('app/src/js/harness-panel.js')

    expect(panel).toContain('Append-only event stream')
    expect(panel).toContain('Evidence and outputs')
    expect(panel).toContain('Owner approval required')
    expect(panel).toContain("addFact(taskFacts, 'Trace'")
    expect(panel).toContain('Cancel active task')
    expect(panel).toContain("void decide('approved')")
    expect(panel).toContain("void decide('rejected')")
  })

  it('uses the authenticated lifecycle endpoints with no-store requests', () => {
    const model = read('app/src/js/harness-model.js')

    expect(model).toContain('/api/v1/harness/card')
    expect(model).toContain('/api/v1/harness/tasks')
    expect(model).toContain('/cancel')
    expect(model).toContain('/decision')
    expect(model.match(/cache: 'no-store'/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('mounts the harness alongside the existing Mira shell', () => {
    const main = read('app/src/js/main.js')
    expect(main).toContain("import './harness-panel'")
    expect(main).toContain("import './memory-panel'")
    expect(main).toContain('client.init()')
  })
})
