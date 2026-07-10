import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  GreenfieldExecutionError,
  TraceStoreError,
  getDefaultGreenfieldIdentityResolver,
  getDefaultTraceMaintenanceService,
  type IdentityResolver,
  type TraceMaintenanceHealth
} from '@/core/greenfield'

const traceHealthSchema = {
  querystring: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

interface TraceHealthSchema {
  querystring: Static<typeof traceHealthSchema.querystring>
}

interface TraceHealthReader {
  getHealth(): Promise<TraceMaintenanceHealth>
}

function readCredential(header: string | string[] | undefined): string {
  return Array.isArray(header) ? header[0] || '' : header || ''
}

export function createTraceHealthRoute(
  identityResolver: IdentityResolver,
  maintenanceService: TraceHealthReader
): FastifyPluginAsync<APIOptions> {
  return async (fastify, options) => {
    fastify.route<{
      Querystring: TraceHealthSchema['querystring']
    }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/greenfield/trace-health`,
      schema: traceHealthSchema,
      handler: async (request, reply) => {
        try {
          const identity = await identityResolver.resolve({
            deviceId: request.query.device_id,
            credential: readCredential(request.headers['x-api-key']),
            authenticatedAt: new Date()
          })
          const health = await maintenanceService.getHealth()

          if (health.ownerId !== identity.owner_id) {
            reply.statusCode = 403
            reply.send({
              success: false,
              code: 'trace.health_owner_mismatch',
              message: 'Trace health belongs to a different owner.'
            })
            return
          }

          reply.send({
            success: true,
            health
          })
        } catch (error) {
          if (
            error instanceof GreenfieldExecutionError ||
            error instanceof TraceStoreError
          ) {
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
            code: 'trace.health_failed',
            message: 'Trace health could not be read.'
          })
        }
      }
    })
  }
}

export const traceHealthRoute = createTraceHealthRoute(
  getDefaultGreenfieldIdentityResolver(),
  getDefaultTraceMaintenanceService()
)
