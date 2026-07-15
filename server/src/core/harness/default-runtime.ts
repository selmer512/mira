import { getDefaultGreenfieldIdentityResolver } from '@/core/greenfield/default-runtime'

import { SystemStatusHarnessAdapter } from './adapters/system-status'
import { createDefaultHarnessGuardrails } from './guardrails'
import { HarnessHookBus } from './hooks'
import { MiraHarnessKernel } from './kernel'
import { HarnessCapabilityRegistry } from './registry'
import { EncryptedSqliteHarnessTaskStore } from './sqlite-store'
import { InMemoryHarnessTaskStore, type HarnessTaskStore } from './store'

let defaultHarness: MiraHarnessKernel | null = null

function createDefaultStore(): HarnessTaskStore {
  return process.env['MIRA_HARNESS_PERSISTENCE'] === 'true'
    ? EncryptedSqliteHarnessTaskStore.fromProcessEnv()
    : new InMemoryHarnessTaskStore()
}

export function createDefaultMiraHarness(): MiraHarnessKernel {
  const registry = new HarnessCapabilityRegistry()
  registry.register(new SystemStatusHarnessAdapter())

  return new MiraHarnessKernel({
    identityResolver: getDefaultGreenfieldIdentityResolver(),
    registry,
    store: createDefaultStore(),
    hooks: new HarnessHookBus(),
    guardrails: createDefaultHarnessGuardrails(),
    maxSteps: Number(process.env['MIRA_HARNESS_MAX_STEPS'] || 12),
    executionTimeoutMs: Number(
      process.env['MIRA_HARNESS_EXECUTION_TIMEOUT_MS'] || 120_000
    )
  })
}

export function getDefaultMiraHarness(): MiraHarnessKernel {
  if (!defaultHarness) {
    defaultHarness = createDefaultMiraHarness()
  }
  return defaultHarness
}
