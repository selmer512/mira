/**
 * LeonAPIError — structured error returned by the Frontend SDK.
 *
 * Carries HTTP status, a machine-readable code, a human-readable message and
 * optional retry metadata so callers can implement back-off strategies.
 */
export class LeonAPIError extends Error {
  /** HTTP status code (e.g. 400, 500). 0 means a network/transport error. */
  public readonly status: number

  /** Machine-readable error code (e.g. "missing_params"). */
  public readonly code: string

  /** Whether the operation is safe to retry. */
  public readonly retryable: boolean

  /** Suggested delay (ms) before the next retry attempt. */
  public readonly retryAfterMs: number | null

  constructor(options: {
    message: string
    status: number
    code: string
    retryable?: boolean
    retryAfterMs?: number | null
  }) {
    super(options.message)
    this.name = 'LeonAPIError'
    this.status = options.status
    this.code = options.code
    this.retryable = options.retryable ?? false
    this.retryAfterMs = options.retryAfterMs ?? null
  }

  /**
   * Build a LeonAPIError from a failed fetch Response.
   * Attempts to parse the JSON body for a structured code/message.
   */
  static async fromResponse(response: Response): Promise<LeonAPIError> {
    let code = 'http_error'
    let message = `HTTP ${response.status}`
    const retryable = response.status >= 500 || response.status === 429
    let retryAfterMs: number | null = null

    const retryAfterHeader = response.headers.get('Retry-After')
    if (retryAfterHeader) {
      const seconds = parseInt(retryAfterHeader, 10)
      if (!isNaN(seconds)) {
        retryAfterMs = seconds * 1000
      }
    }

    try {
      const body = (await response.json()) as {
        code?: string
        message?: string
      }
      if (body.code) code = body.code
      if (body.message) message = body.message
    } catch {
      // ignore JSON parse errors
    }

    return new LeonAPIError({ message, status: response.status, code, retryable, retryAfterMs })
  }

  /**
   * Build a LeonAPIError from a network or abort error.
   */
  static fromNetworkError(error: unknown): LeonAPIError {
    const message = error instanceof Error ? error.message : String(error)
    const isAbort =
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')

    return new LeonAPIError({
      message,
      status: 0,
      code: isAbort ? 'request_aborted' : 'network_error',
      retryable: !isAbort,
      retryAfterMs: null
    })
  }
}
