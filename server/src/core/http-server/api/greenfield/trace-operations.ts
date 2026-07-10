import type { FastifyPluginAsync, FastifyReply, FastifySchema } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  getDefaultGreenfieldIdentityResolver,
  getDefaultTraceOperationService,
  type IdentityResolver,
  type TraceOperationService
} from '@/core/greenfield'

const planSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      operation: Type.Union([
        Type.Literal('export'),
        Type.Literal('purge')
      ]),
      trace_ids: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        minItems: 1,
        maxItems: 100,
        uniqueItems: true
      }),
      reason_code: Type.Optional(
        Type.String({ minLength: 1, maxLength: 128 })
      )
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const approvalSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      plan_id: Type.String({ minLength: 1, maxLength: 256 }),
      approval_token: Type.String({ minLength: 32, maxLength: 256 }),
      decision: Type.Union([
        Type.Literal('approved'),
        Type.Literal('rejected')
      ])
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const executeSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      plan_id: Type.String({ minLength: 1, maxLength: 256 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

interface PlanSchema {
  body: Static<typeof planSchema.body>
}

interface ApprovalSchema {
  body: Static<typeof approvalSchema.body>
}

interface ExecuteSchema {
  body: Static<typeof executeSchema.body>
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
    code: 'trace_operation.unexpected_failure',
    message: 'The trace operation request failed unexpectedly.'
  })
}

export function createTraceOperationsRoute(
  identityResolver: IdentityResolver,
  service: TraceOperationService
): FastifyPluginAsync<APIOptions> {
  return async (fastify, options) => {
    fastify.route<{ Body: PlanSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/trace-operations/plan`,
      schema: planSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await identityResolver.resolve({
            deviceId: request.body.device_id,
            credential: readCredential(request.headers['x-api-key']),
            authenticatedAt: new Date()
          })
          const result = await service.createPlan({
            identity,
            operation: request.body.operation,
            traceIds: request.body.trace_ids,
            reasonCode:
              request.body.reason_code ||
              `owner_requested_${request.body.operation}`
          })
          reply.send({ success: true, ...result })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Body: ApprovalSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/trace-operations/approve`,
      schema: approvalSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await identityResolver.resolve({
            deviceId: request.body.device_id,
            credential: readCredential(request.headers['x-api-key']),
            authenticatedAt: new Date()
          })
          const approval = await service.approve({
            identity,
            planId: request.body.plan_id,
            approvalToken: request.body.approval_token,
            decision: request.body.decision
          })
          reply.send({ success: true, approval })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Body: ExecuteSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/trace-operations/execute`,
      schema: executeSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await identityResolver.resolve({
            deviceId: request.body.device_id,
            credential: readCredential(request.headers['x-api-key']),
            authenticatedAt: new Date()
          })
          const result = await service.execute({
            identity,
            planId: request.body.plan_id
          })
          reply.send({ success: true, ...result })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })
  }
}

export const traceOperationsRoute = createTraceOperationsRoute(
  getDefaultGreenfieldIdentityResolver(),
  getDefaultTraceOperationService()
)
