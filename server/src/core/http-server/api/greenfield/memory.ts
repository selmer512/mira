import { randomUUID } from 'node:crypto'

import type { FastifyPluginAsync, FastifyReply, FastifySchema } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  getDefaultGreenfieldIdentityResolver,
  getDefaultMemoryCandidateRuntime,
  getDefaultMemoryService,
  type IdentityContext,
  type IdentityResolver,
  type MemoryCandidateExecutionResult,
  type MemoryCandidateRequest,
  type MemoryLifecycleService
} from '@/core/greenfield'

const MemoryClassSchema = Type.Union([
  Type.Literal('working'),
  Type.Literal('recent_episodic'),
  Type.Literal('long_term_episodic'),
  Type.Literal('semantic'),
  Type.Literal('relationship'),
  Type.Literal('procedural'),
  Type.Literal('identity'),
  Type.Literal('prospective'),
  Type.Literal('reflective'),
  Type.Literal('artifact'),
  Type.Literal('model_hypothesis')
])
const TemporalStatusSchema = Type.Union([
  Type.Literal('current'),
  Type.Literal('historical'),
  Type.Literal('prospective'),
  Type.Literal('unknown'),
  Type.Literal('superseded')
])
const TimeScopeSchema = Type.Union([
  Type.Literal('current'),
  Type.Literal('historical'),
  Type.Literal('prospective'),
  Type.Literal('atemporal')
])
const NullableTimestampSchema = Type.Union([
  Type.String({ format: 'date-time' }),
  Type.Null()
])
const StableIdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z0-9][a-z0-9._-]{0,63}$'
})

const createCandidateSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      title: Type.String({ minLength: 1, maxLength: 256 }),
      content: Type.String({ minLength: 1, maxLength: 16_384 }),
      memory_class: MemoryClassSchema,
      temporal_status: TemporalStatusSchema,
      observed_at: Type.String({ format: 'date-time' }),
      valid_from: NullableTimestampSchema,
      valid_until: NullableTimestampSchema,
      privacy_zone: Type.String({ minLength: 1, maxLength: 64 }),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      salience: Type.Number({ minimum: 0, maximum: 1 }),
      retention_policy: StableIdentifierSchema,
      source_refs: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
        maxItems: 32,
        uniqueItems: true
      }),
      derivation_links: Type.Array(
        Type.String({ minLength: 1, maxLength: 256 }),
        { maxItems: 100, uniqueItems: true }
      ),
      contradiction_links: Type.Array(
        Type.String({ minLength: 1, maxLength: 256 }),
        { maxItems: 100, uniqueItems: true }
      ),
      supersession_links: Type.Array(
        Type.String({ minLength: 1, maxLength: 256 }),
        { maxItems: 100, uniqueItems: true }
      )
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const readCandidateSchema = {
  querystring: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      candidate_id: Type.String({ minLength: 1, maxLength: 256 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const decideCandidateSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      candidate_id: Type.String({ minLength: 1, maxLength: 256 }),
      approval_token: Type.String({ minLength: 32, maxLength: 256 }),
      decision: Type.Union([
        Type.Literal('owner_confirmed'),
        Type.Literal('rejected')
      ])
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const searchMemorySchema = {
  querystring: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      query: Type.String({ maxLength: 4096 }),
      time_scope: TimeScopeSchema,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 }))
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const ownerOnlyQuerySchema = {
  querystring: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const createPurgePlanSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      memory_ids: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        minItems: 1,
        maxItems: 100,
        uniqueItems: true
      }),
      reason_code: StableIdentifierSchema
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const readPurgePlanSchema = {
  querystring: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      plan_id: Type.String({ minLength: 1, maxLength: 256 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

const decidePurgePlanSchema = {
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

const executePurgePlanSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      plan_id: Type.String({ minLength: 1, maxLength: 256 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

interface CreateCandidateRouteSchema {
  body: Static<typeof createCandidateSchema.body>
}
interface ReadCandidateRouteSchema {
  querystring: Static<typeof readCandidateSchema.querystring>
}
interface DecideCandidateRouteSchema {
  body: Static<typeof decideCandidateSchema.body>
}
interface SearchMemoryRouteSchema {
  querystring: Static<typeof searchMemorySchema.querystring>
}
interface OwnerOnlyRouteSchema {
  querystring: Static<typeof ownerOnlyQuerySchema.querystring>
}
interface CreatePurgePlanRouteSchema {
  body: Static<typeof createPurgePlanSchema.body>
}
interface ReadPurgePlanRouteSchema {
  querystring: Static<typeof readPurgePlanSchema.querystring>
}
interface DecidePurgePlanRouteSchema {
  body: Static<typeof decidePurgePlanSchema.body>
}
interface ExecutePurgePlanRouteSchema {
  body: Static<typeof executePurgePlanSchema.body>
}

export interface MemoryCandidateExecutor {
  execute(request: MemoryCandidateRequest): Promise<MemoryCandidateExecutionResult>
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
    code: 'memory.unexpected_failure',
    message: 'The memory lifecycle request failed unexpectedly.'
  })
}

async function resolveIdentity(
  identityResolver: IdentityResolver,
  deviceId: string,
  credential: string
): Promise<IdentityContext> {
  return identityResolver.resolve({
    deviceId,
    credential,
    authenticatedAt: new Date()
  })
}

export function createMemoryRoute(
  identityResolver: IdentityResolver,
  candidateRuntime: MemoryCandidateExecutor,
  memoryService: MemoryLifecycleService
): FastifyPluginAsync<APIOptions> {
  return async (fastify, options) => {
    fastify.route<{ Body: CreateCandidateRouteSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/memory/candidate`,
      schema: createCandidateSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const result = await candidateRuntime.execute({
            ...request.body,
            credential: readCredential(request.headers['x-api-key'])
          })
          reply.send({ success: true, ...result })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Querystring: ReadCandidateRouteSchema['querystring'] }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/greenfield/memory/candidate`,
      schema: readCandidateSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.query.device_id,
            readCredential(request.headers['x-api-key'])
          )
          const candidate = memoryService.readCandidate(
            identity,
            request.query.candidate_id
          )
          if (!candidate) {
            reply.statusCode = 404
            reply.send({
              success: false,
              code: 'memory.candidate_not_found',
              message: 'The pending memory candidate was not found for this owner.'
            })
            return
          }
          reply.send({ success: true, candidate })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Body: DecideCandidateRouteSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/memory/candidate/decision`,
      schema: decideCandidateSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.body.device_id,
            readCredential(request.headers['x-api-key'])
          )
          const result = memoryService.decideCandidate({
            identity,
            candidateId: request.body.candidate_id,
            approvalToken: request.body.approval_token,
            decision: request.body.decision,
            decidedAt: new Date()
          })
          reply.send({ success: true, ...result })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Querystring: SearchMemoryRouteSchema['querystring'] }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/greenfield/memory/search`,
      schema: searchMemorySchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.query.device_id,
            readCredential(request.headers['x-api-key'])
          )
          const result = memoryService.search(
            identity,
            request.query.query,
            request.query.time_scope,
            request.query.limit || 10,
            new Date()
          )
          reply.send({ success: true, result })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Querystring: OwnerOnlyRouteSchema['querystring'] }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/greenfield/memory/export`,
      schema: ownerOnlyQuerySchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.query.device_id,
            readCredential(request.headers['x-api-key'])
          )
          reply.send({
            success: true,
            export_bundle: memoryService.exportOwner(identity, new Date())
          })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Body: CreatePurgePlanRouteSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/memory/purge/plan`,
      schema: createPurgePlanSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.body.device_id,
            readCredential(request.headers['x-api-key'])
          )
          const created = memoryService.createPurgePlan({
            identity,
            traceId: randomUUID(),
            memoryIds: request.body.memory_ids,
            reasonCode: request.body.reason_code,
            createdAt: new Date()
          })
          reply.send({
            success: true,
            plan: created.plan,
            approval_token: created.approvalToken
          })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Querystring: ReadPurgePlanRouteSchema['querystring'] }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/greenfield/memory/purge/plan`,
      schema: readPurgePlanSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.query.device_id,
            readCredential(request.headers['x-api-key'])
          )
          const plan = memoryService.readPurgePlan(
            identity,
            request.query.plan_id
          )
          if (!plan) {
            reply.statusCode = 404
            reply.send({
              success: false,
              code: 'memory.purge_plan_not_found',
              message: 'The memory purge plan was not found for this owner.'
            })
            return
          }
          reply.send({ success: true, plan })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Body: DecidePurgePlanRouteSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/memory/purge/decision`,
      schema: decidePurgePlanSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.body.device_id,
            readCredential(request.headers['x-api-key'])
          )
          const approval = memoryService.decidePurgePlan({
            identity,
            planId: request.body.plan_id,
            approvalToken: request.body.approval_token,
            decision: request.body.decision,
            decidedAt: new Date()
          })
          reply.send({ success: true, approval })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Body: ExecutePurgePlanRouteSchema['body'] }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/memory/purge/execute`,
      schema: executePurgePlanSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.body.device_id,
            readCredential(request.headers['x-api-key'])
          )
          const receipt = memoryService.executePurgePlan({
            identity,
            planId: request.body.plan_id,
            executedAt: new Date()
          })
          reply.send({ success: true, receipt })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })

    fastify.route<{ Querystring: ReadPurgePlanRouteSchema['querystring'] }>({
      method: 'GET',
      url: `/api/${options.apiVersion}/greenfield/memory/purge/receipt`,
      schema: readPurgePlanSchema,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        try {
          const identity = await resolveIdentity(
            identityResolver,
            request.query.device_id,
            readCredential(request.headers['x-api-key'])
          )
          const receipt = memoryService.readPurgeReceipt(
            identity,
            request.query.plan_id
          )
          if (!receipt) {
            reply.statusCode = 404
            reply.send({
              success: false,
              code: 'memory.purge_receipt_not_found',
              message: 'The memory purge receipt was not found for this owner.'
            })
            return
          }
          reply.send({ success: true, receipt })
        } catch (error) {
          sendError(reply, error)
        }
      }
    })
  }
}

export const memoryRoute = createMemoryRoute(
  getDefaultGreenfieldIdentityResolver(),
  getDefaultMemoryCandidateRuntime(),
  getDefaultMemoryService()
)
