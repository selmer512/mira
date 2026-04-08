import axios from 'axios'

import { MIRA_VERSION } from '@/constants'
import { SOCKET_SERVER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'

export class Updater {
  private static readonly currentVersion = MIRA_VERSION
  private static readonly isDevelopment = (MIRA_VERSION || '').includes('+dev')
  private static readonly gitBranch = this.isDevelopment ? 'develop' : 'master'
  private static readonly axios = axios.create({
    baseURL: 'https://raw.githubusercontent.com/leon-ai/leon',
    timeout: 7_000
  })

  public static async checkForUpdates(): Promise<void> {
    LogHelper.title('Updater')
    LogHelper.info('Checking for updates...')

    try {
      const { data } = await this.axios.get(`/${this.gitBranch}/package.json`)
      const latestVersion = data.version

      LogHelper.title('Updater')

      if (latestVersion !== this.currentVersion) {
        LogHelper.warning(`A new version is available: ${latestVersion}`)
        LogHelper.warning(`Current version: ${this.currentVersion}`)
        LogHelper.warning(
          `Run the following command to update Mira and benefit from the latest features: "npm install --save @leon-ai/leon@${latestVersion}"`
        )

        SOCKET_SERVER.socket?.emit('new-update', latestVersion)
      } else {
        const releaseMode = this.isDevelopment ? 'development' : 'stable'

        LogHelper.success(
          `You are using the latest version of Mira`
        )
      }
    } catch (e) {
      LogHelper.warning(`Failed to check for updates: ${e}`)
    }
  }
}
