import type {
  HarnessHook,
  HarnessHookContext,
  HarnessHookStage
} from './contracts'

export class HarnessHookError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'HarnessHookError'
  }
}

export class HarnessHookBus {
  private readonly hooks = new Map<HarnessHookStage, HarnessHook[]>()

  public register(hook: HarnessHook): void {
    const hooksForStage = this.hooks.get(hook.stage) || []
    if (hooksForStage.some((candidate) => candidate.hook_id === hook.hook_id)) {
      throw new HarnessHookError(
        'harness.hook_duplicate',
        `Hook ${hook.hook_id} is already registered for ${hook.stage}.`
      )
    }
    hooksForStage.push(hook)
    hooksForStage.sort(
      (left, right) =>
        left.priority - right.priority || left.hook_id.localeCompare(right.hook_id)
    )
    this.hooks.set(hook.stage, hooksForStage)
  }

  public list(stage?: HarnessHookStage): HarnessHook[] {
    if (stage) {
      return [...(this.hooks.get(stage) || [])]
    }
    return [...this.hooks.values()].flatMap((hooks) => [...hooks])
  }

  public async run(
    stage: HarnessHookStage,
    context: HarnessHookContext
  ): Promise<string[]> {
    const executed: string[] = []
    for (const hook of this.hooks.get(stage) || []) {
      if (!hook.enabled) {
        continue
      }
      try {
        await hook.run(context)
        executed.push(hook.hook_id)
      } catch (error) {
        throw new HarnessHookError(
          'harness.hook_failed',
          `Hook ${hook.hook_id} failed during ${stage}.`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    return executed
  }
}
