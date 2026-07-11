import '../css/memory.scss'

import {
  buildMemoryCandidateReview,
  buildMemoryPurgeReview,
  formatMemoryRecordSummary,
  formatMemoryRemaining,
  getMemoryTimeScopePresentation,
  isMemoryReasonCodeValid,
  isVerifiedMemoryPurgeReceipt,
  memoryReceiptEvidenceRows,
  parseReferenceList
} from './memory-model'

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

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function mountMemoryPanel() {
  const topContainer = document.querySelector('#top-container')
  if (!topContainer || document.querySelector('#memory-panel-button')) return

  const launchButton = createElement('button', 'memory-launch', 'Memory')
  launchButton.id = 'memory-panel-button'
  launchButton.type = 'button'
  launchButton.setAttribute('aria-haspopup', 'dialog')
  topContainer.appendChild(launchButton)

  const panel = createElement('section', 'memory-panel')
  panel.id = 'memory-panel'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', 'memory-panel-title')
  panel.setAttribute('aria-hidden', 'true')
  panel.innerHTML = `
    <div class="memory-backdrop" data-action="close"></div>
    <div class="memory-shell">
      <header class="memory-header">
        <div>
          <p class="memory-eyebrow">Owner-controlled durable context</p>
          <h2 id="memory-panel-title">Memory lifecycle</h2>
          <p>Propose, confirm, retrieve, export, correct, or physically forget provenance-aware memory.</p>
        </div>
        <button class="memory-close" type="button" data-action="close" aria-label="Close memory lifecycle">×</button>
      </header>

      <div class="memory-status" role="status" aria-live="polite"></div>

      <section class="memory-card memory-auth" aria-labelledby="memory-auth-title">
        <h3 id="memory-auth-title">Authenticate</h3>
        <div class="memory-fields memory-auth-fields">
          <label>
            <span>Paired device ID</span>
            <input name="memory-device-id" type="text" autocomplete="off" spellcheck="false" />
          </label>
          <label>
            <span>API key</span>
            <input name="memory-api-key" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <button type="button" data-action="connect">Connect</button>
        </div>
        <p class="memory-help">Credentials and one-time approval challenges stay in memory only and are cleared when this panel closes.</p>
      </section>

      <div class="memory-workspace" hidden>
        <section class="memory-card" aria-labelledby="memory-candidate-title">
          <div class="memory-card-header">
            <div>
              <p class="memory-eyebrow">Pending until owner confirmation</p>
              <h3 id="memory-candidate-title">Propose memory</h3>
            </div>
            <span class="memory-state-label">Not durable</span>
          </div>
          <div class="memory-fields memory-candidate-fields">
            <label class="memory-span-two">
              <span>Title</span>
              <input name="memory-title" type="text" maxlength="256" autocomplete="off" />
            </label>
            <label class="memory-span-two">
              <span>Content</span>
              <textarea name="memory-content" rows="5" maxlength="16384"></textarea>
            </label>
            <label>
              <span>Memory class</span>
              <select name="memory-class">
                <option value="semantic">Semantic</option>
                <option value="recent_episodic">Recent episodic</option>
                <option value="long_term_episodic">Long-term episodic</option>
                <option value="relationship">Relationship</option>
                <option value="procedural">Procedural</option>
                <option value="identity">Identity</option>
                <option value="prospective">Prospective</option>
                <option value="reflective">Reflective</option>
                <option value="artifact">Artifact</option>
                <option value="model_hypothesis">Model hypothesis</option>
              </select>
            </label>
            <label>
              <span>Temporal status</span>
              <select name="memory-temporal-status">
                <option value="historical">Historical</option>
                <option value="prospective">Prospective</option>
                <option value="unknown">Unknown</option>
                <option value="current">Current claim</option>
                <option value="superseded">Superseded</option>
              </select>
            </label>
            <label>
              <span>Observed at</span>
              <input name="memory-observed-at" type="datetime-local" />
            </label>
            <label>
              <span>Retention policy</span>
              <input name="memory-retention-policy" type="text" value="owner_confirmed" autocomplete="off" spellcheck="false" />
            </label>
            <label>
              <span>Confidence (0–1)</span>
              <input name="memory-confidence" type="number" min="0" max="1" step="0.05" value="1" />
            </label>
            <label>
              <span>Salience (0–1)</span>
              <input name="memory-salience" type="number" min="0" max="1" step="0.05" value="0.7" />
            </label>
            <label class="memory-span-two">
              <span>Provenance references, comma or line separated</span>
              <textarea name="memory-source-refs" rows="2">owner://statement/manual</textarea>
            </label>
            <details class="memory-span-two memory-lineage-fields">
              <summary>Optional correction and lineage links</summary>
              <div class="memory-fields">
                <label>
                  <span>Derived from memory IDs</span>
                  <textarea name="memory-derived-from" rows="2"></textarea>
                </label>
                <label>
                  <span>Contradicts memory IDs</span>
                  <textarea name="memory-contradicts" rows="2"></textarea>
                </label>
                <label class="memory-span-two">
                  <span>Supersedes memory IDs</span>
                  <textarea name="memory-supersedes" rows="2"></textarea>
                </label>
              </div>
            </details>
            <button type="button" data-action="create-candidate">Create pending candidate</button>
          </div>
          <p class="memory-warning">A current-state claim can be remembered as history, but it can never replace fresh evidence about what is true now.</p>
        </section>

        <section class="memory-card memory-candidate-review" hidden aria-labelledby="memory-review-title">
          <div class="memory-card-header">
            <div>
              <p class="memory-eyebrow">Explicit owner decision</p>
              <h3 id="memory-review-title">Review pending candidate</h3>
            </div>
            <span class="memory-candidate-expiry"></span>
          </div>
          <dl class="memory-facts memory-candidate-facts"></dl>
          <article class="memory-content-review"></article>
          <div class="memory-provenance"></div>
          <div class="memory-actions">
            <button type="button" data-action="reject-candidate">Reject</button>
            <button type="button" data-action="confirm-candidate">Confirm as durable memory</button>
          </div>
        </section>

        <section class="memory-card" aria-labelledby="memory-search-title">
          <div class="memory-card-header">
            <div>
              <p class="memory-eyebrow">Confirmed records only</p>
              <h3 id="memory-search-title">Retrieve memory</h3>
            </div>
            <button type="button" data-action="export">Export owner memory</button>
          </div>
          <div class="memory-fields memory-search-fields">
            <label>
              <span>Query</span>
              <input name="memory-query" type="search" autocomplete="off" />
            </label>
            <label>
              <span>Time scope</span>
              <select name="memory-time-scope">
                <option value="historical">Historical</option>
                <option value="atemporal">Atemporal</option>
                <option value="prospective">Prospective</option>
                <option value="current">Current state</option>
              </select>
            </label>
            <button type="button" data-action="search">Search</button>
          </div>
          <div class="memory-scope-warning"></div>
          <div class="memory-results"></div>
          <div class="memory-selection-bar">
            <span class="memory-selection-count">0 selected</span>
            <button type="button" data-action="clear-selection">Clear selection</button>
          </div>
        </section>

        <section class="memory-card memory-purge-builder" aria-labelledby="memory-purge-title">
          <div class="memory-card-header">
            <div>
              <p class="memory-eyebrow">Critical verified action</p>
              <h3 id="memory-purge-title">Physically forget selected memory</h3>
            </div>
            <span class="memory-critical-label">Critical</span>
          </div>
          <div class="memory-fields memory-purge-fields">
            <label>
              <span>Reason code</span>
              <input name="memory-purge-reason" type="text" value="owner_requested_forget" autocomplete="off" spellcheck="false" />
            </label>
            <button type="button" data-action="plan-purge">Create exact purge plan</button>
          </div>
          <p class="memory-danger">This deletes the exact canonical records and every keyed search, graph, and linked pending-candidate projection. It cannot be undone.</p>
        </section>

        <section class="memory-card memory-purge-review" hidden aria-labelledby="memory-purge-review-title">
          <div class="memory-card-header">
            <div>
              <p class="memory-eyebrow">Immutable exact scope</p>
              <h3 id="memory-purge-review-title">Review purge plan</h3>
            </div>
            <span class="memory-purge-expiry"></span>
          </div>
          <dl class="memory-facts memory-purge-facts"></dl>
          <div class="memory-purge-scope"></div>
          <div class="memory-purge-verification"></div>
          <div class="memory-purge-rollback"></div>
          <label class="memory-purge-ack">
            <input type="checkbox" name="memory-purge-ack" />
            <span>I understand that this exact memory purge is physical, irreversible, and cannot be restored by a code rollback.</span>
          </label>
          <div class="memory-actions">
            <button type="button" data-action="reject-purge">Reject plan</button>
            <button type="button" data-action="approve-purge">Approve irreversible purge</button>
            <button type="button" data-action="execute-purge" hidden>Execute and verify purge</button>
          </div>
        </section>

        <section class="memory-card memory-receipt" hidden aria-labelledby="memory-receipt-title">
          <div class="memory-card-header">
            <div>
              <p class="memory-eyebrow">Receipt-backed outcome</p>
              <h3 id="memory-receipt-title">Immutable purge receipt</h3>
            </div>
            <span class="memory-receipt-status"></span>
          </div>
          <dl class="memory-facts memory-receipt-facts"></dl>
          <div class="memory-receipt-evidence"></div>
        </section>
      </div>
    </div>
  `
  document.body.appendChild(panel)

  const state = {
    apiKey: '',
    deviceId: '',
    candidateReview: null,
    candidateApprovalToken: null,
    candidateTimer: null,
    records: [],
    selectedMemoryIds: new Set(),
    purgeReview: null,
    purgeApprovalToken: null,
    purgeApproval: null,
    purgeTimer: null,
    receipt: null,
    exportBundle: null
  }

  const statusElement = panel.querySelector('.memory-status')
  const workspace = panel.querySelector('.memory-workspace')
  const deviceInput = panel.querySelector('[name="memory-device-id"]')
  const apiKeyInput = panel.querySelector('[name="memory-api-key"]')
  const observedAtInput = panel.querySelector('[name="memory-observed-at"]')
  const timeScopeInput = panel.querySelector('[name="memory-time-scope"]')
  const purgeAck = panel.querySelector('[name="memory-purge-ack"]')
  observedAtInput.value = localDateTimeValue()

  function setStatus(message, type = 'neutral') {
    statusElement.textContent = message
    statusElement.dataset.type = type
  }

  function clearTimer(name) {
    if (state[name]) {
      clearInterval(state[name])
      state[name] = null
    }
  }

  function clearSensitiveState() {
    state.apiKey = ''
    state.candidateApprovalToken = null
    state.purgeApprovalToken = null
    apiKeyInput.value = ''
    clearTimer('candidateTimer')
    clearTimer('purgeTimer')
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

  function connect() {
    state.deviceId = deviceInput.value.trim()
    state.apiKey = apiKeyInput.value
    if (!state.deviceId || !state.apiKey) {
      throw new Error('Enter the paired device ID and API key.')
    }
    setHidden(workspace, false)
    setStatus('Connected. Credentials remain only in this open panel.', 'success')
    panel.querySelector('[name="memory-title"]').focus()
  }

  function appendFacts(element, rows) {
    element.replaceChildren()
    for (const [label, value] of rows) {
      element.append(
        createElement('dt', '', label),
        createElement('dd', '', String(value ?? 'none'))
      )
    }
  }

  function renderReferenceList(container, title, values) {
    if (!values.length) return
    container.appendChild(createElement('h4', '', title))
    const list = createElement('ul')
    for (const value of values) list.appendChild(createElement('li', '', value))
    container.appendChild(list)
  }

  function startCandidateCountdown() {
    clearTimer('candidateTimer')
    state.candidateTimer = setInterval(() => {
      if (!state.candidateReview) return
      const label = formatMemoryRemaining(state.candidateReview.expiresAt)
      panel.querySelector('.memory-candidate-expiry').textContent = label
      const expired = label === 'expired'
      panel.querySelector('[data-action="confirm-candidate"]').disabled = expired
      panel.querySelector('[data-action="reject-candidate"]').disabled = expired
    }, 1_000)
  }

  function renderCandidateReview(review) {
    state.candidateReview = review
    const section = panel.querySelector('.memory-candidate-review')
    setHidden(section, false)
    panel.querySelector('.memory-candidate-expiry').textContent = review.expiryLabel
    appendFacts(panel.querySelector('.memory-candidate-facts'), [
      ['Candidate ID', review.candidateId],
      ['Origin trace', review.traceId],
      ['Class', review.memoryClass],
      ['Temporal status', review.temporalStatus],
      ['Privacy zone', review.privacyZone],
      ['Confidence', review.confidence],
      ['Salience', review.salience],
      ['Retention', review.retentionPolicy],
      ['Record hash', review.recordHash],
      ['Content hash', review.contentHash]
    ])
    const content = panel.querySelector('.memory-content-review')
    content.replaceChildren(
      createElement('h4', '', review.title),
      createElement('p', '', review.content)
    )
    const provenance = panel.querySelector('.memory-provenance')
    provenance.replaceChildren()
    renderReferenceList(provenance, 'Provenance', review.sourceRefs)
    renderReferenceList(provenance, 'Derived from', review.derivationLinks)
    renderReferenceList(provenance, 'Contradicts', review.contradictionLinks)
    renderReferenceList(provenance, 'Supersedes', review.supersessionLinks)
    startCandidateCountdown()
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function createCandidate() {
    const title = panel.querySelector('[name="memory-title"]').value.trim()
    const content = panel.querySelector('[name="memory-content"]').value.trim()
    const sourceRefs = parseReferenceList(
      panel.querySelector('[name="memory-source-refs"]').value
    )
    const observedAtValue = observedAtInput.value
    if (!title || !content || !observedAtValue || !sourceRefs.length) {
      throw new Error('Title, content, observed time, and provenance are required.')
    }
    setStatus('Persisting encrypted pending candidate and causal trace…')
    const payload = await request('/api/v1/greenfield/memory/candidate', {
      method: 'POST',
      body: JSON.stringify({
        device_id: state.deviceId,
        title,
        content,
        memory_class: panel.querySelector('[name="memory-class"]').value,
        temporal_status: panel.querySelector('[name="memory-temporal-status"]').value,
        observed_at: new Date(observedAtValue).toISOString(),
        valid_from: null,
        valid_until: null,
        privacy_zone: 'private',
        confidence: Number(panel.querySelector('[name="memory-confidence"]').value),
        salience: Number(panel.querySelector('[name="memory-salience"]').value),
        retention_policy: panel
          .querySelector('[name="memory-retention-policy"]')
          .value.trim(),
        source_refs: sourceRefs,
        derivation_links: parseReferenceList(
          panel.querySelector('[name="memory-derived-from"]').value
        ),
        contradiction_links: parseReferenceList(
          panel.querySelector('[name="memory-contradicts"]').value
        ),
        supersession_links: parseReferenceList(
          panel.querySelector('[name="memory-supersedes"]').value
        )
      })
    })
    state.candidateApprovalToken = payload.approval_token
    renderCandidateReview(
      buildMemoryCandidateReview(
        payload.candidate,
        payload.candidate_content,
        payload.candidate_persistence
      )
    )
    setStatus(
      'Pending candidate created. It cannot influence retrieval until you confirm it.',
      'warning'
    )
  }

  async function decideCandidate(decision) {
    if (!state.candidateReview || !state.candidateApprovalToken) {
      throw new Error('No current candidate confirmation challenge is available.')
    }
    setStatus(
      decision === 'owner_confirmed'
        ? 'Confirming durable memory…'
        : 'Rejecting pending candidate…'
    )
    const payload = await request(
      '/api/v1/greenfield/memory/candidate/decision',
      {
        method: 'POST',
        body: JSON.stringify({
          device_id: state.deviceId,
          candidate_id: state.candidateReview.candidateId,
          approval_token: state.candidateApprovalToken,
          decision
        })
      }
    )
    state.candidateApprovalToken = null
    clearTimer('candidateTimer')
    setHidden(panel.querySelector('.memory-candidate-review'), true)
    setStatus(
      decision === 'owner_confirmed'
        ? `Durable memory confirmed and verified as ${payload.memory.memory_id}.`
        : 'Candidate rejected. No durable memory was created.',
      'success'
    )
  }

  function updateScopePresentation() {
    const presentation = getMemoryTimeScopePresentation(timeScopeInput.value)
    const warning = panel.querySelector('.memory-scope-warning')
    warning.replaceChildren(
      createElement('strong', '', presentation.label),
      createElement('p', '', presentation.warning)
    )
    warning.dataset.allowed = presentation.allowed ? 'true' : 'false'
  }

  function updateSelectionCount() {
    panel.querySelector('.memory-selection-count').textContent =
      `${state.selectedMemoryIds.size} selected`
  }

  function renderResults(records, limitations) {
    state.records = records
    state.selectedMemoryIds.clear()
    updateSelectionCount()
    const container = panel.querySelector('.memory-results')
    container.replaceChildren()
    if (limitations.length) {
      const limitationBox = createElement('div', 'memory-limitations')
      renderReferenceList(limitationBox, 'Limitations', limitations)
      container.appendChild(limitationBox)
    }
    if (!records.length) {
      container.appendChild(
        createElement('p', 'memory-empty', 'No confirmed memories matched this scope.')
      )
      return
    }
    for (const record of records) {
      const summary = formatMemoryRecordSummary(record)
      const item = createElement('article', 'memory-result-item')
      const selector = document.createElement('input')
      selector.type = 'checkbox'
      selector.value = summary.id
      selector.setAttribute('aria-label', `Select ${summary.title} for exact purge`)
      selector.addEventListener('change', () => {
        if (selector.checked) state.selectedMemoryIds.add(summary.id)
        else state.selectedMemoryIds.delete(summary.id)
        updateSelectionCount()
      })
      const body = createElement('div', 'memory-result-body')
      const header = createElement('div', 'memory-result-header')
      header.append(
        createElement('strong', '', summary.title),
        createElement('span', '', summary.classification)
      )
      body.append(
        header,
        createElement('p', '', summary.content),
        createElement('code', '', summary.id),
        createElement(
          'small',
          '',
          `Observed ${new Date(summary.observedAt).toLocaleString()} · confidence ${summary.confidence} · salience ${summary.salience} · projection ${summary.projectionStatus}`
        )
      )
      const provenance = createElement('div', 'memory-result-provenance')
      renderReferenceList(provenance, 'Provenance', summary.provenance)
      renderReferenceList(provenance, 'Supersedes', summary.supersedes)
      renderReferenceList(provenance, 'Contradicts', summary.contradicts)
      renderReferenceList(provenance, 'Derived from', summary.derivedFrom)
      body.appendChild(provenance)
      item.append(selector, body)
      container.appendChild(item)
    }
  }

  async function searchMemory() {
    const query = panel.querySelector('[name="memory-query"]').value
    const scope = timeScopeInput.value
    setStatus(
      scope === 'current'
        ? 'Checking the current-state evidence boundary…'
        : 'Searching confirmed owner memory…'
    )
    const payload = await request(
      `/api/v1/greenfield/memory/search?device_id=${encodeURIComponent(
        state.deviceId
      )}&query=${encodeURIComponent(query)}&time_scope=${encodeURIComponent(
        scope
      )}&limit=20`,
      { method: 'GET', headers: {} }
    )
    renderResults(payload.result.records, payload.result.limitations)
    setStatus(
      scope === 'current'
        ? 'Current state was not answered from memory. Fresh evidence is required.'
        : `${payload.result.records.length} confirmed memor${
            payload.result.records.length === 1 ? 'y' : 'ies'
          } retrieved.`,
      scope === 'current' ? 'warning' : 'success'
    )
  }

  async function exportMemory() {
    setStatus('Creating owner-scoped memory export…')
    const payload = await request(
      `/api/v1/greenfield/memory/export?device_id=${encodeURIComponent(
        state.deviceId
      )}`,
      { method: 'GET', headers: {} }
    )
    state.exportBundle = payload.export_bundle
    const blob = new Blob([JSON.stringify(state.exportBundle, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mira-memory-export-${state.exportBundle.bundle_hash}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus(
      `Exported ${state.exportBundle.record_count} owner memory records with bundle verification.`,
      'success'
    )
  }

  function clearSelection() {
    state.selectedMemoryIds.clear()
    for (const input of panel.querySelectorAll('.memory-results input:checked')) {
      input.checked = false
    }
    updateSelectionCount()
  }

  function startPurgeCountdown() {
    clearTimer('purgeTimer')
    state.purgeTimer = setInterval(() => {
      if (!state.purgeReview) return
      const label = formatMemoryRemaining(state.purgeReview.expiresAt)
      panel.querySelector('.memory-purge-expiry').textContent = label
      const expired = label === 'expired'
      panel.querySelector('[data-action="approve-purge"]').disabled = expired
      panel.querySelector('[data-action="execute-purge"]').disabled = expired
    }, 1_000)
  }

  function renderPurgePlan(review) {
    state.purgeReview = review
    state.purgeApproval = null
    state.receipt = null
    purgeAck.checked = false
    const section = panel.querySelector('.memory-purge-review')
    setHidden(section, false)
    setHidden(panel.querySelector('.memory-receipt'), true)
    panel.querySelector('.memory-purge-expiry').textContent = review.expiryLabel
    appendFacts(panel.querySelector('.memory-purge-facts'), [
      ['Plan ID', review.planId],
      ['Risk', review.risk],
      ['Records', review.memoryIds.length],
      ['Scope hash', review.scopeHash],
      ['Reason', review.reasonCode],
      ['Plan hash', review.planHash],
      ['Created', review.createdAt],
      ['Expires', review.expiresAt],
      ['Rollback', review.rollbackSupported ? 'supported' : 'not supported']
    ])
    const scope = panel.querySelector('.memory-purge-scope')
    scope.replaceChildren(createElement('h4', '', 'Exact canonical scope'))
    const list = createElement('ol')
    review.memoryIds.forEach((memoryId, index) => {
      list.appendChild(
        createElement(
          'li',
          '',
          `${memoryId} · record ${review.recordHashes[index] || 'missing hash'}`
        )
      )
    })
    scope.appendChild(list)
    const verification = panel.querySelector('.memory-purge-verification')
    verification.replaceChildren()
    renderReferenceList(
      verification,
      'Verification criteria',
      review.verificationCriteria
    )
    const rollback = panel.querySelector('.memory-purge-rollback')
    rollback.replaceChildren()
    renderReferenceList(rollback, 'Rollback limitations', review.rollbackLimitations)
    panel.querySelector('[data-action="approve-purge"]').hidden = false
    panel.querySelector('[data-action="reject-purge"]').hidden = false
    panel.querySelector('[data-action="execute-purge"]').hidden = true
    startPurgeCountdown()
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function createPurgePlan() {
    const memoryIds = [...state.selectedMemoryIds]
    const reasonCode = panel
      .querySelector('[name="memory-purge-reason"]')
      .value.trim()
    if (!memoryIds.length) throw new Error('Select at least one exact memory record.')
    if (!isMemoryReasonCodeValid(reasonCode)) {
      throw new Error('Reason code must be a stable lowercase identifier.')
    }
    setStatus('Creating encrypted immutable purge plan…')
    const payload = await request('/api/v1/greenfield/memory/purge/plan', {
      method: 'POST',
      body: JSON.stringify({
        device_id: state.deviceId,
        memory_ids: memoryIds,
        reason_code: reasonCode
      })
    })
    state.purgeApprovalToken = payload.approval_token
    renderPurgePlan(buildMemoryPurgeReview(payload.plan))
    setStatus(
      'Purge plan created. Review the exact scope and irreversible limits before deciding.',
      'warning'
    )
  }

  async function decidePurge(decision) {
    if (!state.purgeReview || !state.purgeApprovalToken) {
      throw new Error('No current purge approval challenge is available.')
    }
    if (decision === 'approved' && !purgeAck.checked) {
      throw new Error('Acknowledge the irreversible physical purge before approval.')
    }
    setStatus(
      decision === 'approved'
        ? 'Recording owner approval…'
        : 'Recording owner rejection…'
    )
    const payload = await request('/api/v1/greenfield/memory/purge/decision', {
      method: 'POST',
      body: JSON.stringify({
        device_id: state.deviceId,
        plan_id: state.purgeReview.planId,
        approval_token: state.purgeApprovalToken,
        decision
      })
    })
    state.purgeApprovalToken = null
    state.purgeApproval = payload.approval
    panel.querySelector('[data-action="approve-purge"]').hidden = true
    panel.querySelector('[data-action="reject-purge"]').hidden = true
    panel.querySelector('[data-action="execute-purge"]').hidden =
      decision !== 'approved'
    setStatus(
      decision === 'approved'
        ? 'Owner approval recorded. Physical purge remains a separate action.'
        : 'Purge rejected. No memory was deleted.',
      decision === 'approved' ? 'warning' : 'success'
    )
  }

  function renderReceipt(receipt) {
    state.receipt = receipt
    const section = panel.querySelector('.memory-receipt')
    setHidden(section, false)
    const verified = isVerifiedMemoryPurgeReceipt(receipt)
    const status = panel.querySelector('.memory-receipt-status')
    status.textContent = verified ? 'Verified success' : 'Failed or unverified'
    status.dataset.status = verified ? 'success' : 'error'
    appendFacts(
      panel.querySelector('.memory-receipt-facts'),
      memoryReceiptEvidenceRows(receipt)
    )
    const evidence = panel.querySelector('.memory-receipt-evidence')
    evidence.replaceChildren()
    renderReferenceList(
      evidence,
      'Verification evidence',
      receipt.verification_evidence_refs
    )
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function executePurge() {
    if (!state.purgeReview || state.purgeApproval?.decision !== 'approved') {
      throw new Error('A matching owner approval is required before execution.')
    }
    setStatus('Physically purging exact scope and independently verifying absence…')
    const payload = await request('/api/v1/greenfield/memory/purge/execute', {
      method: 'POST',
      body: JSON.stringify({
        device_id: state.deviceId,
        plan_id: state.purgeReview.planId
      })
    })
    renderReceipt(payload.receipt)
    panel.querySelector('[data-action="execute-purge"]').hidden = true
    clearTimer('purgeTimer')
    clearSelection()
    setStatus(
      isVerifiedMemoryPurgeReceipt(payload.receipt)
        ? 'Exact memory scope was physically deleted and verified absent.'
        : 'Purge did not produce verified success.',
      isVerifiedMemoryPurgeReceipt(payload.receipt) ? 'success' : 'error'
    )
    await searchMemory()
  }

  function closePanel() {
    clearSensitiveState()
    state.selectedMemoryIds.clear()
    setHidden(panel, true)
    launchButton.focus()
  }

  async function handleAction(action) {
    try {
      if (action === 'connect') connect()
      if (action === 'create-candidate') await createCandidate()
      if (action === 'confirm-candidate') await decideCandidate('owner_confirmed')
      if (action === 'reject-candidate') await decideCandidate('rejected')
      if (action === 'search') await searchMemory()
      if (action === 'export') await exportMemory()
      if (action === 'clear-selection') clearSelection()
      if (action === 'plan-purge') await createPurgePlan()
      if (action === 'approve-purge') await decidePurge('approved')
      if (action === 'reject-purge') await decidePurge('rejected')
      if (action === 'execute-purge') await executePurge()
      if (action === 'close') closePanel()
    } catch (error) {
      setStatus(`${error.code ? `${error.code}: ` : ''}${error.message}`, 'error')
    }
  }

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]')
    if (target) handleAction(target.dataset.action)
  })
  timeScopeInput.addEventListener('change', updateScopePresentation)
  launchButton.addEventListener('click', () => {
    setHidden(panel, false)
    setStatus('Authenticate to manage owner-controlled memory.')
    deviceInput.focus()
  })
  document.addEventListener('keydown', (event) => {
    if (panel.hidden) return
    if (event.key === 'Escape') {
      closePanel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...panel.querySelectorAll(
      'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), summary, a[href]'
    )].filter((element) => element.offsetParent !== null)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })

  updateScopePresentation()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountMemoryPanel)
} else {
  mountMemoryPanel()
}
