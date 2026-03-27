import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpAdapter } from '../src/http-adapter.js'
import { LeonAPIError } from '../src/error.js'
import { getInfo } from '../src/clients/info.js'
import { postUtterance } from '../src/clients/utterance.js'
import { runAction } from '../src/clients/run-action.js'
import { fetchWidget } from '../src/clients/widget.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INFO_SUCCESS_FIXTURE = {
  success: true,
  status: 200,
  code: 'info_pulled',
  message: 'Information pulled.',
  after_speech: false,
  telemetry: false,
  shouldWarmUpLLMDuties: false,
  isLLMActionRecognitionEnabled: false,
  isLLMNLGEnabled: false,
  timeZone: 'UTC',
  gpu: 'None',
  graphicsComputeAPI: 'None',
  totalVRAM: 0,
  freeVRAM: 0,
  usedVRAM: 0,
  llm: {
    enabled: false,
    provider: 'openai',
    workflowProvider: 'openai',
    agentProvider: 'openai',
    workflowModel: 'gpt-4o',
    agentModel: 'gpt-4o',
    localModel: ''
  },
  stt: { enabled: false, provider: 'google' },
  tts: { enabled: false, provider: 'google' },
  routingMode: 'llm',
  tcpServer: { enabled: false },
  mood: { type: 'neutral', emoji: '😐' },
  version: '1.0.0-beta.10'
}

const UTTERANCE_SUCCESS_FIXTURE = {
  success: true,
  status: 200,
  code: 'utterance_processed',
  message: 'Utterance processed.',
  output: { speech: 'Hello!' }
}

const RUN_ACTION_SUCCESS_FIXTURE = {
  success: true,
  status: 200,
  code: 'action_executed',
  message: 'Skill action executed successfully.',
  result: { lastOutputFromSkill: { speech: 'Timer set.' } }
}

const FETCH_WIDGET_SUCCESS_FIXTURE = {
  success: true,
  status: 200,
  code: 'widget_fetched',
  message: 'Widget fetched successfully.',
  widget: { type: 'List', items: [] }
}

const ERROR_FIXTURE_400 = {
  success: false,
  status: 400,
  code: 'missing_params',
  message: 'skill_action and action_params are missing.'
}

const ERROR_FIXTURE_500 = {
  success: false,
  status: 500,
  code: 'run_action_error',
  message: 'Failed to execute skill action.'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function makeErrorResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HttpAdapter', () => {
  let adapter: HttpAdapter

  beforeEach(() => {
    adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
  })

  it('builds correct URL from baseUrl + path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({ ok: true })
    )
    await adapter.request({ path: '/api/v1/info' })
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:1337/api/v1/info',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('appends query parameters to the URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({})
    )
    await adapter.request({
      path: '/api/v1/fetch-widget',
      query: { skill_action: 'todos:list', widget_id: 'w1' }
    })
    const calledUrl = (fetchSpy.mock.calls[0] as unknown[])[0] as string
    expect(calledUrl).toContain('skill_action=todos%3Alist')
    expect(calledUrl).toContain('widget_id=w1')
  })

  it('sends JSON body for POST requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({})
    )
    await adapter.request({
      method: 'POST',
      path: '/api/v1/utterance',
      body: { utterance: 'hello' }
    })
    const init = (fetchSpy.mock.calls[0] as unknown[])[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ utterance: 'hello' }))
  })

  it('adds X-Leon-Api-Key header when apiKey is provided', async () => {
    const authedAdapter = new HttpAdapter({
      baseUrl: 'http://localhost:1337',
      apiKey: 'test-key-123'
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({})
    )
    await authedAdapter.request({ path: '/api/v1/utterance', method: 'POST' })
    const init = (fetchSpy.mock.calls[0] as unknown[])[1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Leon-Api-Key']).toBe(
      'test-key-123'
    )
  })

  it('throws LeonAPIError with correct fields on 4xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse(ERROR_FIXTURE_400, 400)
    )
    await expect(
      adapter.request({ method: 'POST', path: '/api/v1/run-action' })
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as LeonAPIError
      return (
        e instanceof LeonAPIError &&
        e.status === 400 &&
        e.code === 'missing_params' &&
        e.retryable === false
      )
    })
  })

  it('throws LeonAPIError marked retryable on 5xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse(ERROR_FIXTURE_500, 500)
    )
    await expect(
      adapter.request({ method: 'POST', path: '/api/v1/run-action' })
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as LeonAPIError
      return e instanceof LeonAPIError && e.status === 500 && e.retryable === true
    })
  })

  it('throws LeonAPIError with code "network_error" on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    )
    await expect(
      adapter.request({ path: '/api/v1/info' })
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as LeonAPIError
      return e instanceof LeonAPIError && e.code === 'network_error' && e.status === 0
    })
  })

  it('throws LeonAPIError with code "request_aborted" when aborted', async () => {
    const controller = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      controller.abort()
      const err = new DOMException('Aborted', 'AbortError')
      throw err
    })
    await expect(
      adapter.request({ path: '/api/v1/info', signal: controller.signal })
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as LeonAPIError
      return e instanceof LeonAPIError && e.code === 'request_aborted'
    })
  })
})

describe('getInfo()', () => {
  it('returns a normalized LeonInfoResponse on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse(INFO_SUCCESS_FIXTURE)
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    const result = await getInfo(adapter)
    expect(result.success).toBe(true)
    expect(result.code).toBe('info_pulled')
    expect(result.llm.enabled).toBe(false)
    expect(result.stt.enabled).toBe(false)
    expect(result.tts.enabled).toBe(false)
    expect(result.version).toBe('1.0.0-beta.10')
  })

  it('respects a custom apiVersion', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse(INFO_SUCCESS_FIXTURE)
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    await getInfo(adapter, 'v2')
    const calledUrl = (fetchSpy.mock.calls[0] as unknown[])[0] as string
    expect(calledUrl).toContain('/api/v2/info')
  })

  it('propagates LeonAPIError on error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse({ code: 'server_error', message: 'Boom' }, 500)
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    await expect(getInfo(adapter)).rejects.toBeInstanceOf(LeonAPIError)
  })
})

describe('postUtterance()', () => {
  it('sends utterance and returns normalized response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse(UTTERANCE_SUCCESS_FIXTURE)
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    const result = await postUtterance(adapter, 'What time is it?')
    expect(result.success).toBe(true)
    const init = (fetchSpy.mock.calls[0] as unknown[])[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ utterance: 'What time is it?' })
  })

  it('throws LeonAPIError on 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse({ code: 'server_error', message: 'Boom' }, 500)
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    await expect(postUtterance(adapter, 'hello')).rejects.toBeInstanceOf(LeonAPIError)
  })
})

describe('runAction()', () => {
  it('sends skill_action + action_params and returns result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse(RUN_ACTION_SUCCESS_FIXTURE)
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    const params = {
      skill_action: 'timer:create-timer',
      action_params: { duration: 60 }
    }
    const result = await runAction(adapter, params)
    expect(result.success).toBe(true)
    expect(result.code).toBe('action_executed')
    const init = (fetchSpy.mock.calls[0] as unknown[])[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual(params)
  })

  it('throws LeonAPIError with code missing_params on 400', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse(ERROR_FIXTURE_400, 400)
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    await expect(
      runAction(adapter, { skill_action: '', action_params: {} })
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LeonAPIError && (err as LeonAPIError).code === 'missing_params'
    )
  })
})

describe('fetchWidget()', () => {
  it('passes skill_action and widget_id as query params', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse(FETCH_WIDGET_SUCCESS_FIXTURE)
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    const result = await fetchWidget(adapter, {
      skill_action: 'todos:list-todos',
      widget_id: 'widget-42'
    })
    expect(result.success).toBe(true)
    expect(result.code).toBe('widget_fetched')
    const calledUrl = (fetchSpy.mock.calls[0] as unknown[])[0] as string
    expect(calledUrl).toContain('skill_action=todos%3Alist-todos')
    expect(calledUrl).toContain('widget_id=widget-42')
  })

  it('returns widget: null when not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({
        success: true,
        status: 200,
        code: 'widget_not_fetched',
        message: 'Widget not fetched.',
        widget: null
      })
    )
    const adapter = new HttpAdapter({ baseUrl: 'http://localhost:1337' })
    const result = await fetchWidget(adapter, {
      skill_action: 'todos:list-todos',
      widget_id: 'missing'
    })
    expect(result.widget).toBeNull()
  })
})

describe('LeonAPIError', () => {
  it('constructs with correct properties', () => {
    const err = new LeonAPIError({
      message: 'Not found',
      status: 404,
      code: 'not_found',
      retryable: false,
      retryAfterMs: null
    })
    expect(err.name).toBe('LeonAPIError')
    expect(err.status).toBe(404)
    expect(err.code).toBe('not_found')
    expect(err.retryable).toBe(false)
    expect(err.retryAfterMs).toBeNull()
    expect(err instanceof Error).toBe(true)
  })

  it('fromNetworkError sets retryable=true and code=network_error', () => {
    const err = LeonAPIError.fromNetworkError(new TypeError('Network fail'))
    expect(err.code).toBe('network_error')
    expect(err.retryable).toBe(true)
    expect(err.status).toBe(0)
  })

  it('fromNetworkError sets retryable=false and code=request_aborted for AbortError', () => {
    const abortErr = new DOMException('Aborted', 'AbortError')
    const err = LeonAPIError.fromNetworkError(abortErr)
    expect(err.code).toBe('request_aborted')
    expect(err.retryable).toBe(false)
  })

  it('fromResponse extracts code and message from JSON body', async () => {
    const response = makeErrorResponse(
      { code: 'missing_params', message: 'params are missing' },
      400
    )
    const err = await LeonAPIError.fromResponse(response)
    expect(err.status).toBe(400)
    expect(err.code).toBe('missing_params')
    expect(err.message).toBe('params are missing')
    expect(err.retryable).toBe(false)
  })

  it('fromResponse marks 5xx errors as retryable', async () => {
    const response = makeErrorResponse({ code: 'server_error', message: 'Boom' }, 500)
    const err = await LeonAPIError.fromResponse(response)
    expect(err.retryable).toBe(true)
  })

  it('fromResponse parses Retry-After header', async () => {
    const response = new Response(JSON.stringify({ code: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '30' }
    })
    const err = await LeonAPIError.fromResponse(response)
    expect(err.retryAfterMs).toBe(30_000)
    expect(err.retryable).toBe(true)
  })
})
