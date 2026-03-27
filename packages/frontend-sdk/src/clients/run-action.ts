import type { HttpAdapter } from '../http-adapter.js'
import type { LeonRunActionParams, LeonRunActionResponse } from '../types.js'

/**
 * Execute a skill action directly via `POST /api/v1/run-action`.
 *
 * @param adapter - Configured HttpAdapter instance.
 * @param params - `skill_action` (e.g. `"todos:create-todo"`) and `action_params`.
 * @param apiVersion - API version string (default: "v1").
 */
export async function runAction(
  adapter: HttpAdapter,
  params: LeonRunActionParams,
  apiVersion = 'v1'
): Promise<LeonRunActionResponse> {
  return adapter.request<LeonRunActionResponse>({
    method: 'POST',
    path: `/api/${apiVersion}/run-action`,
    body: params
  })
}
