import type { ActionFunction } from '@sdk/types'
import { mira } from '@sdk/mira'

import { zeroPad } from '../lib/zeroPad'

export const run: ActionFunction = async function (params) {
  const currentDate = new Date()
  await mira.answer({
    key: 'current_date_time',
    data: {
      weekday: currentDate.toLocaleString(params.lang, { weekday: 'long' }),
      month: currentDate.toLocaleString(params.lang, { month: 'long' }),
      day: currentDate.getDate(),
      year: currentDate.getFullYear(),
      hours: zeroPad(currentDate.getHours()),
      minutes: zeroPad(currentDate.getMinutes()),
      seconds: zeroPad(currentDate.getSeconds())
    }
  })
}
