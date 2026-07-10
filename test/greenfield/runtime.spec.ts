import { describe, expect, it } from 'vitest'

import {
  CapabilityLocalCognitionProvider,
  EnvironmentIdentityResolver,
  GreenfieldExecutionError,
  GreenfieldRequestOrchestrator,
  SYSTEM_STATUS_CAPABILITY,
  SystemStatusEvidenceProvider,
  SystemStatusResponseComposer,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot
} from '@/core/greenfield'

const BASE_TIME = new Date('2026-07-10T18:00:00.000Z')

function createClock(): () => Date {
  let offset = 0
  return () => {
    const value = new Date(BASE_TIME.getTime() + offset)
    offset += 10
    return value
  }
}

function createIds(): () => string {
  let next = 0
  return () => `id-${++next}`
}

function createIdentityResolver(
  overrides: NodeJS.ProcessEnv = {}
): EnvironmentIdentityResolver {
  return EnvironmentIdentityResolver.fromProcessEnv({
    MIRA_GREENFIELD_ENABLED: 'true',
    MIRA_GREENFIELD_OWNER_ID: 'owner-1',
    MIRA_GREENFIELD_PAIRED_DEVICE_ID: 'device-1',
    MIRA_GREENFIELD_PERMISSIONS: SYSTEM_STATUS_CAPABILITY,
    MIRA_GREENFIELD_PRIVACY_ZONES: 'private',
    ...overrides
  })
}

class AvailableStatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    return {
      status: 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: 42,
      version: '1.0.0-test',
      routing_mode: 'smart',
      llm_provider_ready: true,
      local_model: 'MiniCPM5-1B-candidate',
      limitations: []
    }
  }
}

class FailingStatusReader implements RuntimeStatusReader {
  public async read(): Promise<RuntimeStatusSnapshot> {
    throw new Error('runtime source offline')
  }
}

function createOrchestrator(
  statusReader: RuntimeStatusReader,
  identityResolver = createIdentityResolver()
): GreenfieldRequestOrchestrator {
  return new GreenfieldRequestOrchestrator({
    identityResolver,
    localCognitionProvider: new CapabilityLocalCognitionProvider(),
    evidenceProvider: new SystemStatusEvidenceProvider(statusReader),
    responseComposer: new SystemStatusResponseComposer(),
    now: createClock(),
    createId: createIds()
  })
}

describe('greenfield request runtime', () => {
  it('creates an authenticated, traced, current-evidence response', async () => {
    const result = await createOrchestrator(
      new AvailableStatusReader()
    ).execute({
      device_id: 'device-1',
      capability: SYSTEM_STATUS_CAPABILITY,
      input: 'Report the current Mira system status.',
      credential: 'test-api-key'
    })

    expect(result.answer).toContain('Mira is online')
    expect(result.envelope.identity.owner_id).toBe('owner-1')
    expect(result.envelope.identity.device_id).toBe('device-1')
    expect(result.envelope.routing.time_scope).toBe('current')
    expect(result.envelope.routing.evidence_requirement).toBe('required')
    expect(result.envelope.evidence).toHaveLength(1)
    expect(result.envelope.response.evidence_refs).toHaveLength(1)
    expect(result.envelope.action).toBeNull()
    expect(result.envelope.memory_candidate).toBeNull()
    expect(result.envelope.spans).toHaveLength(4)
    expect(result.envelope.operational_states.map((event) => event.state)).toEqual([
      'thinking_locally',
      'using_tool',
      'speaking'
    ])
  })

  it('returns an explicit limitation instead of stale or invented status', async () => {
    const result = await createOrchestrator(
      new FailingStatusReader()
    ).execute({
      device_id: 'device-1',
      capability: SYSTEM_STATUS_CAPABILITY,
      input: 'Report the current Mira system status.',
      credential: 'test-api-key'
    })

    expect(result.envelope.evidence).toEqual([])
    expect(result.envelope.response.evidence_refs).toEqual([])
    expect(result.envelope.response.limitations[0]).toContain(
      'runtime source offline'
    )
    expect(result.answer).toContain('cannot confirm')
  })

  it('rejects a device that is not paired by server configuration', async () => {
    const execution = createOrchestrator(new AvailableStatusReader()).execute({
      device_id: 'attacker-device',
      capability: SYSTEM_STATUS_CAPABILITY,
      input: 'Report the current Mira system status.',
      credential: 'test-api-key'
    })

    await expect(execution).rejects.toMatchObject<
      Partial<GreenfieldExecutionError>
    >({
      code: 'identity.device_not_paired',
      statusCode: 403
    })
  })

  it('is deny-by-default when the greenfield path is disabled', async () => {
    const resolver = createIdentityResolver({
      MIRA_GREENFIELD_ENABLED: 'false'
    })
    const execution = createOrchestrator(
      new AvailableStatusReader(),
      resolver
    ).execute({
      device_id: 'device-1',
      capability: SYSTEM_STATUS_CAPABILITY,
      input: 'Report the current Mira system status.',
      credential: 'test-api-key'
    })

    await expect(execution).rejects.toMatchObject<
      Partial<GreenfieldExecutionError>
    >({
      code: 'greenfield.disabled',
      statusCode: 503
    })
  })
})
