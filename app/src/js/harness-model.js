const TERMINAL_STATES = new Set(['completed', 'failed', 'canceled', 'rejected'])

function jsonHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey
  }
}

async function parseResponse(response) {
  const payload = await response.json()
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.message || `Harness request failed (${response.status}).`)
    error.code = payload.code || 'harness.request_failed'
    error.details = payload.details || null
    error.status = response.status
    throw error
  }
  return payload
}

export function createHarnessClient(fetchImpl = window.fetch.bind(window), baseUrl = '') {
  return {
    async getCard({ deviceId, apiKey }) {
      const query = new URLSearchParams({ device_id: deviceId })
      const response = await fetchImpl(`${baseUrl}/api/v1/harness/card?${query}`, {
        method: 'GET',
        headers: { 'X-API-Key': apiKey },
        cache: 'no-store'
      })
      return parseResponse(response)
    },

    async startTask({ deviceId, apiKey, contextId, idempotencyKey, capabilityId, input }) {
      const response = await fetchImpl(`${baseUrl}/api/v1/harness/tasks`, {
        method: 'POST',
        headers: jsonHeaders(apiKey),
        cache: 'no-store',
        body: JSON.stringify({
          device_id: deviceId,
          context_id: contextId,
          idempotency_key: idempotencyKey,
          capability_id: capabilityId,
          input,
          metadata: { surface: 'owner-web-harness' }
        })
      })
      return parseResponse(response)
    },

    async readTask({ deviceId, apiKey, taskId, afterSequence = 0 }) {
      const query = new URLSearchParams({
        device_id: deviceId,
        after_sequence: String(afterSequence)
      })
      const response = await fetchImpl(
        `${baseUrl}/api/v1/harness/tasks/${encodeURIComponent(taskId)}?${query}`,
        {
          method: 'GET',
          headers: { 'X-API-Key': apiKey },
          cache: 'no-store'
        }
      )
      return parseResponse(response)
    },

    async cancelTask({ deviceId, apiKey, taskId, reason }) {
      const response = await fetchImpl(
        `${baseUrl}/api/v1/harness/tasks/${encodeURIComponent(taskId)}/cancel`,
        {
          method: 'POST',
          headers: jsonHeaders(apiKey),
          cache: 'no-store',
          body: JSON.stringify({ device_id: deviceId, reason })
        }
      )
      return parseResponse(response)
    },

    async decideTask({ deviceId, apiKey, taskId, approvalId, decision }) {
      const response = await fetchImpl(
        `${baseUrl}/api/v1/harness/tasks/${encodeURIComponent(taskId)}/decision`,
        {
          method: 'POST',
          headers: jsonHeaders(apiKey),
          cache: 'no-store',
          body: JSON.stringify({
            device_id: deviceId,
            approval_id: approvalId,
            decision
          })
        }
      )
      return parseResponse(response)
    }
  }
}

export function createHarnessViewState() {
  return {
    card: null,
    task: null,
    events: [],
    latestSequence: 0,
    connected: false,
    busy: false,
    error: null
  }
}

export function mergeTaskView(state, payload) {
  const eventsById = new Map(state.events.map((event) => [event.event_id, event]))
  for (const event of payload.events || []) {
    eventsById.set(event.event_id, event)
  }
  return {
    ...state,
    task: payload.task || state.task,
    events: [...eventsById.values()].sort((left, right) => left.sequence - right.sequence),
    latestSequence: Math.max(state.latestSequence, payload.latest_sequence || 0),
    error: payload.task?.error || null
  }
}

export function isTerminalTask(task) {
  return Boolean(task && TERMINAL_STATES.has(task.state))
}

export function canCancelTask(task, card) {
  if (!task || isTerminalTask(task)) return false
  const capability = card?.capabilities?.find(
    (item) => item.capability_id === task.active_capability_id
  )
  return Boolean(capability?.supports_cancellation)
}

export function taskNeedsApproval(task) {
  return task?.state === 'approval_required' && Boolean(task.approval)
}

export function taskStateLabel(task) {
  const labels = {
    queued: 'Queued',
    working: 'Working',
    input_required: 'Input required',
    approval_required: 'Approval required',
    completed: 'Completed',
    failed: 'Failed',
    canceled: 'Canceled',
    rejected: 'Rejected'
  }
  return task ? labels[task.state] || task.state : 'No active task'
}

export function taskStateTone(task) {
  if (!task) return 'neutral'
  if (task.state === 'completed') return 'success'
  if (task.state === 'failed' || task.state === 'rejected') return 'danger'
  if (task.state === 'approval_required' || task.state === 'input_required') {
    return 'attention'
  }
  if (task.state === 'canceled') return 'neutral'
  return 'active'
}

export function assistantText(task) {
  if (!task) return ''
  const message = [...task.messages].reverse().find((item) => item.role === 'assistant')
  return (
    message?.parts
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .join('\n') || ''
  )
}

export function artifactTitle(artifact) {
  return `${artifact.name} · ${artifact.kind} · ${artifact.media_type}`
}

export function eventTitle(event) {
  return `${event.sequence}. ${event.type}`
}
