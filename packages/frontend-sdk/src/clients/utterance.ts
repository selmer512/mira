import type { HttpAdapter } from '../http-adapter.js'
import type { LeonUtteranceResponse } from '../types.js'

/**
 * Submit an utterance to `POST /api/v1/utterance`.
 *
 * Requires the server to be started with HTTP API enabled
 * (i.e. `LEON_HTTP_API_KEY` set) and an `apiKey` in the HttpAdapter options.
 *
 * @param adapter - Configured HttpAdapter instance.
 * @param utterance - Natural-language text to send to Leon.
 * @param apiVersion - API version string (default: "v1").
 */
export async function postUtterance(
  adapter: HttpAdapter,
  utterance: string,
  apiVersion = 'v1'
): Promise<LeonUtteranceResponse> {
  return adapter.request<LeonUtteranceResponse>({
    method: 'POST',
    path: `/api/${apiVersion}/utterance`,
    body: { utterance }
  })
}
