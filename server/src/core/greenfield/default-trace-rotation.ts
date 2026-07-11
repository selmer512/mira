import { TraceReadKeyring } from './trace-keyring'
import { TraceRotationPlanner } from './trace-rotation-plan'

let defaultTraceReadKeyring: TraceReadKeyring | null = null
let defaultTraceRotationPlanner: TraceRotationPlanner | null = null

export function getDefaultTraceReadKeyring(): TraceReadKeyring {
  if (!defaultTraceReadKeyring) {
    defaultTraceReadKeyring = TraceReadKeyring.fromProcessEnv()
  }
  return defaultTraceReadKeyring
}

export function getDefaultTraceRotationPlanner(): TraceRotationPlanner {
  if (!defaultTraceRotationPlanner) {
    defaultTraceRotationPlanner = TraceRotationPlanner.fromProcessEnv(
      getDefaultTraceReadKeyring()
    )
  }
  return defaultTraceRotationPlanner
}
