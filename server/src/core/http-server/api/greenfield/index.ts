import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'

import { harnessRoute } from './harness'
import { traceHealthRoute } from './health'
import { memoryRoute } from './memory'
import { postGreenfieldRequest } from './post'
import { traceOperationsRoute } from './trace-operations'
import { traceOperationsDashboardRoute } from './trace-operations-dashboard'
import { traceRotationRoute } from './trace-rotation'

export const greenfieldRequestPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(postGreenfieldRequest, options)
  await fastify.register(harnessRoute, options)
  await fastify.register(traceHealthRoute, options)
  await fastify.register(traceOperationsRoute, options)
  await fastify.register(traceOperationsDashboardRoute, options)
  await fastify.register(traceRotationRoute, options)
  await fastify.register(memoryRoute, options)
}
