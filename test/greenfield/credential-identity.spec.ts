import { describe, expect, it } from 'vitest'

import {
  CredentialVerifyingIdentityResolver,
  EnvironmentIdentityResolver
} from '@/core/greenfield'

function createResolver(expectedCredential: string): CredentialVerifyingIdentityResolver {
  const configuredIdentity = EnvironmentIdentityResolver.fromProcessEnv({
    MIRA_GREENFIELD_ENABLED: 'true',
    MIRA_GREENFIELD_OWNER_ID: 'owner-1',
    MIRA_GREENFIELD_PAIRED_DEVICE_ID: 'device-1',
    MIRA_GREENFIELD_PERMISSIONS: 'system.status.read',
    MIRA_GREENFIELD_PRIVACY_ZONES: 'private'
  })

  return new CredentialVerifyingIdentityResolver(
    expectedCredential,
    configuredIdentity
  )
}

describe('greenfield credential identity boundary', () => {
  it('resolves identity only after the credential matches', async () => {
    const identity = await createResolver('expected-key').resolve({
      deviceId: 'device-1',
      credential: 'expected-key',
      authenticatedAt: new Date('2026-07-10T18:00:00.000Z')
    })

    expect(identity.owner_id).toBe('owner-1')
    expect(identity.auth_session_id).toMatch(/^http-key:/)
    expect(identity.auth_session_id).not.toContain('expected-key')
  })

  it('rejects an incorrect credential before delegating identity resolution', async () => {
    const resolution = createResolver('expected-key').resolve({
      deviceId: 'device-1',
      credential: 'incorrect-key',
      authenticatedAt: new Date('2026-07-10T18:00:00.000Z')
    })

    await expect(resolution).rejects.toMatchObject({
      code: 'identity.credential_invalid',
      statusCode: 401
    })
  })

  it('fails closed when no expected credential is configured', async () => {
    const resolution = createResolver('').resolve({
      deviceId: 'device-1',
      credential: 'any-key',
      authenticatedAt: new Date('2026-07-10T18:00:00.000Z')
    })

    await expect(resolution).rejects.toMatchObject({
      code: 'identity.credential_not_configured',
      statusCode: 503
    })
  })
})
