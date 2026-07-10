import { LogHelper } from '@/helpers/log-helper'

import { getDefaultGreenfieldTraceStore } from './default-runtime'
import {
  TraceMaintenanceService,
  type TraceMaintenanceHealth
} from './trace-maintenance'

let defaultMaintenanceService: TraceMaintenanceService | null = null

export function getDefaultTraceMaintenanceService(): TraceMaintenanceService {
  if (!defaultMaintenanceService) {
    defaultMaintenanceService = new TraceMaintenanceService(
      getDefaultGreenfieldTraceStore(),
      TraceMaintenanceService.configFromProcessEnv()
    )
  }

  return defaultMaintenanceService
}

export async function startDefaultTraceMaintenance(): Promise<
  TraceMaintenanceHealth | null
> {
  if (
    process.env['MIRA_GREENFIELD_ENABLED'] !== 'true' ||
    process.env['MIRA_GREENFIELD_TRACE_PERSISTENCE'] !== 'true'
  ) {
    return null
  }

  const service = getDefaultTraceMaintenanceService()
  const health = await service.getHealth()
  if (!health.chain.valid) {
    throw new Error(
      `Greenfield trace chain is invalid: ${health.chain.issue || 'unknown issue'}`
    )
  }

  service.start((error) => {
    LogHelper.error(
      `Greenfield trace maintenance failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  })

  return health
}
