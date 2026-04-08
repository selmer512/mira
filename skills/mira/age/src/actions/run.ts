import type { ActionFunction } from '@sdk/types'
import { mira } from '@sdk/mira'

import { getTimeDifferenceBetweenDates } from '../lib/getTimeDifferenceBetweenDates'

const MIRA_BIRTH_DATE = new Date('2019-02-10T20:29:00+08:00')

export const run: ActionFunction = async function (params) {
  const answers = ['alive_for', 'magical_day', 'commemorate'] as const
  const answer = answers[Math.floor(Math.random() * answers.length)]

  if (answer === 'magical_day') {
    return mira.answer({
      key: 'magical_day',
      data: {
        weekday: MIRA_BIRTH_DATE.toLocaleString(params.lang, {
          weekday: 'long'
        }),
        month: MIRA_BIRTH_DATE.toLocaleString(params.lang, { month: 'long' }),
        day: MIRA_BIRTH_DATE.getDate(),
        year: MIRA_BIRTH_DATE.getFullYear()
      }
    })
  }

  if (answer === 'commemorate') {
    return mira.answer({
      key: 'commemorate',
      data: {
        month: MIRA_BIRTH_DATE.toLocaleString(params.lang, { month: 'long' }),
        day: MIRA_BIRTH_DATE.getDate(),
        year: MIRA_BIRTH_DATE.getFullYear()
      }
    })
  }

  const currentDate = new Date()
  const { years, months, days, hours, minutes, seconds } =
    getTimeDifferenceBetweenDates(currentDate, MIRA_BIRTH_DATE)
  await mira.answer({
    key: 'alive_for',
    data: {
      years,
      months,
      days,
      hours,
      minutes,
      seconds
    }
  })
}
