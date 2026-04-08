import type { ActionFunction } from '@sdk/types'
import { mira } from '@sdk/mira'

import { deleteAllTimersMemory } from '../lib/memory'

export const run: ActionFunction = async function () {
  await deleteAllTimersMemory()

  await mira.answer({ key: 'timer_canceled' })
}
