import type { ActionFunction } from '@sdk/types'
import { mira } from '@sdk/mira'

export const run: ActionFunction = async function (params) {
  const currentDate = new Date()
  await mira.answer({
    key: 'current_date',
    data: {
      weekday: currentDate.toLocaleString(params.lang, { weekday: 'long' }),
      month: currentDate.toLocaleString(params.lang, { month: 'long' }),
      day: currentDate.getDate(),
      year: currentDate.getFullYear()
    }
  })
}
