import type {
  HarnessEvent,
  HarnessTask,
  HarnessTaskView
} from './contracts'

export type HarnessEventAppend = Omit<HarnessEvent, 'sequence'>

export interface HarnessTaskStore {
  create(task: HarnessTask): HarnessTask
  findByIdempotency(ownerId: string, idempotencyKey: string): HarnessTask | null
  read(taskId: string): HarnessTask | null
  replace(task: HarnessTask): HarnessTask
  appendEvent(event: HarnessEventAppend): HarnessEvent
  readView(taskId: string, afterSequence?: number): HarnessTaskView | null
}

export class HarnessTaskStoreError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'HarnessTaskStoreError'
  }
}

function cloneTask(task: HarnessTask): HarnessTask {
  return structuredClone(task)
}

function cloneEvent(event: HarnessEvent): HarnessEvent {
  return structuredClone(event)
}

export class InMemoryHarnessTaskStore implements HarnessTaskStore {
  private readonly tasks = new Map<string, HarnessTask>()
  private readonly idempotencyIndex = new Map<string, string>()
  private readonly events = new Map<string, HarnessEvent[]>()

  public create(task: HarnessTask): HarnessTask {
    if (this.tasks.has(task.task_id)) {
      throw new HarnessTaskStoreError(
        'harness.task_duplicate',
        'The task identifier is already present.'
      )
    }
    const idempotencyRef = this.idempotencyRef(task.owner_id, task.idempotency_key)
    if (this.idempotencyIndex.has(idempotencyRef)) {
      throw new HarnessTaskStoreError(
        'harness.idempotency_duplicate',
        'The owner idempotency key is already associated with another task.'
      )
    }
    const stored = cloneTask(task)
    this.tasks.set(stored.task_id, stored)
    this.idempotencyIndex.set(idempotencyRef, stored.task_id)
    this.events.set(stored.task_id, [])
    return cloneTask(stored)
  }

  public findByIdempotency(
    ownerId: string,
    idempotencyKey: string
  ): HarnessTask | null {
    const taskId = this.idempotencyIndex.get(
      this.idempotencyRef(ownerId, idempotencyKey)
    )
    if (!taskId) {
      return null
    }
    return this.read(taskId)
  }

  public read(taskId: string): HarnessTask | null {
    const task = this.tasks.get(taskId)
    return task ? cloneTask(task) : null
  }

  public replace(task: HarnessTask): HarnessTask {
    const existing = this.tasks.get(task.task_id)
    if (!existing) {
      throw new HarnessTaskStoreError(
        'harness.task_not_found',
        'The task does not exist.'
      )
    }
    if (
      existing.owner_id !== task.owner_id ||
      existing.idempotency_key !== task.idempotency_key ||
      existing.created_at !== task.created_at
    ) {
      throw new HarnessTaskStoreError(
        'harness.task_immutable_field_changed',
        'An immutable harness task field was changed.'
      )
    }
    const stored = cloneTask(task)
    this.tasks.set(stored.task_id, stored)
    return cloneTask(stored)
  }

  public appendEvent(event: HarnessEventAppend): HarnessEvent {
    if (!this.tasks.has(event.task_id)) {
      throw new HarnessTaskStoreError(
        'harness.task_not_found',
        'Cannot append an event for an unknown task.'
      )
    }
    const taskEvents = this.events.get(event.task_id) || []
    const stored: HarnessEvent = {
      ...structuredClone(event),
      sequence: taskEvents.length + 1
    }
    taskEvents.push(stored)
    this.events.set(event.task_id, taskEvents)
    return cloneEvent(stored)
  }

  public readView(taskId: string, afterSequence = 0): HarnessTaskView | null {
    const task = this.tasks.get(taskId)
    if (!task) {
      return null
    }
    const allEvents = this.events.get(taskId) || []
    const latestSequence = allEvents.at(-1)?.sequence || 0
    return {
      task: cloneTask(task),
      events: allEvents
        .filter((event) => event.sequence > afterSequence)
        .map(cloneEvent),
      latest_sequence: latestSequence
    }
  }

  private idempotencyRef(ownerId: string, idempotencyKey: string): string {
    return `${ownerId}\u0000${idempotencyKey}`
  }
}
