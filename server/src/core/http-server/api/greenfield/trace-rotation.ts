import type { FastifyPluginAsync, FastifyReply, FastifySchema } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  getDefaultGreenfieldIdentityResolver,
  getDefaultTraceRotationPlanner,
  type IdentityResolver,
  type TraceRotationPlan
} from '@/core/greenfield'

const createPlanSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      target_key_version: Type.String({
        minLength: 1,
        maxLength: 64,
        pattern: '^[a-z0-9][a-z0-9._-]{0,63}$'
      })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const readPlanSchema = {
  querystring: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      rotation_plan_id: Type.String({ minLength: 1, maxLength: 256 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

interface CreatePlanSchema {
  body: Static<typeof createPlanSchema.body>
}

interface ReadPlanSchema {
  querystring: Static<typeof readPlanSchema.querystring>
}

export interface TraceRotationPlanService {
  createPlan: (
    identity: Awaited<ReturnType<IdentityResolver['resolve']>>,
    targetKeyVersion: string
  ) => TraceRotationPlan
  readPlan: (
    identity: Awaited<ReturnType<IdentityResolver['resolve']>>,
    rotationPlanId: string
  ) => TraceRotationPlan | null
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
    code: 'trace_rotation.unexpected_failure',
    message: 'The trace rotation planning request failed unexpectedly.'
  })
}

export function createTraceRotationRoute(
  identityResolver: IdentityResolver,
  planner: TraceRotationPlanService
): FastifyPluginAsync<APIOptions> {
  return async (fastify, options) => {
    fastify.route<{ Body: CreatePlanSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/trace-rotation/plan`,
      schema: createPlanSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await identityResolver.resolve({
            deviceId: request.body.device_id,
            credential: readCredential(request.headers['x-api-key']),
            authenticatedAt: new Date()
          })
          const plan = planner.createPlan(
            identity,
            request.body.target_key_version
          )
          reply.send({ success: true, plan })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Querystring: ReadPlanSchema['querystring'] }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/greenfield/trace-rotation/plan`,
      schema: readPlanSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await identityResolver.resolve({
            deviceId: request.query.device_id,
            credential: readCredential(request.headers['x-api-key']),
            authenticatedAt: new Date()
          })
          const plan = planner.readPlan(
            identity,
            request.query.rotation_plan_id
          )
          if (!plan) {
            reply.statusCode = 404
            reply.send({
              success: false,
              code: 'trace_rotation.plan_not_found',
              message: 'The rotation plan was not found for this owner.'
            })
            return
          }
          reply.send({ success: true, plan })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })
  }
}

export const traceRotationRoute = createTraceRotationRoute(
  getDefaultGreenfieldIdentityResolver(),
  getDefaultTraceRotationPlanner()
)
