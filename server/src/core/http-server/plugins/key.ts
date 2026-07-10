import { timingSafeEqual } from 'node:crypto'

import type { preHandlerHookHandler } from 'fastify'

import { HTTP_API_KEY } from '@/constants'

function matchesConfiguredKey(value: string): boolean {
  if (!HTTP_API_KEY) {
    return false
  }

  const provided = Buffer.from(value)
  const configured = Buffer.from(HTTP_API_KEY)

  return (
    provided.length === configured.length &&
    timingSafeEqual(provided, configured)
  )
}

export const keyMidd: preHandlerHookHandler = async (request, reply) => {
  const apiKey = request.headers['x-api-key']
  const value = Array.isArray(apiKey) ? apiKey[0] || '' : apiKey || ''

  if (!matchesConfiguredKey(value)) {
    return reply.status(401).send({
      message: 'Unauthorized, please check the HTTP API key is correct',
      success: false
    })
  }
}
