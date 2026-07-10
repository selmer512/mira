import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockedCore = vi.hoisted(() => ({
  processUtterance: vi.fn(async (utterance: string) => ({
    utterance,
    answer: 'Hello from the deterministic HTTP test.'
  })),
  brain: {
    isMuted: false
  }
}))

vi.mock('@/constants', () => ({
  HTTP_API_KEY: 'legacy-http-test-key'
}))

vi.mock('@/core', () => ({
  NLU: {
    process: mockedCore.processUtterance
  },
  BRAIN: mockedCore.brain
}))

import { postUtterance } from '@/core/http-server/api/utterance/post'
import { keyMidd } from '@/core/http-server/plugins/key'

async function createApplication(): Promise<FastifyInstance> {
  const fastify = Fastify()
  fastify.addHook('preHandler', keyMidd)
  await fastify.register(postUtterance, { apiVersion: 'v1' })
  await fastify.ready()
  return fastify
}

afterEach(() => {
  mockedCore.processUtterance.mockClear()
  mockedCore.brain.isMuted = false
})

describe('current authenticated HTTP utterance route', () => {
  it('rejects a request with an invalid API key before invoking NLU', async () => {
    const fastify = await createApplication()

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/utterance',
      headers: {
        'x-api-key': 'incorrect-key'
      },
      payload: {
        utterance: 'Hello'
      }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      success: false
    })
    expect(mockedCore.processUtterance).not.toHaveBeenCalled()

    await fastify.close()
  })

  it('processes an authenticated utterance through the current route', async () => {
    const fastify = await createApplication()

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/utterance',
      headers: {
        'x-api-key': 'legacy-http-test-key'
      },
      payload: {
        utterance: 'Hello'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      utterance: 'Hello',
      answer: 'Hello from the deterministic HTTP test.',
      success: true
    })
    expect(mockedCore.processUtterance).toHaveBeenCalledOnce()
    expect(mockedCore.processUtterance).toHaveBeenCalledWith('Hello')
    expect(mockedCore.brain.isMuted).toBe(true)

    await fastify.close()
  })

  it('rejects a malformed request body before invoking NLU', async () => {
    const fastify = await createApplication()

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/utterance',
      headers: {
        'x-api-key': 'legacy-http-test-key'
      },
      payload: {}
    })

    expect(response.statusCode).toBe(400)
    expect(mockedCore.processUtterance).not.toHaveBeenCalled()

    await fastify.close()
  })
})
