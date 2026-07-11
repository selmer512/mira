import { getDefaultGreenfieldTraceStore } from './default-runtime'
import { getDefaultTraceOperationStore } from './default-trace-operations'
import { TraceOperationsDashboardService } from './trace-key-readiness'

let defaultDashboardService: Pick<
  TraceOperationsDashboardService,
  'getDashboard'
> | null = null

export function getDefaultTraceOperationsDashboardService(): Pick<
  TraceOperationsDashboardService,
  'getDashboard'
> {
  if (!defaultDashboardService) {
    const traceStore = getDefaultGreenfieldTraceStore()
    const operationStore = getDefaultTraceOperationStore()
    const dashboardService = TraceOperationsDashboardService.fromProcessEnv(
      traceStore,
      operationStore
    )

    defaultDashboardService = {
      getDashboard: async (identity) => {
        traceStore.getAppliedMigrationVersions()
        operationStore.getAppliedMigrationVersions()
        return dashboardService.getDashboard(identity)
      }
    }
  }
  return defaultDashboardService
}
