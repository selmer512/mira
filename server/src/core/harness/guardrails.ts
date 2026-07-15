import type {
  HarnessFinalStepResult,
  HarnessGuardrail,
  HarnessGuardrailContext,
  HarnessGuardrailResult,
  HarnessOutputGuardrailContext
} from './contracts'

function isInputContext(
  context: HarnessGuardrailContext | HarnessOutputGuardrailContext
): context is HarnessGuardrailContext {
  return 'request' in context
}

export class HarnessGuardrailError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'HarnessGuardrailError'
  }
}

export class PermissionGuardrail implements HarnessGuardrail {
  public readonly guardrail_id = 'deterministic.permission'
  public readonly stage = 'input' as const
  public readonly priority = 10

  public async evaluate(
    context: HarnessGuardrailContext | HarnessOutputGuardrailContext
  ): Promise<HarnessGuardrailResult> {
    if (!isInputContext(context)) {
      return { allowed: true, code: 'not_applicable', message: 'Not applicable.' }
    }
    const missing = context.manifest.required_permissions.filter(
      (permission) => !context.identity.permissions.includes(permission)
    )
    return missing.length === 0
      ? {
          allowed: true,
          code: 'harness.permissions_allowed',
          message: 'The authenticated session has every required permission.'
        }
      : {
          allowed: false,
          code: 'harness.permission_denied',
          message: 'The authenticated session lacks a required capability permission.',
          details: { missing_permissions: missing }
        }
  }
}

export class PrivacyZoneGuardrail implements HarnessGuardrail {
  public readonly guardrail_id = 'deterministic.privacy-zone'
  public readonly stage = 'input' as const
  public readonly priority = 20

  public async evaluate(
    context: HarnessGuardrailContext | HarnessOutputGuardrailContext
  ): Promise<HarnessGuardrailResult> {
    if (!isInputContext(context)) {
      return { allowed: true, code: 'not_applicable', message: 'Not applicable.' }
    }
    const allowed = context.manifest.allowed_privacy_zones.some((zone) =>
      context.identity.privacy_zones.includes(zone)
    )
    return allowed
      ? {
          allowed: true,
          code: 'harness.privacy_zone_allowed',
          message: 'The capability is allowed in the owner session privacy zone.'
        }
      : {
          allowed: false,
          code: 'harness.privacy_zone_denied',
          message: 'The capability is not allowed in this privacy zone.',
          details: {
            allowed_privacy_zones: context.manifest.allowed_privacy_zones
          }
        }
  }
}

export class InputShapeGuardrail implements HarnessGuardrail {
  public readonly guardrail_id = 'deterministic.input-shape'
  public readonly stage = 'input' as const
  public readonly priority = 30

  public constructor(private readonly maxInputCharacters = 32_768) {}

  public async evaluate(
    context: HarnessGuardrailContext | HarnessOutputGuardrailContext
  ): Promise<HarnessGuardrailResult> {
    if (!isInputContext(context)) {
      return { allowed: true, code: 'not_applicable', message: 'Not applicable.' }
    }
    const input = context.request.input.normalize('NFKC').trim()
    if (input.length === 0) {
      return {
        allowed: false,
        code: 'harness.input_empty',
        message: 'Harness input must not be empty.'
      }
    }
    if (input.length > this.maxInputCharacters) {
      return {
        allowed: false,
        code: 'harness.input_too_large',
        message: 'Harness input exceeds the configured deterministic limit.',
        details: {
          maximum_characters: this.maxInputCharacters,
          actual_characters: input.length
        }
      }
    }
    if (context.request.idempotency_key.length > 256) {
      return {
        allowed: false,
        code: 'harness.idempotency_key_too_large',
        message: 'The idempotency key exceeds the supported limit.'
      }
    }
    return {
      allowed: true,
      code: 'harness.input_allowed',
      message: 'Harness input passed deterministic shape validation.'
    }
  }
}

function countText(result: HarnessFinalStepResult): number {
  const messageText = result.message.reduce(
    (total, part) => total + (part.type === 'text' ? part.text?.length || 0 : 0),
    0
  )
  return result.artifacts.reduce(
    (total, artifact) =>
      total +
      artifact.parts.reduce(
        (partTotal, part) =>
          partTotal + (part.type === 'text' ? part.text?.length || 0 : 0),
        0
      ),
    messageText
  )
}

export class OutputShapeGuardrail implements HarnessGuardrail {
  public readonly guardrail_id = 'deterministic.output-shape'
  public readonly stage = 'output' as const
  public readonly priority = 10

  public constructor(
    private readonly maxArtifacts = 32,
    private readonly maxTextCharacters = 262_144
  ) {}

  public async evaluate(
    context: HarnessGuardrailContext | HarnessOutputGuardrailContext
  ): Promise<HarnessGuardrailResult> {
    if (isInputContext(context)) {
      return { allowed: true, code: 'not_applicable', message: 'Not applicable.' }
    }
    if (context.result.message.length === 0) {
      return {
        allowed: false,
        code: 'harness.output_empty',
        message: 'A completed harness task must include an assistant message.'
      }
    }
    if (context.result.artifacts.length > this.maxArtifacts) {
      return {
        allowed: false,
        code: 'harness.output_artifact_limit',
        message: 'The adapter returned too many artifacts.',
        details: { maximum_artifacts: this.maxArtifacts }
      }
    }
    const textCharacters = countText(context.result)
    if (textCharacters > this.maxTextCharacters) {
      return {
        allowed: false,
        code: 'harness.output_too_large',
        message: 'The adapter output exceeds the deterministic text limit.',
        details: {
          maximum_characters: this.maxTextCharacters,
          actual_characters: textCharacters
        }
      }
    }
    return {
      allowed: true,
      code: 'harness.output_allowed',
      message: 'Harness output passed deterministic shape validation.'
    }
  }
}

export function createDefaultHarnessGuardrails(): HarnessGuardrail[] {
  return [
    new PermissionGuardrail(),
    new PrivacyZoneGuardrail(),
    new InputShapeGuardrail(),
    new OutputShapeGuardrail()
  ]
}
