import type {
  HarnessCapabilityAdapter,
  HarnessCapabilityManifest,
  HarnessCard
} from './contracts'

const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/

export class HarnessRegistryError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'HarnessRegistryError'
  }
}

function validateManifest(manifest: HarnessCapabilityManifest): void {
  if (!CAPABILITY_ID_PATTERN.test(manifest.capability_id)) {
    throw new HarnessRegistryError(
      'harness.capability_id_invalid',
      `Capability ID is invalid: ${manifest.capability_id}`
    )
  }
  if (manifest.required_permissions.length === 0) {
    throw new HarnessRegistryError(
      'harness.capability_permissions_missing',
      `Capability ${manifest.capability_id} must declare at least one permission.`
    )
  }
  if (manifest.allowed_privacy_zones.length === 0) {
    throw new HarnessRegistryError(
      'harness.capability_privacy_zone_missing',
      `Capability ${manifest.capability_id} must declare at least one privacy zone.`
    )
  }
}

function cloneManifest(
  manifest: HarnessCapabilityManifest
): HarnessCapabilityManifest {
  return structuredClone(manifest)
}

export class HarnessCapabilityRegistry {
  private readonly adapters = new Map<string, HarnessCapabilityAdapter>()

  public register(adapter: HarnessCapabilityAdapter): void {
    validateManifest(adapter.manifest)
    const capabilityId = adapter.manifest.capability_id
    if (this.adapters.has(capabilityId)) {
      throw new HarnessRegistryError(
        'harness.capability_duplicate',
        `Capability ${capabilityId} is already registered.`
      )
    }
    this.adapters.set(capabilityId, adapter)
  }

  public get(capabilityId: string): HarnessCapabilityAdapter {
    const adapter = this.adapters.get(capabilityId)
    if (!adapter) {
      throw new HarnessRegistryError(
        'harness.capability_not_found',
        'The requested harness capability is not available.'
      )
    }
    return adapter
  }

  public list(): HarnessCapabilityManifest[] {
    return [...this.adapters.values()]
      .map((adapter) => cloneManifest(adapter.manifest))
      .sort((left, right) => left.capability_id.localeCompare(right.capability_id))
  }

  public createCard(
    allowedPermissions: string[],
    privacyZones: string[]
  ): HarnessCard {
    const permissionSet = new Set(allowedPermissions)
    const privacySet = new Set(privacyZones)
    const capabilities = this.list().filter(
      (manifest) =>
        manifest.required_permissions.every((permission) =>
          permissionSet.has(permission)
        ) &&
        manifest.allowed_privacy_zones.some((zone) => privacySet.has(zone))
    )

    return {
      harness_id: 'mira.owner-harness',
      name: 'Mira Owner AI Harness',
      version: '0.1.0',
      protocol_version: '2026-07-15',
      description:
        'A provider-independent, owner-controlled task harness for evidence, models, tools, agents, actions, verification, and memory.',
      capabilities,
      features: {
        task_lifecycle: true,
        event_stream: true,
        idempotency: true,
        cancellation: true,
        approvals: true,
        handoffs: true,
        sessions: true,
        capability_negotiation: true
      },
      interoperability: {
        mcp_ready_ports: true,
        a2a_task_semantics: true,
        otel_genai_trace_attributes: true
      }
    }
  }
}
