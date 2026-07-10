import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'

import { traceHealthRoute } from './health'
import { postGreenfieldRequest } from './post'

export const greenfieldRequestPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(postGreenfieldRequest, options)
  await fastify.register(traceHealthRoute, options)
}
