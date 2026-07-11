import {
  GreenfieldExecutionError,
  GreenfieldRequestOrchestrator,
  type GreenfieldExecutionInput,
  type GreenfieldExecutionResult,
  type GreenfieldRuntimeDependencies
} from './runtime'
import {
  EncryptedSqliteTraceStore,
  TraceStoreError,
  type TracePersistenceReceipt
} from './trace-store'

export interface PersistedGreenfieldExecutionResult
  extends GreenfieldExecutionResult {
  trace_persistence: TracePersistenceReceipt
}

export class PersistingGreenfieldRequestOrchestrator extends GreenfieldRequestOrchestrator {
  public constructor(
    dependencies: GreenfieldRuntimeDependencies,
    private readonly traceStore: EncryptedSqliteTraceStore
  ) {
    super(dependencies)
  }

  public override async execute(
    request: GreenfieldExecutionInput
  ): Promise<PersistedGreenfieldExecutionResult> {
    const result = await super.execute(request)

    try {
      const tracePersistence = await this.traceStore.append(result.envelope)
      return {
        ...result,
        trace_persistence: tracePersistence
      }
    } catch (error) {
      if (error instanceof TraceStoreError) {
        throw new GreenfieldExecutionError(
          error.code,
          error.message,
          error.statusCode,
          error.details
        )
      }

      throw new GreenfieldExecutionError(
        'trace.persistence_failed',
        'The request completed but its causal trace could not be durably persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
