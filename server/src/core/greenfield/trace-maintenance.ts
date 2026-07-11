import {
  TraceStoreError,
  type EncryptedSqliteTraceStore,
  type TraceChainVerification,
  type TracePurgeReceipt
} from './trace-store'

export interface TraceMaintenanceHealth {
  ownerId: string
  observedAt: string
  chain: TraceChainVerification
  traceCount: number
  purgeReceiptCount: number
  migrationVersions: number[]
}

export interface TraceMaintenanceReport {
  ownerId: string
  startedAt: string
  finishedAt: string
  chainBefore: TraceChainVerification
  chainAfter: TraceChainVerification
  tracesBefore: number
  tracesAfter: number
  purgeReceiptsBefore: number
  purgeReceiptsAfter: number
  retentionPurges: TracePurgeReceipt[]
  migrationVersions: number[]
}

export interface TraceMaintenanceServiceConfig {
  ownerId: string
  intervalMinutes: number
  runOnStartup: boolean
}

function parseIntervalMinutes(value: string | undefined): number {
  const parsed = Number(value || 60)
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 10_080) {
    return 60
  }
  return parsed
}

export class TraceMaintenanceService {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<TraceMaintenanceReport> | null = null

  public constructor(
    private readonly store: EncryptedSqliteTraceStore,
    private readonly config: TraceMaintenanceServiceConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  public static configFromProcessEnv(
    env: NodeJS.ProcessEnv = process.env
  ): TraceMaintenanceServiceConfig {
    return {
      ownerId: env['MIRA_GREENFIELD_OWNER_ID'] || '',
      intervalMinutes: parseIntervalMinutes(
        env['MIRA_GREENFIELD_TRACE_MAINTENANCE_INTERVAL_MINUTES']
      ),
      runOnStartup:
        env['MIRA_GREENFIELD_TRACE_MAINTENANCE_ON_STARTUP'] !== 'false'
    }
  }

  public async getHealth(): Promise<TraceMaintenanceHealth> {
    this.assertOwnerConfigured()
    const observedAt = this.now()

    return {
      ownerId: this.config.ownerId,
      observedAt: observedAt.toISOString(),
      chain: await this.store.verifyOwnerChain(this.config.ownerId),
      traceCount: await this.store.countOwnerTraces(this.config.ownerId),
      purgeReceiptCount: (
        await this.store.listPurgeReceipts(this.config.ownerId)
      ).length,
      migrationVersions: this.store.getAppliedMigrationVersions()
    }
  }

  public async runOnce(): Promise<TraceMaintenanceReport> {
    if (this.running) {
      return this.running
    }

    this.running = this.executeMaintenance()
    try {
      return await this.running
    } finally {
      this.running = null
    }
  }

  public start(
    onError: (error: unknown) => void = (): void => undefined
  ): void {
    if (this.timer) {
      return
    }

    const intervalMs = this.config.intervalMinutes * 60_000
    const scheduleNext = (): void => {
      this.timer = setTimeout(async () => {
        try {
          await this.runOnce()
        } catch (error) {
          onError(error)
        } finally {
          scheduleNext()
        }
      }, intervalMs)
      this.timer.unref()
    }

    if (this.config.runOnStartup) {
      void this.runOnce().catch(onError)
    }

    scheduleNext()
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async executeMaintenance(): Promise<TraceMaintenanceReport> {
    this.assertOwnerConfigured()
    const startedAt = this.now()
    const chainBefore = await this.store.verifyOwnerChain(this.config.ownerId)
    if (!chainBefore.valid) {
      throw new TraceStoreError(
        'trace.maintenance_chain_invalid',
        'Retention purge was blocked because trace integrity verification failed.',
        500,
        chainBefore.issue
      )
    }

    const tracesBefore = await this.store.countOwnerTraces(this.config.ownerId)
    const purgeReceiptsBefore = (
      await this.store.listPurgeReceipts(this.config.ownerId)
    ).length
    const retentionPurges = await this.store.purgeExpired(startedAt)
    const chainAfter = await this.store.verifyOwnerChain(this.config.ownerId)
    if (!chainAfter.valid) {
      throw new TraceStoreError(
        'trace.maintenance_post_purge_invalid',
        'Trace integrity verification failed after retention maintenance.',
        500,
        chainAfter.issue
      )
    }

    const tracesAfter = await this.store.countOwnerTraces(this.config.ownerId)
    const purgeReceiptsAfter = (
      await this.store.listPurgeReceipts(this.config.ownerId)
    ).length
    const finishedAt = this.now()

    return {
      ownerId: this.config.ownerId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      chainBefore,
      chainAfter,
      tracesBefore,
      tracesAfter,
      purgeReceiptsBefore,
      purgeReceiptsAfter,
      retentionPurges,
      migrationVersions: this.store.getAppliedMigrationVersions()
    }
  }

  private assertOwnerConfigured(): void {
    if (!this.config.ownerId) {
      throw new TraceStoreError(
        'trace.maintenance_owner_missing',
        'Trace maintenance requires a configured owner ID.',
        503
      )
    }
  }
}
