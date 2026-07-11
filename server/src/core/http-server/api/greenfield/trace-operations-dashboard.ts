import type { FastifyPluginAsync, FastifyReply, FastifySchema } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  getDefaultGreenfieldIdentityResolver,
  getDefaultTraceOperationsDashboardService,
  type IdentityResolver,
  type TraceOperationsDashboardService
} from '@/core/greenfield'

const dashboardSchema = {
  querystring: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

interface DashboardSchema {
  querystring: Static<typeof dashboardSchema.querystring>
}

function readCredential(header: string | string[] | undefined): string {
  return Array.isArray(header) ? header[0] || '' : header || ''
}

function isTypedRouteError(error: unknown): error is {
  code: string
  message: string
  statusCode: number
  details: unknown
} {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    'details' in error
  )
}

function sendError(reply: FastifyReply, error: unknown): void {
  if (isTypedRouteError(error)) {
    reply.statusCode = error.statusCode
    reply.send({
      success: false,
      code: error.code,
      message: error.message,
      details: error.details
    })
    return
  }

  reply.statusCode = 500
  reply.send({
    success: false,
    code: 'trace_key.unexpected_failure',
    message: 'The trace operations dashboard failed unexpectedly.'
  })
}

export function createTraceOperationsDashboardRoute(
  identityResolver: IdentityResolver,
  dashboardService: Pick<TraceOperationsDashboardService, 'getDashboard'>
): FastifyPluginAsync<APIOptions> {
  return async (fastify, options) => {
    fastify.route<{ Querystring: DashboardSchema['querystring'] }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/greenfield/trace-operations/dashboard`,
      schema: dashboardSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await identityResolver.resolve({
            deviceId: request.query.device_id,
            credential: readCredential(request.headers['x-api-key']),
            authenticatedAt: new Date()
          })
          const dashboard = await dashboardService.getDashboard(identity)
          reply.send({ success: true, dashboard })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })
  }
}

export const traceOperationsDashboardRoute =
  createTraceOperationsDashboardRoute(
    getDefaultGreenfieldIdentityResolver(),
    getDefaultTraceOperationsDashboardService()
  )
