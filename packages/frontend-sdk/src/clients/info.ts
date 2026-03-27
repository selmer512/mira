import type { HttpAdapter } from '../http-adapter.js'
import type { LeonInfoResponse } from '../types.js'

/**
 * Fetch runtime capabilities from `GET /api/v1/info`.
 *
 * @param adapter - Configured HttpAdapter instance.
 * @param apiVersion - API version string (default: "v1").
 */
export async function getInfo(
  adapter: HttpAdapter,
  apiVersion = 'v1'
): Promise<LeonInfoResponse> {
  return adapter.request<LeonInfoResponse>({
    method: 'GET',
    path: `/api/${apiVersion}/info`
  })
}
