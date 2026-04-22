import type { onRequestHookHandler } from 'fastify'

import { HOST, IS_PRODUCTION_ENV } from '@/constants'

export const corsMidd: onRequestHookHandler = async (_request, reply) => {
  const extraOrigin = process.env['MIRA_ALLOWED_ORIGIN']
  const requestOrigin = _request.headers.origin

  const allowed: string[] = []
  if (!IS_PRODUCTION_ENV) allowed.push(`${HOST}:3000`)
  if (extraOrigin) allowed.push(extraOrigin)

  if (requestOrigin && allowed.includes(requestOrigin)) {
    reply.header('Access-Control-Allow-Origin', requestOrigin)
  } else if (!requestOrigin && allowed.length > 0) {
    reply.header('Access-Control-Allow-Origin', allowed[0] as string)
  }

  reply.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  )

  reply.header('Access-Control-Allow-Credentials', true)
}
