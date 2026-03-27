import { LeonAPIError } from './error.js'

export interface HttpAdapterOptions {
  /** Base URL of the Leon server, e.g. "http://localhost:1337" */
  baseUrl: string
  /** Optional API key sent in the `X-Leon-Api-Key` header. */
  apiKey?: string
  /** Default request timeout in milliseconds. Default: 10 000 */
  timeoutMs?: number
}

interface RequestOptions {
  method?: string
  path: string
  body?: unknown
  query?: Record<string, string>
  /** Per-request timeout override. Pass `0` to disable timeout. */
  timeoutMs?: number
  /** External AbortSignal to cancel the request. */
  signal?: AbortSignal
}

/**
 * Minimal HTTP adapter used by all Leon API client methods.
 *
 * Handles:
 * - Base-URL + path joining
 * - JSON serialisation / deserialisation
 * - Timeout via AbortSignal.timeout()
 * - External AbortSignal composition
 * - Structured LeonAPIError on non-2xx responses
 */
export class HttpAdapter {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined
  private readonly defaultTimeoutMs: number

  constructor(options: HttpAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.defaultTimeoutMs = options.timeoutMs ?? 10_000
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const {
      method = 'GET',
      path,
      body,
      query,
      signal: externalSignal
    } = options

    const timeoutMs =
      options.timeoutMs !== undefined ? options.timeoutMs : this.defaultTimeoutMs

    // Build URL
    let url = `${this.baseUrl}${path}`
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(query)
      url = `${url}?${params.toString()}`
    }

    // Compose abort signals (timeout + optional external)
    const signals: AbortSignal[] = []
    if (timeoutMs > 0) {
      signals.push(AbortSignal.timeout(timeoutMs))
    }
    if (externalSignal) {
      signals.push(externalSignal)
    }
    const signal =
      signals.length === 0
        ? undefined
        : signals.length === 1
          ? signals[0]
          : AbortSignal.any(signals)

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    if (this.apiKey) {
      headers['X-Leon-Api-Key'] = this.apiKey
    }

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal
      })
    } catch (error) {
      throw LeonAPIError.fromNetworkError(error)
    }

    if (!response.ok) {
      throw await LeonAPIError.fromResponse(response)
    }

    return (await response.json()) as T
  }
}
