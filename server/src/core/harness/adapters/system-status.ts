import { createHash } from 'node:crypto'

import type {
  HarnessAdapterExecutionInput,
  HarnessCapabilityAdapter,
  HarnessCapabilityManifest,
  HarnessPreparedContext,
  HarnessStepResult
} from '../contracts'

interface StatusSnapshot {
  status: 'online' | 'degraded'
  observed_at: string
  uptime_seconds: number
  version: string
  routing_mode: string
  llm_provider_ready: boolean
  local_model: string
  limitations: string[]
}

export const SYSTEM_STATUS_HARNESS_CAPABILITY = 'system.status.read'

function snapshotHash(snapshot: StatusSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export class SystemStatusHarnessAdapter implements HarnessCapabilityAdapter {
  public readonly manifest: HarnessCapabilityManifest = {
    capability_id: SYSTEM_STATUS_HARNESS_CAPABILITY,
    name: 'Current Mira system status',
    description:
      'Collect fresh runtime evidence and report Mira availability, version, routing mode, and local model readiness.',
    version: '1.0.0',
    execution_kind: 'evidence',
    required_permissions: [SYSTEM_STATUS_HARNESS_CAPABILITY],
    allowed_privacy_zones: ['private'],
    risk: 'low',
    confirmation: 'never',
    supports_streaming: false,
    supports_cancellation: true,
    supports_handoffs: false,
    input_schema_ref: 'schema://mira/harness/system-status/input/v1',
    output_schema_ref: 'schema://mira/harness/system-status/output/v1',
    provider: 'mira-runtime',
    model: null,
    tags: ['current-awareness', 'evidence', 'runtime']
  }

  public async prepareContext(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessPreparedContext> {
    input.signal.throwIfAborted()
    return {
      context_ref: `context://mira/runtime/${input.task.task_id}`,
      values: {
        requested_at: new Date().toISOString(),
        requested_capability: this.manifest.capability_id
      },
      evidence_refs: [],
      memory_refs: [],
      limitations: []
    }
  }

  public async execute(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult> {
    input.signal.throwIfAborted()
    const { LLM_PROVIDER } = await import('@/core')
    const configuredForLLM = process.env['MIRA_LLM'] === 'true'
    const providerReady = LLM_PROVIDER.isLLMProviderReady
    const limitations: string[] = []

    if (configuredForLLM && !providerReady) {
      limitations.push(
        'An LLM is configured, but the provider is not currently ready.'
      )
    }

    const snapshot: StatusSnapshot = {
      status: configuredForLLM && !providerReady ? 'degraded' : 'online',
      observed_at: new Date().toISOString(),
      uptime_seconds: process.uptime(),
      version: process.env['npm_package_version'] || 'unknown',
      routing_mode: process.env['MIRA_ROUTING_MODE'] || 'smart',
      llm_provider_ready: providerReady,
      local_model: LLM_PROVIDER.localLLMName,
      limitations
    }
    const hash = snapshotHash(snapshot)
    const readiness = snapshot.llm_provider_ready ? 'ready' : 'not ready'
    const answer = [
      `Mira is ${snapshot.status} as of ${snapshot.observed_at}.`,
      `Version: ${snapshot.version}.`,
      `Uptime: ${Math.floor(snapshot.uptime_seconds)} seconds.`,
      `Routing mode: ${snapshot.routing_mode}.`,
      `LLM provider: ${readiness}.`,
      `Local model: ${snapshot.local_model}.`
    ].join(' ')

    return {
      type: 'final',
      message: [{ type: 'text', text: answer }],
      trace_id: input.task.trace_id || input.task.task_id,
      limitations,
      artifacts: [
        {
          name: 'Current runtime evidence',
          kind: 'evidence',
          media_type: 'application/json',
          parts: [{ type: 'json', data: snapshot }],
          privacy_classification: 'private',
          metadata: {
            source_id: 'mira-runtime',
            observed_at: snapshot.observed_at,
            valid_until: new Date(
              Date.parse(snapshot.observed_at) + 30_000
            ).toISOString(),
            content_hash: `sha256:${hash}`,
            confidence: 1
          }
        },
        {
          name: 'Grounded owner answer',
          kind: 'answer',
          media_type: 'text/plain',
          parts: [{ type: 'text', text: answer }],
          privacy_classification: 'private',
          metadata: {
            evidence_content_hash: `sha256:${hash}`,
            limitation_count: limitations.length
          }
        }
      ]
    }
  }
}
