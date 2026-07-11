import '../css/trace-rotation.scss'

import {
  buildRotationPlanReview,
  formatBytes,
  isKeyVersionValid
} from './trace-rotation-model'

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

function appendFacts(container, rows) {
  container.replaceChildren()
  for (const [label, value] of rows) {
    container.append(
      createElement('dt', '', label),
      createElement('dd', '', String(value))
    )
  }
}

function appendList(container, title, values, emptyText) {
  container.replaceChildren(createElement('h4', '', title))
  const list = createElement('ul')
  if (!values.length) {
    list.appendChild(createElement('li', '', emptyText))
  } else {
    for (const value of values) {
      list.appendChild(createElement('li', '', String(value)))
    }
  }
  container.appendChild(list)
}

function mountTraceRotationPanel() {
  const topContainer = document.querySelector('#top-container')
  if (!topContainer || document.querySelector('#trace-rotation-button')) {
    return
  }

  const launchButton = createElement(
    'button',
    'trace-rotation-launch',
    'Rotation plan'
  )
  launchButton.id = 'trace-rotation-button'
  launchButton.type = 'button'
  launchButton.setAttribute('aria-haspopup', 'dialog')
  topContainer.appendChild(launchButton)

  const panel = createElement('section', 'trace-rotation-panel')
  panel.id = 'trace-rotation-panel'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', 'trace-rotation-title')
  panel.setAttribute('aria-hidden', 'true')
  panel.innerHTML = `
    <div class="trace-rotation-backdrop" data-action="close"></div>
    <div class="trace-rotation-shell">
      <header class="trace-rotation-header">
        <div>
          <p class="trace-rotation-eyebrow">Owner-controlled preparation</p>
          <h2 id="trace-rotation-title">Trace key rotation plan</h2>
          <p>Calculate exact scope, backup evidence, storage headroom, checkpoints, verification, and rollback limits.</p>
        </div>
        <button class="trace-rotation-close" type="button" data-action="close" aria-label="Close rotation planning">×</button>
      </header>

      <div class="trace-rotation-boundary" role="note">
        <strong>Planning only.</strong>
        <span>This interface cannot approve or execute re-encryption.</span>
      </div>
      <div class="trace-rotation-status" role="status" aria-live="polite"></div>

      <section class="trace-rotation-card" aria-labelledby="rotation-auth-title">
        <h3 id="rotation-auth-title">Authenticate and choose a registered target</h3>
        <div class="trace-rotation-fields">
          <label>
            <span>Paired device ID</span>
            <input name="rotation-device-id" type="text" autocomplete="off" spellcheck="false" />
          </label>
          <label>
            <span>API key</span>
            <input name="rotation-api-key" type="password" autocomplete="off" spellcheck="false" />
          </label>
          <label>
            <span>Target key version</span>
            <input name="rotation-target-version" type="text" value="v2" autocomplete="off" spellcheck="false" />
          </label>
          <button type="button" data-action="create-plan">Create non-destructive plan</button>
        </div>
        <p class="trace-rotation-help">Credentials remain in memory only and are cleared when this panel closes.</p>
      </section>

      <div class="trace-rotation-result" hidden>
        <section class="trace-rotation-card" aria-labelledby="rotation-summary-title">
          <div class="trace-rotation-card-header">
            <div>
              <p class="trace-rotation-eyebrow">Immutable evidence</p>
              <h3 id="rotation-summary-title">Plan summary</h3>
            </div>
            <span class="trace-rotation-readiness">Not executable</span>
          </div>
          <dl class="trace-rotation-facts"></dl>
        </section>

        <section class="trace-rotation-grid" aria-label="Rotation prerequisites">
          <article class="trace-rotation-card trace-rotation-backup">
            <h3>Backup evidence</h3>
            <strong class="trace-rotation-backup-label"></strong>
            <p class="trace-rotation-backup-detail"></p>
            <dl class="trace-rotation-backup-facts"></dl>
          </article>
          <article class="trace-rotation-card trace-rotation-storage">
            <h3>Storage headroom</h3>
            <strong class="trace-rotation-storage-label"></strong>
            <p class="trace-rotation-storage-detail"></p>
            <dl class="trace-rotation-storage-facts"></dl>
          </article>
        </section>

        <section class="trace-rotation-card" aria-labelledby="rotation-blockers-title">
          <h3 id="rotation-blockers-title">Deterministic blockers</h3>
          <div class="trace-rotation-blockers"></div>
        </section>

        <section class="trace-rotation-card" aria-labelledby="rotation-scope-title">
          <h3 id="rotation-scope-title">Exact protected scope</h3>
          <div class="trace-rotation-scope-summary"></div>
          <details>
            <summary>Trace IDs and record hashes</summary>
            <div class="trace-rotation-traces"></div>
          </details>
          <details>
            <summary>Operation plan IDs</summary>
            <div class="trace-rotation-operation-plans"></div>
          </details>
        </section>

        <section class="trace-rotation-grid" aria-label="Rotation controls and recovery">
          <article class="trace-rotation-card trace-rotation-checkpoints"></article>
          <article class="trace-rotation-card trace-rotation-verification"></article>
        </section>

        <section class="trace-rotation-card trace-rotation-rollback" aria-labelledby="rotation-rollback-title">
          <h3 id="rotation-rollback-title">Rollback limits</h3>
          <div class="trace-rotation-rollback-list"></div>
        </section>
      </div>
    </div>
  `
  document.body.appendChild(panel)

  const state = {
    apiKey: '',
    deviceId: '',
    targetVersion: '',
    plan: null
  }
  const statusElement = panel.querySelector('.trace-rotation-status')
  const resultElement = panel.querySelector('.trace-rotation-result')
  const deviceInput = panel.querySelector('[name="rotation-device-id"]')
  const apiKeyInput = panel.querySelector('[name="rotation-api-key"]')
  const targetVersionInput = panel.querySelector(
    '[name="rotation-target-version"]'
  )

  function setStatus(message, type = 'neutral') {
    statusElement.textContent = message
    statusElement.dataset.type = type
  }

  function clearSensitiveState() {
    state.apiKey = ''
    state.deviceId = ''
    state.targetVersion = ''
    state.plan = null
    apiKeyInput.value = ''
    deviceInput.value = ''
    setHidden(resultElement, true)
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
      const error = new Error(
        payload.message || `Request failed (${response.status}).`
      )
      error.code = payload.code || 'client.request_failed'
      throw error
    }
    return payload
  }

  function renderExactScope(review) {
    panel.querySelector('.trace-rotation-scope-summary').textContent =
      `${review.traceCount} trace record${review.traceCount === 1 ? '' : 's'} and ${
        review.operationPlanCount
      } operation plan${review.operationPlanCount === 1 ? '' : 's'}.`

    const traceContainer = panel.querySelector('.trace-rotation-traces')
    traceContainer.replaceChildren()
    if (!review.traceIds.length) {
      traceContainer.appendChild(
        createElement('p', 'trace-rotation-empty', 'No owner trace records are in scope.')
      )
    } else {
      const list = createElement('ol')
      review.traceIds.forEach((traceId, index) => {
        const item = createElement('li')
        item.append(
          createElement('code', '', traceId),
          createElement('small', '', `Record hash ${review.recordHashes[index]}`)
        )
        list.appendChild(item)
      })
      traceContainer.appendChild(list)
    }

    appendList(
      panel.querySelector('.trace-rotation-operation-plans'),
      'Operation plans',
      review.operationPlanIds,
      'No encrypted operation plans are in scope.'
    )
  }

  function renderPlan(plan) {
    const review = buildRotationPlanReview(plan)
    state.plan = review
    setHidden(resultElement, false)

    appendFacts(panel.querySelector('.trace-rotation-facts'), [
      ['Rotation plan ID', review.planId],
      ['Plan hash', review.planHash],
      ['Source key versions', review.sourceVersions.join(', ') || 'none'],
      ['Target key version', review.targetVersion],
      ['Target key fingerprint', review.targetKeyId],
      ['Trace records', review.traceCount],
      ['Operation plans', review.operationPlanCount],
      ['Created', new Date(review.createdAt).toLocaleString()],
      ['Expires', new Date(review.expiresAt).toLocaleString()],
      ['Execution supported', 'no']
    ])

    const backupCard = panel.querySelector('.trace-rotation-backup')
    backupCard.dataset.status = review.backupStatus.status
    panel.querySelector('.trace-rotation-backup-label').textContent =
      review.backupStatus.label
    panel.querySelector('.trace-rotation-backup-detail').textContent =
      review.backupStatus.detail
    appendFacts(panel.querySelector('.trace-rotation-backup-facts'), [
      ['Reference', review.backup.path_ref || 'none'],
      ['Size', formatBytes(review.backup.size_bytes)],
      ['Integrity', review.backup.integrity_check || 'unavailable'],
      ['Migrations', review.backup.migration_versions.join(', ') || 'none'],
      ['Verified', new Date(review.backup.verified_at).toLocaleString()]
    ])

    const storageCard = panel.querySelector('.trace-rotation-storage')
    storageCard.dataset.status = review.storage.status
    panel.querySelector('.trace-rotation-storage-label').textContent =
      review.storage.label
    panel.querySelector('.trace-rotation-storage-detail').textContent =
      review.storage.detail
    appendFacts(panel.querySelector('.trace-rotation-storage-facts'), [
      ['Estimated rewrite', formatBytes(review.estimatedRewriteBytes)],
      ['Required free space', formatBytes(review.requiredFreeBytes)],
      ['Available free space', formatBytes(review.availableFreeBytes)]
    ])

    appendList(
      panel.querySelector('.trace-rotation-blockers'),
      'Current blockers',
      review.blockers,
      'No blockers were reported.'
    )
    renderExactScope(review)
    appendList(
      panel.querySelector('.trace-rotation-checkpoints'),
      'Interruption checkpoints',
      review.checkpoints,
      'No checkpoints were supplied.'
    )
    appendList(
      panel.querySelector('.trace-rotation-verification'),
      'Verification criteria',
      review.verificationCriteria,
      'No verification criteria were supplied.'
    )
    appendList(
      panel.querySelector('.trace-rotation-rollback-list'),
      'Rollback limits',
      review.rollbackLimits,
      'No rollback limits were supplied.'
    )
    resultElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function createPlan() {
    state.deviceId = deviceInput.value.trim()
    state.apiKey = apiKeyInput.value
    state.targetVersion = targetVersionInput.value.trim()
    if (!state.deviceId || !state.apiKey) {
      throw new Error('Enter the paired device ID and API key.')
    }
    if (!isKeyVersionValid(state.targetVersion)) {
      throw new Error('Target key version must be a stable lowercase identifier.')
    }
    setStatus('Calculating exact non-destructive rotation evidence…')
    const payload = await request('/api/v1/greenfield/trace-rotation/plan', {
      method: 'POST',
      body: JSON.stringify({
        device_id: state.deviceId,
        target_key_version: state.targetVersion
      })
    })
    renderPlan(payload.plan)
    setStatus(
      'Rotation plan persisted. No owner records were rewritten or approved.',
      'success'
    )
  }

  function closePanel() {
    clearSensitiveState()
    setHidden(panel, true)
    launchButton.focus()
  }

  async function handleAction(action) {
    try {
      if (action === 'create-plan') await createPlan()
      if (action === 'close') closePanel()
    } catch (error) {
      setStatus(`${error.code ? `${error.code}: ` : ''}${error.message}`, 'error')
    }
  }

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]')
    if (target) handleAction(target.dataset.action)
  })
  launchButton.addEventListener('click', () => {
    setHidden(panel, false)
    setStatus(
      'Enter owner credentials and a registered non-active target key version.'
    )
    deviceInput.focus()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePanel()
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountTraceRotationPanel)
} else {
  mountTraceRotationPanel()
}
