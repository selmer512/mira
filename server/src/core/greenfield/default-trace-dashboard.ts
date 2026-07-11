import { getDefaultGreenfieldTraceStore } from './default-runtime'
import { getDefaultTraceOperationStore } from './default-trace-operations'
import { TraceOperationsDashboardService } from './trace-key-readiness'

let defaultDashboardService: TraceOperationsDashboardService | null = null

export function getDefaultTraceOperationsDashboardService(): TraceOperationsDashboardService {
  if (!defaultDashboardService) {
    defaultDashboardService = TraceOperationsDashboardService.fromProcessEnv(
      getDefaultGreenfieldTraceStore(),
      getDefaultTraceOperationStore()
    )
  }
  return defaultDashboardService
}
