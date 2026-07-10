import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  GreenfieldExecutionError,
  SYSTEM_STATUS_CAPABILITY,
  createDefaultGreenfieldRuntime,
  type GreenfieldRequestOrchestrator
} from '@/core/greenfield'

const postGreenfieldRequestSchema = {
  body: Type.Object(
    {
      device_id: Type.String({ minLength: 1, maxLength: 256 }),
      capability: Type.Literal(SYSTEM_STATUS_CAPABILITY),
      input: Type.String({ minLength: 1, maxLength: 4096 })
    },
    { additionalProperties: false }
  )
} satisfies FastifySchema

interface PostGreenfieldRequestSchema {
  body: Static<typeof postGreenfieldRequestSchema.body>
}

function readCredential(header: string | string[] | undefined): string {
  return Array.isArray(header) ? header[0] || '' : header || ''
}

export function createPostGreenfieldRequest(
  orchestrator: GreenfieldRequestOrchestrator
): FastifyPluginAsync<APIOptions> {
  return async (fastify, options) => {
    fastify.route<{
      Body: PostGreenfieldRequestSchema['body']
    }>({
      method: 'POST',
      url: `/api/${options.apiVersion}/greenfield/request`,
      schema: postGreenfieldRequestSchema,
      handler: async (request, reply) => {
        try {
          const result = await orchestrator.execute({
            ...request.body,
            credential: readCredential(request.headers['x-api-key'])
          })

          reply.send({
            success: true,
            answer: result.answer,
            envelope: result.envelope,
            evidence_payloads: result.evidence_payloads
          })
        } catch (error) {
          if (error instanceof GreenfieldExecutionError) {
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
            code: 'greenfield.internal_error',
            message: 'The greenfield request failed unexpectedly.'
          })
        }
      }
    })
  }
}

export const postGreenfieldRequest = createPostGreenfieldRequest(
  createDefaultGreenfieldRuntime()
)
