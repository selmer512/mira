import { timingSafeEqual } from 'node:crypto'

import type { IdentityContext } from './contracts'
import {
  GreenfieldExecutionError,
  type IdentityResolveInput,
  type IdentityResolver
} from './runtime'

function credentialsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

export class CredentialVerifyingIdentityResolver implements IdentityResolver {
  public constructor(
    private readonly expectedCredential: string,
    private readonly delegate: IdentityResolver
  ) {}

  public async resolve(input: IdentityResolveInput): Promise<IdentityContext> {
    if (!this.expectedCredential) {
      throw new GreenfieldExecutionError(
        'identity.credential_not_configured',
        'The greenfield identity credential is not configured.',
        503
      )
    }

    if (
      !input.credential ||
      !credentialsMatch(input.credential, this.expectedCredential)
    ) {
      throw new GreenfieldExecutionError(
        'identity.credential_invalid',
        'The greenfield identity credential is invalid.',
        401
      )
    }

    return this.delegate.resolve(input)
  }
}
