import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'

import { traceHealthRoute } from './health'
import { postGreenfieldRequest } from './post'
import { traceOperationsRoute } from './trace-operations'
import { traceOperationsDashboardRoute } from './trace-operations-dashboard'

export const greenfieldRequestPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(postGreenfieldRequest, options)
  await fastify.register(traceHealthRoute, options)
  await fastify.register(traceOperationsRoute, options)
  await fastify.register(traceOperationsDashboardRoute, options)
}
