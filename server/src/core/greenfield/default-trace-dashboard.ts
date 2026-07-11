import { getDefaultGreenfieldTraceStore } from './default-runtime'
import { getDefaultTraceOperationStore } from './default-trace-operations'
import { getDefaultTraceReadKeyring } from './default-trace-rotation'
import {
  TraceOperationsDashboardService,
  type TraceOperationsDashboard
} from './trace-key-readiness'

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
    const keyring = getDefaultTraceReadKeyring()
    const dashboardService = TraceOperationsDashboardService.fromProcessEnv(
      traceStore,
      operationStore
    )

    defaultDashboardService = {
      getDashboard: async (identity): Promise<TraceOperationsDashboard> => {
        traceStore.getAppliedMigrationVersions()
        operationStore.getAppliedMigrationVersions()
        const dashboard = await dashboardService.getDashboard(identity)
        const inventory = keyring.getOwnerInventory(identity)
        const versions = keyring.getVersionInventory(identity.owner_id)
        const removableSetupBlockers = new Set([
          'rotation.stable_owner_lookup_not_implemented',
          'rotation.multi_key_keyring_not_implemented',
          'rotation.unregistered_trace_key_detected',
          'rotation.foreign_trace_key_detected'
        ])
        const blockers = dashboard.readiness.blockers.filter(
          (blocker) => !removableSetupBlockers.has(blocker)
        )
        blockers.push(...inventory.blockers)
        const uniqueBlockers = [...new Set(blockers)]
        const activeUnexpired = inventory.plans.filter(
          (plan) => !plan.expired && plan.receipt === null
        ).length
        const approvedUnexecuted = inventory.plans.filter(
          (plan) =>
            plan.approval_decision === 'approved' && plan.receipt === null
        ).length
        const verifiedReceipts = inventory.plans.filter(
          (plan) =>
            plan.receipt?.execution_status === 'succeeded' &&
            plan.receipt.verification_status === 'succeeded'
        ).length
        const traceTotal =
          inventory.traces.length + inventory.unreadable_trace_ids.length
        const planTotal =
          inventory.plans.length + inventory.unreadable_plan_ids.length

        return {
          ...dashboard,
          readiness: {
            ...dashboard.readiness,
            status:
              uniqueBlockers.length > 0
                ? 'blocked'
                : dashboard.readiness.warnings.length > 0
                  ? 'attention_required'
                  : 'ready',
            chain: inventory.chain,
            trace_inventory: {
              total: traceTotal,
              catalog_count: inventory.traces.length,
              catalog_truncated: traceTotal > inventory.traces.length,
              active_key_count: versions
                .filter((version) => version.active)
                .reduce((sum, version) => sum + version.trace_count, 0),
              unknown_key_version_count: inventory.unreadable_trace_ids.length,
              versions
            },
            operation_inventory: {
              total: planTotal,
              active_unexpired: activeUnexpired,
              approved_unexecuted: approvedUnexecuted,
              unreadable_with_active_key:
                inventory.unreadable_plan_ids.length,
              verified_receipts: verifiedReceipts
            },
            blockers: uniqueBlockers
          },
          traces: inventory.traces,
          plans: inventory.plans
        }
      }
    }
  }
  return defaultDashboardService
}
