import '../css/harness.scss'

import {
  artifactTitle,
  assistantText,
  canCancelTask,
  createHarnessClient,
  createHarnessViewState,
  eventTitle,
  isTerminalTask,
  mergeTaskView,
  taskNeedsApproval,
  taskStateLabel,
  taskStateTone
} from './harness-model'

const config = {
  serverHost: import.meta.env.VITE_MIRA_HOST,
  serverPort: import.meta.env.VITE_MIRA_PORT,
  production: import.meta.env.VITE_MIRA_NODE_ENV === 'production'
}
const serverUrl = config.production
  ? ''
  : `${config.serverHost}:${config.serverPort}`

function createElement(tagName, className, text) {
  const element = document.createElement(tagName)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function setHidden(element, hidden) {
  element.hidden = hidden
  element.setAttribute('aria-hidden', hidden ? 'true' : 'false')
}

function stringifyPart(part) {
  if (part.type === 'text') return part.text || ''
  if (part.type === 'reference') return part.ref || ''
  try {
    return JSON.stringify(part.data, null, 2)
  } catch {
    return '[Unserializable artifact data]'
  }
}

function mountHarnessPanel() {
  const topContainer = document.querySelector('#top-container')
  if (!topContainer || document.querySelector('#harness-panel-button')) return

  const launchButton = createElement('button', 'harness-launch', 'Harness')
  launchButton.id = 'harness-panel-button'
  launchButton.type = 'button'
  launchButton.setAttribute('aria-haspopup', 'dialog')
  topContainer.appendChild(launchButton)

  const panel = createElement('section', 'harness-panel')
  panel.id = 'harness-panel'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', 'harness-panel-title')
  panel.setAttribute('aria-hidden', 'true')
  panel.innerHTML = `
    <div class="harness-backdrop" data-action="close"></div>
    <div class="harness-shell">
      <header class="harness-header">
        <div>
          <p class="harness-eyebrow">Owner-controlled AI runtime</p>
          <h2 id="harness-panel-title">Mira harness</h2>
          <p>Discover capabilities, start bounded tasks, observe real lifecycle events, review evidence, approve risk, and cancel work.</p>
        </div>
        <button class="harness-close" type="button" data-action="close" aria-label="Close Mira harness">×</button>
      </header>

      <div class="harness-live-status" role="status" aria-live="polite"></div>

      <section class="harness-card harness-auth" aria-labelledby="harness-auth-title">
        <div>
          <p class="harness-eyebrow">Authenticated owner session</p>
          <h3 id="harness-auth-title">Connect</h3>
        </div>
        <div class="harness-auth-grid">
          <label>
            <span>Paired device ID</span>
            <input name="harness-device-id" type="text" autocomplete="off" spellcheck="false" />
          </label>
          <label>
            <span>API key</span>
            <input name="harness-api-key" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <button type="button" data-action="connect">Load capability card</button>
        </div>
        <p class="harness-help">Credentials remain in memory only, are never placed in URLs or local storage, and are cleared when the harness closes.</p>
      </section>

      <div class="harness-workspace" hidden>
        <section class="harness-card harness-compose" aria-labelledby="harness-compose-title">
          <div class="harness-card-heading">
            <div>
              <p class="harness-eyebrow">Capability-negotiated task</p>
              <h3 id="harness-compose-title">Start task</h3>
            </div>
            <span class="harness-protocol"></span>
          </div>
          <label>
            <span>Capability</span>
            <select name="harness-capability"></select>
          </label>
          <label>
            <span>Owner request</span>
            <textarea name="harness-input" rows="5" maxlength="32768" placeholder="Ask Mira to perform a capability through the harness."></textarea>
          </label>
          <div class="harness-actions">
            <button type="button" data-action="start">Start bounded task</button>
            <button type="button" data-action="cancel" class="secondary" hidden>Cancel active task</button>
          </div>
          <div class="harness-capability-detail"></div>
        </section>

        <section class="harness-card harness-task" aria-labelledby="harness-task-title">
          <div class="harness-card-heading">
            <div>
              <p class="harness-eyebrow">Live task state</p>
              <h3 id="harness-task-title">Execution</h3>
            </div>
            <span class="harness-state" data-tone="neutral">No active task</span>
          </div>
          <dl class="harness-task-facts"></dl>
          <div class="harness-answer" hidden>
            <h4>Owner response</h4>
            <p></p>
          </div>
          <div class="harness-error" hidden>
            <h4>Failure evidence</h4>
            <p></p>
          </div>
        </section>

        <section class="harness-card harness-approval" aria-labelledby="harness-approval-title" hidden>
          <div class="harness-card-heading">
            <div>
              <p class="harness-eyebrow">Deterministic human checkpoint</p>
              <h3 id="harness-approval-title">Owner approval required</h3>
            </div>
            <span class="harness-risk"></span>
          </div>
          <p class="harness-approval-summary"></p>
          <dl class="harness-approval-facts"></dl>
          <div class="harness-actions">
            <button type="button" data-action="approve">Approve exact scope</button>
            <button type="button" data-action="reject" class="danger">Reject task</button>
          </div>
        </section>

        <div class="harness-columns">
          <section class="harness-card" aria-labelledby="harness-events-title">
            <div class="harness-card-heading">
              <div>
                <p class="harness-eyebrow">Append-only event stream</p>
                <h3 id="harness-events-title">Timeline</h3>
              </div>
              <span class="harness-event-count">0 events</span>
            </div>
            <ol class="harness-event-list"></ol>
          </section>

          <section class="harness-card" aria-labelledby="harness-artifacts-title">
            <div class="harness-card-heading">
              <div>
                <p class="harness-eyebrow">Evidence and outputs</p>
                <h3 id="harness-artifacts-title">Artifacts</h3>
              </div>
              <span class="harness-artifact-count">0 artifacts</span>
            </div>
            <div class="harness-artifact-list"></div>
          </section>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(panel)

  const client = createHarnessClient(window.fetch.bind(window), serverUrl)
  const status = panel.querySelector('.harness-live-status')
  const workspace = panel.querySelector('.harness-workspace')
  const deviceInput = panel.querySelector('[name="harness-device-id"]')
  const apiKeyInput = panel.querySelector('[name="harness-api-key"]')
  const capabilitySelect = panel.querySelector('[name="harness-capability"]')
  const taskInput = panel.querySelector('[name="harness-input"]')
  const protocol = panel.querySelector('.harness-protocol')
  const capabilityDetail = panel.querySelector('.harness-capability-detail')
  const stateBadge = panel.querySelector('.harness-state')
  const taskFacts = panel.querySelector('.harness-task-facts')
  const answerSection = panel.querySelector('.harness-answer')
  const answerText = answerSection.querySelector('p')
  const errorSection = panel.querySelector('.harness-error')
  const errorText = errorSection.querySelector('p')
  const approvalSection = panel.querySelector('.harness-approval')
  const approvalRisk = panel.querySelector('.harness-risk')
  const approvalSummary = panel.querySelector('.harness-approval-summary')
  const approvalFacts = panel.querySelector('.harness-approval-facts')
  const eventList = panel.querySelector('.harness-event-list')
  const eventCount = panel.querySelector('.harness-event-count')
  const artifactList = panel.querySelector('.harness-artifact-list')
  const artifactCount = panel.querySelector('.harness-artifact-count')
  const cancelButton = panel.querySelector('[data-action="cancel"]')
  const startButton = panel.querySelector('[data-action="start"]')

  let viewState = createHarnessViewState()
  let credentials = null
  let pollGeneration = 0
  let previouslyFocused = null

  function setStatus(message, tone = 'neutral') {
    status.textContent = message
    status.dataset.tone = tone
  }

  function addFact(container, label, value) {
    const wrapper = createElement('div', 'harness-fact')
    wrapper.appendChild(createElement('dt', null, label))
    wrapper.appendChild(createElement('dd', null, value || '—'))
    container.appendChild(wrapper)
  }

  function selectedCapability() {
    return viewState.card?.capabilities?.find(
      (item) => item.capability_id === capabilitySelect.value
    )
  }

  function renderCapabilityDetail() {
    const capability = selectedCapability()
    capabilityDetail.replaceChildren()
    if (!capability) return
    const title = createElement('strong', null, capability.name)
    const description = createElement('p', null, capability.description)
    const metadata = createElement(
      'p',
      'harness-muted',
      `${capability.execution_kind} · ${capability.risk} risk · ${capability.provider}${
        capability.model ? ` / ${capability.model}` : ''
      }`
    )
    capabilityDetail.append(title, description, metadata)
  }

  function renderCard() {
    capabilitySelect.replaceChildren()
    for (const capability of viewState.card?.capabilities || []) {
      const option = createElement('option', null, capability.name)
      option.value = capability.capability_id
      capabilitySelect.appendChild(option)
    }
    protocol.textContent = viewState.card
      ? `Protocol ${viewState.card.protocol_version}`
      : ''
    renderCapabilityDetail()
  }

  function renderTaskFacts(task) {
    taskFacts.replaceChildren()
    if (!task) {
      addFact(taskFacts, 'Task', 'No active task')
      return
    }
    addFact(taskFacts, 'Task ID', task.task_id)
    addFact(taskFacts, 'Context', task.context_id)
    addFact(taskFacts, 'Capability', task.active_capability_id)
    addFact(taskFacts, 'Trace', task.trace_id || 'Pending')
    addFact(taskFacts, 'Steps', `${task.step_count} / ${task.max_steps}`)
    addFact(taskFacts, 'Updated', task.updated_at)
  }

  function renderApproval(task) {
    const pending = taskNeedsApproval(task)
    setHidden(approvalSection, !pending)
    approvalFacts.replaceChildren()
    if (!pending) return
    const approval = task.approval
    approvalRisk.textContent = `${approval.risk} risk`
    approvalSummary.textContent = approval.summary
    addFact(approvalFacts, 'Approval ID', approval.approval_id)
    addFact(approvalFacts, 'Capability', approval.capability_id)
    addFact(approvalFacts, 'Expires', approval.expires_at)
    addFact(
      approvalFacts,
      'Permissions',
      approval.required_permissions.join(', ')
    )
    addFact(
      approvalFacts,
      'Verification',
      approval.verification_criteria.join(' · ')
    )
    addFact(
      approvalFacts,
      'Rollback limits',
      approval.rollback_limitations.join(' · ')
    )
  }

  function renderEvents() {
    eventList.replaceChildren()
    for (const event of viewState.events) {
      const item = createElement('li', 'harness-event')
      const heading = createElement('div', 'harness-event-heading')
      heading.append(
        createElement('strong', null, eventTitle(event)),
        createElement('time', null, event.occurred_at)
      )
      item.append(
        heading,
        createElement('p', null, event.message),
        createElement(
          'p',
          'harness-muted',
          `${event.state} · ${event.capability_id} · ${event.otel?.span_name || 'no span'}`
        )
      )
      eventList.appendChild(item)
    }
    eventCount.textContent = `${viewState.events.length} events`
  }

  function renderArtifacts(task) {
    artifactList.replaceChildren()
    for (const artifact of task?.artifacts || []) {
      const item = createElement('article', 'harness-artifact')
      item.appendChild(createElement('h4', null, artifactTitle(artifact)))
      for (const part of artifact.parts || []) {
        const content = createElement('pre', null, stringifyPart(part))
        item.appendChild(content)
      }
      const metadata = createElement(
        'pre',
        'harness-artifact-metadata',
        JSON.stringify(artifact.metadata || {}, null, 2)
      )
      item.appendChild(metadata)
      artifactList.appendChild(item)
    }
    artifactCount.textContent = `${task?.artifacts?.length || 0} artifacts`
  }

  function render() {
    const task = viewState.task
    stateBadge.textContent = taskStateLabel(task)
    stateBadge.dataset.tone = taskStateTone(task)
    renderTaskFacts(task)
    renderApproval(task)
    renderEvents()
    renderArtifacts(task)

    const response = assistantText(task)
    setHidden(answerSection, !response)
    answerText.textContent = response

    const error = task?.error
    setHidden(errorSection, !error)
    errorText.textContent = error ? `${error.code}: ${error.message}` : ''

    setHidden(cancelButton, !canCancelTask(task, viewState.card))
    startButton.disabled = viewState.busy || Boolean(task && !isTerminalTask(task))
  }

  async function pollTask() {
    if (!credentials || !viewState.task) return
    const generation = ++pollGeneration
    while (
      credentials &&
      generation === pollGeneration &&
      viewState.task &&
      !isTerminalTask(viewState.task) &&
      !taskNeedsApproval(viewState.task)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 600))
      if (!credentials || generation !== pollGeneration || !viewState.task) return
      try {
        const payload = await client.readTask({
          ...credentials,
          taskId: viewState.task.task_id,
          afterSequence: viewState.latestSequence
        })
        viewState = mergeTaskView(viewState, payload)
        render()
      } catch (error) {
        setStatus(`${error.code || 'harness.poll_failed'}: ${error.message}`, 'danger')
        return
      }
    }
    if (viewState.task?.state === 'completed') {
      setStatus('Task completed with recorded artifacts and causal events.', 'success')
    } else if (taskNeedsApproval(viewState.task)) {
      setStatus('Task paused at an owner approval checkpoint.', 'attention')
    } else if (viewState.task && isTerminalTask(viewState.task)) {
      setStatus(`Task ended: ${taskStateLabel(viewState.task)}.`, 'neutral')
    }
  }

  async function connect() {
    const deviceId = deviceInput.value.trim()
    const apiKey = apiKeyInput.value
    if (!deviceId || !apiKey) {
      setStatus('Enter the paired device ID and API key.', 'danger')
      return
    }
    setStatus('Loading the authenticated capability card…', 'active')
    try {
      const payload = await client.getCard({ deviceId, apiKey })
      credentials = { deviceId, apiKey }
      viewState = {
        ...createHarnessViewState(),
        card: payload.card,
        connected: true
      }
      renderCard()
      render()
      workspace.hidden = false
      setStatus(
        `${payload.card.capabilities.length} owner-authorized capabilities available.`,
        'success'
      )
    } catch (error) {
      credentials = null
      setStatus(`${error.code || 'harness.connect_failed'}: ${error.message}`, 'danger')
    }
  }

  async function startTask() {
    if (!credentials) {
      setStatus('Connect the authenticated owner session first.', 'danger')
      return
    }
    const input = taskInput.value.trim()
    if (!input || !capabilitySelect.value) {
      setStatus('Select a capability and enter a request.', 'danger')
      return
    }
    pollGeneration += 1
    viewState = { ...viewState, busy: true, task: null, events: [], latestSequence: 0 }
    render()
    setStatus('Submitting a bounded harness task…', 'active')
    try {
      const payload = await client.startTask({
        ...credentials,
        contextId: `web-${crypto.randomUUID()}`,
        idempotencyKey: crypto.randomUUID(),
        capabilityId: capabilitySelect.value,
        input
      })
      viewState = mergeTaskView({ ...viewState, busy: false }, payload)
      render()
      setStatus('Task accepted. Following real harness events.', 'active')
      void pollTask()
    } catch (error) {
      viewState = { ...viewState, busy: false }
      render()
      setStatus(`${error.code || 'harness.start_failed'}: ${error.message}`, 'danger')
    }
  }

  async function cancelTask() {
    if (!credentials || !viewState.task) return
    setStatus('Canceling the active task…', 'attention')
    try {
      const payload = await client.cancelTask({
        ...credentials,
        taskId: viewState.task.task_id,
        reason: 'Canceled from the owner harness shell.'
      })
      pollGeneration += 1
      viewState = mergeTaskView(viewState, payload)
      render()
      setStatus('Task canceled and recorded in the event stream.', 'neutral')
    } catch (error) {
      setStatus(`${error.code || 'harness.cancel_failed'}: ${error.message}`, 'danger')
    }
  }

  async function decide(decision) {
    if (!credentials || !viewState.task?.approval) return
    setStatus(`Recording ${decision} decision…`, 'attention')
    try {
      const payload = await client.decideTask({
        ...credentials,
        taskId: viewState.task.task_id,
        approvalId: viewState.task.approval.approval_id,
        decision
      })
      viewState = mergeTaskView(viewState, payload)
      render()
      if (decision === 'approved') {
        setStatus('Exact scope approved. Following resumed events.', 'active')
        void pollTask()
      } else {
        setStatus('Task rejected by the owner.', 'neutral')
      }
    } catch (error) {
      setStatus(`${error.code || 'harness.decision_failed'}: ${error.message}`, 'danger')
    }
  }

  function openPanel() {
    previouslyFocused = document.activeElement
    setHidden(panel, false)
    deviceInput.focus()
  }

  function closePanel() {
    pollGeneration += 1
    credentials = null
    apiKeyInput.value = ''
    deviceInput.value = ''
    taskInput.value = ''
    workspace.hidden = true
    viewState = createHarnessViewState()
    render()
    setStatus('Harness credentials cleared.', 'neutral')
    setHidden(panel, true)
    previouslyFocused?.focus?.()
  }

  capabilitySelect.addEventListener('change', renderCapabilityDetail)
  launchButton.addEventListener('click', openPanel)
  panel.querySelector('[data-action="connect"]').addEventListener('click', () => {
    void connect()
  })
  startButton.addEventListener('click', () => {
    void startTask()
  })
  cancelButton.addEventListener('click', () => {
    void cancelTask()
  })
  panel.querySelector('[data-action="approve"]').addEventListener('click', () => {
    void decide('approved')
  })
  panel.querySelector('[data-action="reject"]').addEventListener('click', () => {
    void decide('rejected')
  })
  panel.querySelectorAll('[data-action="close"]').forEach((element) => {
    element.addEventListener('click', closePanel)
  })
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel()
  })

  render()
  setStatus('Authenticate to discover the current harness capability card.', 'neutral')
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountHarnessPanel)
} else {
  mountHarnessPanel()
}
