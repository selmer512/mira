import fs from 'node:fs'
import path from 'node:path'

import { command } from 'execa'
import { getMiraCachePath } from './download-cache.js'

import {
  BINARIES_FOLDER_NAME,
  GITHUB_URL,
  NODEJS_BRIDGE_ROOT_PATH,
  NODEJS_BRIDGE_DIST_PATH,
  PYTHON_BRIDGE_DIST_PATH,
  PYTHON_TCP_SERVER_DIST_PATH,
  NODEJS_BRIDGE_VERSION,
  PYTHON_BRIDGE_VERSION,
  PYTHON_TCP_SERVER_VERSION
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'

/**
 * Set up binaries according to the given setup target
 * 1. Delete the existing dist binaries if already exist
 * 2. Download the latest binaries from GitHub releases
 * 3. Extract the downloaded ZIP file to the dist folder
 */

const TARGETS = new Map()

TARGETS.set('nodejs-bridge', {
  name: 'Node.js bridge',
  distPath: NODEJS_BRIDGE_DIST_PATH,
  manifestPath: path.join(NODEJS_BRIDGE_DIST_PATH, 'manifest.json'),
  archiveName: `leon-nodejs-bridge.zip`,
  version: NODEJS_BRIDGE_VERSION,
  isPlatformDependent: false // Need to be built for the target platform or not
})
TARGETS.set('python-bridge', {
  name: 'Python bridge',
  distPath: PYTHON_BRIDGE_DIST_PATH,
  manifestPath: path.join(PYTHON_BRIDGE_DIST_PATH, 'manifest.json'),
  archiveName: `leon-python-bridge-${BINARIES_FOLDER_NAME}.zip`,
  version: PYTHON_BRIDGE_VERSION,
  isPlatformDependent: true
})
TARGETS.set('tcp-server', {
  name: 'Python TCP server',
  distPath: PYTHON_TCP_SERVER_DIST_PATH,
  manifestPath: path.join(PYTHON_TCP_SERVER_DIST_PATH, 'manifest.json'),
  archiveName: `leon-tcp-server-${BINARIES_FOLDER_NAME}.zip`,
  version: PYTHON_TCP_SERVER_VERSION,
  isPlatformDependent: true
})

const setupBinaries = async (key) => {
  const {
    name,
    distPath,
    archiveName,
    version,
    manifestPath,
    isPlatformDependent
  } = TARGETS.get(key)
  let manifest = null

  const buildPath = isPlatformDependent
    ? path.join(distPath, BINARIES_FOLDER_NAME)
    : path.join(distPath, 'bin')

  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))

    LogHelper.info(`Found ${name} ${manifest.version}`)
    LogHelper.info(`Latest version is ${version}`)
  }

  const isBinaryMissing = !fs.existsSync(buildPath)
  const isVersionMismatch = !manifest || manifest.version !== version

  if (isVersionMismatch || isBinaryMissing) {
    const cachedArchivePath = await getMiraCachePath('binaries', archiveName)

    if (isBinaryMissing && !isVersionMismatch) {
      LogHelper.warning(`${name} binary directory missing despite matching manifest — re-extracting`)
    }

    // Clean up old extracted version in project (cached archive is kept)
    await fs.promises.rm(buildPath, { recursive: true, force: true })

    if (key === 'nodejs-bridge') {
      try {
        LogHelper.info('Installing Node.js bridge npm packages...')

        await command(
          `npm install --package-lock=false --prefix ${NODEJS_BRIDGE_ROOT_PATH}`,
          {
            shell: true
          }
        )

        LogHelper.success('Node.js bridge npm packages installed')
      } catch (e) {
        throw new Error(`Failed to install Node.js bridge npm packages: ${e}`)
      }
    }

    try {
      if (!fs.existsSync(cachedArchivePath)) {
        LogHelper.info(`Downloading ${name}...`)

        const latestReleaseAssetURL = `${GITHUB_URL}/releases/download/${key}_v${version}/${archiveName}`

        await FileHelper.downloadFile(latestReleaseAssetURL, cachedArchivePath)

        LogHelper.success(`${name} downloaded and cached`)
      } else {
        LogHelper.info(`Using cached ${name} ${version}`)
      }

      LogHelper.info(`Extracting ${name}...`)

      await FileHelper.extractArchive(cachedArchivePath, distPath)

      LogHelper.success(`${name} extracted`)

      // Create manifest (cached archive is kept for future installs)
      await FileHelper.createManifestFile(manifestPath, name, version)

      LogHelper.success(`${name} manifest file created`)
      LogHelper.success(`${name} ${version} ready`)
    } catch (e) {
      throw new Error(`Failed to set up ${name}: ${e}`)
    }
  } else {
    LogHelper.success(`${name} is already at the latest version (${version})`)
  }
}

export default async () => {
  await setupBinaries('nodejs-bridge')
  await setupBinaries('python-bridge')
  await setupBinaries('tcp-server')
}
