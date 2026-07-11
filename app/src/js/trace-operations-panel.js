import '../css/trace-operations.scss'

import {
  buildPlanReview,
  formatRemaining,
  getOperationPresentation,
  isReasonCodeValid,
  receiptEvidenceRows,
  rotationStatusSummary
} from './trace-operations-model'

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

function shortHash(value) {
  if (!value) return 'none'
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value
}

function mountTraceOperationsPanel() {
  const topContainer = document.querySelector('#top-container')
  if (!topContainer || document.querySelector('#trace-operations-button')) {
    return
  }

  const launchButton = createElement(
    'button',
    'trace-operations-launch',
    'Trace operations'
  )
  launchButton.id = 'trace-operations-button'
  launchButton.type = 'button'
  launchButton.setAttribute('aria-haspopup', 'dialog')
  topContainer.appendChild(launchButton)

  const panel = createElement('section', 'trace-operations-panel')
  panel.id = 'trace-operations-panel'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', 'trace-operations-title')
  panel.setAttribute('aria-hidden', 'true')
  panel.innerHTML = `
    <div class="trace-operations-backdrop" data-action="close"></div>
    <div class="trace-operations-shell">
      <header class="trace-operations-header">
        <div>
          <p class="trace-operations-eyebrow">Owner-controlled data operations</p>
          <h2 id="trace-operations-title">Trace operations</h2>
          <p>Inspect key readiness, export exact traces, or approve a selective physical purge.</p>
        </div>
        <button class="trace-operations-close" type="button" data-action="close" aria-label="Close trace operations">×</button>
      </header>

      <div class="trace-operations-status" role="status" aria-live="polite"></div>

      <section class="trace-operations-auth" aria-labelledby="trace-auth-title">
        <h3 id="trace-auth-title">Authenticate</h3>
        <div class="trace-operations-fields">
          <label>
            <span>Paired device ID</span>
            <input name="device-id" type="text" autocomplete="off" spellcheck="false" />
          </label>
          <label>
            <span>API key</span>
            <input name="api-key" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <button type="button" data-action="connect">Load owner dashboard</button>
        </div>
        <p class="trace-operations-help">Credentials stay in memory only and are cleared when this panel closes.</p>
      </section>

      <div class="trace-operations-dashboard" hidden>
        <section class="trace-operations-card" aria-labelledby="trace-key-title">
          <div class="trace-operations-card-header">
            <div>
              <p class="trace-operations-eyebrow">Current evidence</p>
              <h3 id="trace-key-title">Key rotation readiness</h3>
            </div>
            <button type="button" data-action="refresh">Refresh</button>
          </div>
          <div class="trace-key-summary"></div>
          <dl class="trace-key-facts"></dl>
          <div class="trace-key-blockers"></div>
        </section>

        <section class="trace-operations-card" aria-labelledby="trace-catalog-title">
          <div class="trace-operations-card-header">
            <div>
              <p class="trace-operations-eyebrow">Exact owner scope</p>
              <h3 id="trace-catalog-title">Trace catalog</h3>
            </div>
            <span class="trace-selection-count">0 selected</span>
          </div>
          <div class="trace-catalog"></div>
        </section>

        <section class="trace-operations-card trace-operation-builder" aria-labelledby="trace-builder-title">
          <div class="trace-operations-card-header">
            <div>
              <p class="trace-operations-eyebrow">Plan before approval</p>
              <h3 id="trace-builder-title">Create exact operation plan</h3>
            </div>
            <span class="trace-operation-risk">High risk</span>
          </div>
          <div class="trace-operations-fields trace-operation-fields">
            <label>
              <span>Operation</span>
              <select name="operation">
                <option value="export">Export selected traces</option>
                <option value="purge">Permanently purge selected traces</option>
              </select>
            </label>
            <label>
              <span>Reason code</span>
              <input name="reason-code" type="text" value="owner_requested_export" autocomplete="off" spellcheck="false" />
            </label>
            <button type="button" data-action="plan">Create immutable plan</button>
          </div>
          <p class="trace-operation-warning"></p>
        </section>

        <section class="trace-operations-card trace-plan-review" hidden aria-labelledby="trace-plan-title">
          <div class="trace-operations-card-header">
            <div>
              <p class="trace-operations-eyebrow">Approval boundary</p>
              <h3 id="trace-plan-title">Review immutable plan</h3>
            </div>
            <span class="trace-plan-expiry"></span>
          </div>
          <dl class="trace-plan-facts"></dl>
          <div class="trace-plan-scope"></div>
          <div class="trace-plan-verification"></div>
          <label class="trace-purge-ack" hidden>
            <input type="checkbox" name="purge-ack" />
            <span>I understand this exact purge is irreversible and backup restore is not implemented.</span>
          </label>
          <div class="trace-plan-actions">
            <button type="button" data-action="reject">Reject plan</button>
            <button type="button" data-action="approve">Approve plan</button>
            <button type="button" data-action="execute" hidden>Execute verified operation</button>
          </div>
        </section>

        <section class="trace-operations-card trace-receipt" hidden aria-labelledby="trace-receipt-title">
          <div class="trace-operations-card-header">
            <div>
              <p class="trace-operations-eyebrow">Independent verification</p>
              <h3 id="trace-receipt-title">Immutable receipt</h3>
            </div>
            <span class="trace-receipt-status"></span>
          </div>
          <dl class="trace-receipt-facts"></dl>
          <div class="trace-receipt-evidence"></div>
          <button type="button" data-action="download" hidden>Download verified export JSON</button>
        </section>

        <section class="trace-operations-card" aria-labelledby="trace-history-title">
          <div class="trace-operations-card-header">
            <div>
              <p class="trace-operations-eyebrow">Owner-visible evidence</p>
              <h3 id="trace-history-title">Recent plans and receipts</h3>
            </div>
          </div>
          <div class="trace-operation-history"></div>
        </section>
      </div>
    </div>
  `
  document.body.appendChild(panel)

  const state = {
    apiKey: '',
    deviceId: '',
    dashboard: null,
    plan: null,
    approvalToken: null,
    approval: null,
    receipt: null,
    exportBundle: null,
    countdownTimer: null
  }

  const statusElement = panel.querySelector('.trace-operations-status')
  const dashboardElement = panel.querySelector('.trace-operations-dashboard')
  const deviceInput = panel.querySelector('[name="device-id"]')
  const apiKeyInput = panel.querySelector('[name="api-key"]')
  const operationInput = panel.querySelector('[name="operation"]')
  const reasonInput = panel.querySelector('[name="reason-code"]')
  const purgeAcknowledgement = panel.querySelector('[name="purge-ack"]')

  function setStatus(message, type = 'neutral') {
    statusElement.textContent = message
    statusElement.dataset.type = type
  }

  function clearSensitiveState() {
    state.apiKey = ''
    state.approvalToken = null
    apiKeyInput.value = ''
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer)
      state.countdownTimer = null
    }
  }

  async function request(pathname, options = {}) {
    const response = await fetch(`${serverUrl}${pathname}`, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': state.apiKey,
        ...(options.headers || {})
      }
    })
    const payload = await response.json().catch(() => ({
      success: false,
      code: 'client.invalid_json',
      message: 'The server returned an unreadable response.'
    }))
    if (!response.ok || payload.success === false) {
      const error = new Error(payload.message || `Request failed (${response.status}).`)
      error.code = payload.code || 'client.request_failed'
      throw error
    }
    return payload
  }

  function renderReadiness(readiness) {
    const summary = rotationStatusSummary(readiness)
    const summaryElement = panel.querySelector('.trace-key-summary')
    summaryElement.replaceChildren(
      createElement('strong', '', summary.label),
      createElement('p', '', summary.detail)
    )
    summaryElement.dataset.status = readiness.status

    const facts = panel.querySelector('.trace-key-facts')
    facts.replaceChildren()
    const factRows = [
      ['Active key version', readiness.active_key.key_version],
      ['Key fingerprint', readiness.active_key.encryption_key_id],
      ['Algorithm', readiness.active_key.algorithm],
      ['Trace chain', readiness.chain.valid ? 'valid' : 'invalid'],
      ['Owner traces', String(readiness.trace_inventory.total)],
      ['Active plans', String(readiness.operation_inventory.active_unexpired)],
      ['Verified receipts', String(readiness.operation_inventory.verified_receipts)],
      ['Migrations', readiness.migration_versions.join(', ')]
    ]
    for (const [label, value] of factRows) {
      facts.append(
        createElement('dt', '', label),
        createElement('dd', '', value)
      )
    }

    const blockers = panel.querySelector('.trace-key-blockers')
    blockers.replaceChildren()
    const title = createElement('h4', '', 'Deterministic blockers')
    blockers.appendChild(title)
    const list = createElement('ul')
    for (const blocker of readiness.blockers) {
      list.appendChild(createElement('li', '', blocker))
    }
    for (const warning of readiness.warnings) {
      list.appendChild(createElement('li', '', `Warning: ${warning}`))
    }
    if (!list.children.length) {
      list.appendChild(createElement('li', '', 'No current data-integrity blockers.'))
    }
    blockers.appendChild(list)
  }

  function selectedTraceIds() {
    return [...panel.querySelectorAll('.trace-catalog input:checked')].map(
      (input) => input.value
    )
  }

  function updateSelectionCount() {
    const count = selectedTraceIds().length
    panel.querySelector('.trace-selection-count').textContent =
      `${count} selected`
  }

  function renderTraceCatalog(traces) {
    const catalog = panel.querySelector('.trace-catalog')
    catalog.replaceChildren()
    if (!traces.length) {
      catalog.appendChild(createElement('p', 'trace-empty', 'No owner traces are available.'))
      updateSelectionCount()
      return
    }
    for (const trace of traces) {
      const label = createElement('label', 'trace-catalog-item')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.value = trace.trace_id
      checkbox.addEventListener('change', updateSelectionCount)
      const body = createElement('span', 'trace-catalog-body')
      const heading = createElement('strong', '', trace.event_type)
      const id = createElement('code', '', trace.trace_id)
      const metadata = createElement(
        'small',
        '',
        `${new Date(trace.occurred_at).toLocaleString()} · key ${
          trace.encryption_key_version || 'unregistered'
        }/${trace.encryption_key_id} · retained until ${new Date(
          trace.retention_until
        ).toLocaleString()}`
      )
      body.append(heading, id, metadata)
      label.append(checkbox, body)
      catalog.appendChild(label)
    }
    updateSelectionCount()
  }

  function renderHistory(plans) {
    const history = panel.querySelector('.trace-operation-history')
    history.replaceChildren()
    if (!plans.length) {
      history.appendChild(createElement('p', 'trace-empty', 'No operation history is available.'))
      return
    }
    for (const plan of plans) {
      const item = createElement('article', 'trace-history-item')
      const header = createElement('div', 'trace-history-header')
      header.append(
        createElement('strong', '', `${plan.operation.toUpperCase()} · ${plan.risk}`),
        createElement(
          'span',
          '',
          plan.receipt
            ? `${plan.receipt.execution_status}/${plan.receipt.verification_status}`
            : plan.approval_decision || (plan.expired ? 'expired' : 'pending')
        )
      )
      item.append(
        header,
        createElement('code', '', plan.plan_id),
        createElement(
          'p',
          '',
          `${plan.trace_count} trace${plan.trace_count === 1 ? '' : 's'} · scope ${shortHash(
            plan.scope_hash
          )} · key ${plan.key_version || 'unavailable'}`
        )
      )
      if (plan.receipt) {
        item.appendChild(
          createElement('small', '', `Receipt ${shortHash(plan.receipt.receipt_hash)}`)
        )
      }
      history.appendChild(item)
    }
  }

  function renderDashboard(dashboard) {
    state.dashboard = dashboard
    setHidden(dashboardElement, false)
    renderReadiness(dashboard.readiness)
    renderTraceCatalog(dashboard.traces)
    renderHistory(dashboard.plans)
  }

  async function loadDashboard() {
    state.deviceId = deviceInput.value.trim()
    state.apiKey = apiKeyInput.value
    if (!state.deviceId || !state.apiKey) {
      throw new Error('Enter the paired device ID and API key.')
    }
    setStatus('Loading current owner evidence…')
    const payload = await request(
      `/api/v1/greenfield/trace-operations/dashboard?device_id=${encodeURIComponent(
        state.deviceId
      )}`,
      { method: 'GET', headers: {} }
    )
    renderDashboard(payload.dashboard)
    setStatus('Dashboard loaded from current authenticated evidence.', 'success')
  }

  function updateOperationPresentation() {
    const presentation = getOperationPresentation(operationInput.value)
    panel.querySelector('.trace-operation-risk').textContent =
      `${presentation.risk} risk`
    panel.querySelector('.trace-operation-warning').textContent = presentation.warning
    if (!reasonInput.dataset.edited) {
      reasonInput.value = `owner_requested_${operationInput.value}`
    }
  }

  function renderPlan(plan, traceIds) {
    const review = buildPlanReview(plan, traceIds)
    state.plan = review
    const section = panel.querySelector('.trace-plan-review')
    setHidden(section, false)
    panel.querySelector('.trace-plan-expiry').textContent = review.expiryLabel
    const facts = panel.querySelector('.trace-plan-facts')
    facts.replaceChildren()
    for (const [label, value] of [
      ['Plan ID', review.planId],
      ['Operation', review.operation],
      ['Risk', review.risk],
      ['Exact trace count', String(review.traceCount)],
      ['Scope hash', review.scopeHash],
      ['Created', review.createdAt],
      ['Expires', review.expiresAt],
      ['Rollback', review.rollbackSupported ? 'supported' : 'not supported']
    ]) {
      facts.append(createElement('dt', '', label), createElement('dd', '', value))
    }

    const scope = panel.querySelector('.trace-plan-scope')
    scope.replaceChildren(createElement('h4', '', 'Exact approved scope'))
    const scopeList = createElement('ol')
    for (const traceId of review.traceIds) {
      scopeList.appendChild(createElement('li', '', traceId))
    }
    scope.appendChild(scopeList)

    const verification = panel.querySelector('.trace-plan-verification')
    verification.replaceChildren(createElement('h4', '', 'Verification criteria'))
    const verificationList = createElement('ul')
    for (const criterion of review.verificationCriteria) {
      verificationList.appendChild(createElement('li', '', criterion))
    }
    verification.appendChild(verificationList)

    const purgeAck = panel.querySelector('.trace-purge-ack')
    setHidden(purgeAck, review.operation !== 'purge')
    purgeAcknowledgement.checked = false
    panel.querySelector('[data-action="approve"]').textContent =
      getOperationPresentation(review.operation).approveLabel
    panel.querySelector('[data-action="execute"]').textContent =
      getOperationPresentation(review.operation).executeLabel
    panel.querySelector('[data-action="approve"]').hidden = false
    panel.querySelector('[data-action="reject"]').hidden = false
    panel.querySelector('[data-action="execute"]').hidden = true

    if (state.countdownTimer) clearInterval(state.countdownTimer)
    state.countdownTimer = setInterval(() => {
      if (!state.plan) return
      const label = formatRemaining(state.plan.expiresAt)
      panel.querySelector('.trace-plan-expiry').textContent = label
      if (label === 'expired') {
        panel.querySelector('[data-action="approve"]').disabled = true
        panel.querySelector('[data-action="execute"]').disabled = true
      }
    }, 1_000)
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function createPlan() {
    const traceIds = selectedTraceIds()
    const reasonCode = reasonInput.value.trim()
    if (!traceIds.length) {
      throw new Error('Select at least one exact trace.')
    }
    if (!isReasonCodeValid(reasonCode)) {
      throw new Error('Reason code must be a stable lowercase identifier.')
    }
    setStatus('Creating encrypted immutable plan…')
    const payload = await request('/api/v1/greenfield/trace-operations/plan', {
      method: 'POST',
      body: JSON.stringify({
        device_id: state.deviceId,
        operation: operationInput.value,
        trace_ids: traceIds,
        ...(reasonCode ? { reason_code: reasonCode } : {})
      })
    })
    state.approvalToken = payload.approval_token
    state.approval = null
    state.receipt = null
    state.exportBundle = null
    renderPlan(payload.plan, traceIds)
    setHidden(panel.querySelector('.trace-receipt'), true)
    setStatus('Plan created. Review the exact scope before deciding.', 'warning')
  }

  async function decide(decision) {
    if (!state.plan || !state.approvalToken) {
      throw new Error('No current one-time approval challenge is available.')
    }
    if (
      decision === 'approved' &&
      state.plan.operation === 'purge' &&
      !purgeAcknowledgement.checked
    ) {
      throw new Error('Acknowledge that the exact purge is irreversible.')
    }
    setStatus(`${decision === 'approved' ? 'Approving' : 'Rejecting'} immutable plan…`)
    const payload = await request('/api/v1/greenfield/trace-operations/approve', {
      method: 'POST',
      body: JSON.stringify({
        device_id: state.deviceId,
        plan_id: state.plan.planId,
        approval_token: state.approvalToken,
        decision
      })
    })
    state.approvalToken = null
    state.approval = payload.approval
    panel.querySelector('[data-action="approve"]').hidden = true
    panel.querySelector('[data-action="reject"]').hidden = true
    panel.querySelector('[data-action="execute"]').hidden =
      decision !== 'approved'
    setStatus(
      decision === 'approved'
        ? 'Owner approval recorded. Execution remains a separate step.'
        : 'Owner rejection recorded. Nothing was executed.',
      decision === 'approved' ? 'warning' : 'success'
    )
  }

  function renderReceipt(receipt, exportBundle) {
    state.receipt = receipt
    state.exportBundle = exportBundle
    const section = panel.querySelector('.trace-receipt')
    setHidden(section, false)
    const verified =
      receipt.execution_status === 'succeeded' &&
      receipt.verification_status === 'succeeded'
    panel.querySelector('.trace-receipt-status').textContent = verified
      ? 'Verified success'
      : 'Failed or unverified'
    panel.querySelector('.trace-receipt-status').dataset.status = verified
      ? 'success'
      : 'error'
    const facts = panel.querySelector('.trace-receipt-facts')
    facts.replaceChildren()
    for (const [label, value] of receiptEvidenceRows(receipt)) {
      facts.append(createElement('dt', '', label), createElement('dd', '', value))
    }
    const evidence = panel.querySelector('.trace-receipt-evidence')
    evidence.replaceChildren(createElement('h4', '', 'Verification evidence'))
    const list = createElement('ul')
    for (const item of receipt.verification_evidence_refs) {
      list.appendChild(createElement('li', '', item))
    }
    evidence.appendChild(list)
    const downloadButton = panel.querySelector('[data-action="download"]')
    downloadButton.hidden = !exportBundle || !verified
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function executePlan() {
    if (!state.plan || state.approval?.decision !== 'approved') {
      throw new Error('A matching owner approval is required before execution.')
    }
    setStatus('Executing exact scope and independently verifying the result…', 'warning')
    const payload = await request('/api/v1/greenfield/trace-operations/execute', {
      method: 'POST',
      body: JSON.stringify({
        device_id: state.deviceId,
        plan_id: state.plan.planId
      })
    })
    renderReceipt(payload.receipt, payload.export_bundle)
    panel.querySelector('[data-action="execute"]').hidden = true
    setStatus(
      payload.receipt.verification_status === 'succeeded'
        ? 'Execution completed and independently verified.'
        : 'Execution did not produce verified success.',
      payload.receipt.verification_status === 'succeeded' ? 'success' : 'error'
    )
    await loadDashboard()
  }

  function downloadExport() {
    if (!state.exportBundle || !state.receipt) return
    const blob = new Blob([JSON.stringify(state.exportBundle, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mira-trace-export-${state.receipt.plan_id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function closePanel() {
    clearSensitiveState()
    setHidden(panel, true)
    launchButton.focus()
  }

  async function handleAction(action) {
    try {
      if (action === 'connect' || action === 'refresh') await loadDashboard()
      if (action === 'plan') await createPlan()
      if (action === 'approve') await decide('approved')
      if (action === 'reject') await decide('rejected')
      if (action === 'execute') await executePlan()
      if (action === 'download') downloadExport()
      if (action === 'close') closePanel()
    } catch (error) {
      setStatus(`${error.code ? `${error.code}: ` : ''}${error.message}`, 'error')
    }
  }

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]')
    if (target) handleAction(target.dataset.action)
  })
  operationInput.addEventListener('change', updateOperationPresentation)
  reasonInput.addEventListener('input', () => {
    reasonInput.dataset.edited = reasonInput.value ? 'true' : ''
  })
  launchButton.addEventListener('click', () => {
    setHidden(panel, false)
    setStatus('Enter the paired device ID and API key to load current evidence.')
    deviceInput.focus()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePanel()
  })

  updateOperationPresentation()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountTraceOperationsPanel)
} else {
  mountTraceOperationsPanel()
}
