import type { FastifyPluginAsync, FastifyReply, FastifySchema } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { GreenfieldExecutionError } from '@/core/greenfield'
import {
  HarnessKernelError,
  getDefaultMiraHarness,
  type MiraHarnessKernel
} from '@/core/harness'

const IdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$'
})

const cardSchema = {
  querystring: Type.Object(
    { device_id: Type.String({ minLength: 1, maxLength: 256 }) },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const startTaskSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      context_id: IdentifierSchema,
      idempotency_key: Type.String({ minLength: 1, maxLength: 256 }),
      capability_id: Type.String({
        minLength: 1,
        maxLength: 128,
        pattern: '^[a-z0-9][a-z0-9._-]{0,127}$'
      }),
      input: Type.String({ minLength: 1, maxLength: 32_768 }),
      metadata: Type.Optional(
        Type.Record(Type.String({ maxLength: 128 }), Type.Unknown())
      )
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const readTaskSchema = {
  params: Type.Object(
    { task_id: IdentifierSchema },
    { additionalProperties: false }
  ),
  querystring: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      after_sequence: Type.Optional(Type.Integer({ minimum: 0 }))
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const cancelTaskSchema = {
  params: Type.Object(
    { task_id: IdentifierSchema },
    { additionalProperties: false }
  ),
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 }))
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const decideTaskSchema = {
  params: Type.Object(
    { task_id: IdentifierSchema },
    { additionalProperties: false }
  ),
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      approval_id: IdentifierSchema,
      decision: Type.Union([
        Type.Literal('approved'),
        Type.Literal('rejected')
      ])
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

interface CardRoute {
  querystring: Static<typeof cardSchema.querystring>
}

interface StartTaskRoute {
  body: Static<typeof startTaskSchema.body>
}

interface ReadTaskRoute {
  params: Static<typeof readTaskSchema.params>
  querystring: Static<typeof readTaskSchema.querystring>
}

interface CancelTaskRoute {
  params: Static<typeof cancelTaskSchema.params>
  body: Static<typeof cancelTaskSchema.body>
}

interface DecideTaskRoute {
  params: Static<typeof decideTaskSchema.params>
  body: Static<typeof decideTaskSchema.body>
}

function readCredential(header: string | string[] | undefined): string {
  return Array.isArray(header) ? header[0] || '' : header || ''
}

function sendError(reply: FastifyReply, error: unknown): void {
  if (
    error instanceof HarnessKernelError ||
    error instanceof GreenfieldExecutionError
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
    code: 'harness.internal_error',
    message: 'The Mira harness request failed unexpectedly.'
  })
}

export function createHarnessRoute(
  harness: MiraHarnessKernel
): FastifyPluginAsync<APIOptions> {
  return async (fastify, options) => {
    fastify.route<{ Querystring: CardRoute['querystring'] }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/harness/card`,
      schema: cardSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const card = await harness.getCard({
            device_id: request.query.device_id,
            credential: readCredential(request.headers['x-api-key'])
          })
          reply.send({ success: true, card })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Body: StartTaskRoute['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/harness/tasks`,
      schema: startTaskSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const view = await harness.start({
            ...request.body,
            metadata: request.body.metadata || {},
            credential: readCredential(request.headers['x-api-key'])
          })
          reply.statusCode = 202
          reply.send({ success: true, ...view })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{
      Params: ReadTaskRoute['params']
      Querystring: ReadTaskRoute['querystring']
    }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/harness/tasks/:task_id`,
      schema: readTaskSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const view = await harness.read({
            device_id: request.query.device_id,
            credential: readCredential(request.headers['x-api-key']),
            task_id: request.params.task_id,
            after_sequence: request.query.after_sequence
          })
          reply.send({ success: true, ...view })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{
      Params: CancelTaskRoute['params']
      Body: CancelTaskRoute['body']
    }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/harness/tasks/:task_id/cancel`,
      schema: cancelTaskSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const view = await harness.cancel({
            device_id: request.body.device_id,
            credential: readCredential(request.headers['x-api-key']),
            task_id: request.params.task_id,
            reason: request.body.reason
          })
          reply.send({ success: true, ...view })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{
      Params: DecideTaskRoute['params']
      Body: DecideTaskRoute['body']
    }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/harness/tasks/:task_id/decision`,
      schema: decideTaskSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const view = await harness.decide({
            device_id: request.body.device_id,
            credential: readCredential(request.headers['x-api-key']),
            task_id: request.params.task_id,
            approval_id: request.body.approval_id,
            decision: request.body.decision
          })
          reply.send({ success: true, ...view })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })
  }
}

export const harnessRoute = createHarnessRoute(getDefaultMiraHarness())
