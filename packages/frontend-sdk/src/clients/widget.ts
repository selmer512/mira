import type { HttpAdapter } from '../http-adapter.js'
import type { LeonFetchWidgetParams, LeonFetchWidgetResponse } from '../types.js'

/**
 * Fetch a widget component tree via `GET /api/v1/fetch-widget`.
 *
 * @param adapter - Configured HttpAdapter instance.
 * @param params - `skill_action` and `widget_id`.
 * @param apiVersion - API version string (default: "v1").
 */
export async function fetchWidget(
  adapter: HttpAdapter,
  params: LeonFetchWidgetParams,
  apiVersion = 'v1'
): Promise<LeonFetchWidgetResponse> {
  return adapter.request<LeonFetchWidgetResponse>({
    method: 'GET',
    path: `/api/${apiVersion}/fetch-widget`,
    query: {
      skill_action: params.skill_action,
      widget_id: params.widget_id
    }
  })
}
