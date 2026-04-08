import type { ActionFunction } from '@sdk/types'
import { mira } from '@sdk/mira'

import { zeroPad } from '../lib/zeroPad'

export const run: ActionFunction = async function () {
  const currentDate = new Date()
  await mira.answer({
    key: 'current_time',
    data: {
      hours: zeroPad(currentDate.getHours()),
      minutes: zeroPad(currentDate.getMinutes()),
      seconds: zeroPad(currentDate.getSeconds())
    }
  })
}
