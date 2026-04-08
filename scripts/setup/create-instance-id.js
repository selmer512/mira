import fs from 'node:fs'

import { MIRA_FILE_PATH } from '@/constants'
import { Telemetry } from '@/telemetry'
import { LogHelper } from '@/helpers/log-helper'

export default async () => {
  try {
    const { instanceID, birthDate } = await Telemetry.postInstall()

    if (!fs.existsSync(MIRA_FILE_PATH)) {
      await fs.promises.writeFile(
        MIRA_FILE_PATH,
        JSON.stringify(
          {
            instanceID,
            birthDate
          },
          null,
          2
        )
      )

      LogHelper.success(`Instance ID created: ${instanceID}`)
    } else {
      LogHelper.success(`Instance ID already exists: ${instanceID}`)
    }
  } catch (e) {
    LogHelper.warning(`Failed to create the instance ID: ${e}`)
  }
}
