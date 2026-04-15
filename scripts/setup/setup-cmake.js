import fs from 'node:fs'
import path from 'node:path'

import { getMiraCachePath } from './download-cache.js'
import { CPUArchitectures } from '@/types'
import {
  CMAKE_PATH,
  CMAKE_INSTALL_PATH,
  CMAKE_BIN_PATH,
  CMAKE_MANIFEST_PATH,
  CMAKE_VERSION
} from '@/constants'
import { FileHelper } from '@/helpers/file-helper'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'

/**
 * Download and set up Mira-managed CMake
 * 1. Resolve the pinned version from versions.json
 * 2. Download the matching Linux archive for the current architecture
 * 3. Extract it into bin/cmake/cmake/
 * 4. Always use this CMake binary for local source builds
 */

const { cpuArchitecture: CPU_ARCH } = SystemHelper.getInformation()

function readManifest() {
  if (!fs.existsSync(CMAKE_MANIFEST_PATH)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(CMAKE_MANIFEST_PATH, 'utf8'))
  } catch {
    return null
  }
}

async function cleanInstallDirectory() {
  await fs.promises.mkdir(CMAKE_PATH, { recursive: true })

  const entries = await fs.promises.readdir(CMAKE_PATH, {
    withFileTypes: true
  })

  await Promise.all(
    entries
      .filter((entry) => entry.name !== 'versions.json')
      .map((entry) =>
        fs.promises.rm(path.join(CMAKE_PATH, entry.name), {
          recursive: true,
          force: true
        })
      )
  )
}

function getDownloadURL() {
  if (CPU_ARCH === CPUArchitectures.X64) {
    return `https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-x86_64.tar.gz`
  }

  if (CPU_ARCH === CPUArchitectures.ARM64) {
    return `https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-aarch64.tar.gz`
  }

  throw new Error(`Unsupported Linux architecture for CMake: ${CPU_ARCH}`)
}

export default async function setupCMake() {
  if (!SystemHelper.isLinux()) {
    return
  }

  LogHelper.info('Downloading and setting up CMake...')

  const manifest = readManifest()

  if (manifest?.version === CMAKE_VERSION && fs.existsSync(CMAKE_BIN_PATH)) {
    LogHelper.success(`CMake is already at the latest version (${CMAKE_VERSION})`)

    return
  }

  const archiveFilename = `cmake-${CMAKE_VERSION}.tar.gz`
  const cachedArchivePath = await getMiraCachePath('cmake', archiveFilename)

  await cleanInstallDirectory()

  try {
    if (!fs.existsSync(cachedArchivePath)) {
      LogHelper.info(`Downloading CMake ${CMAKE_VERSION}...`)

      await FileHelper.downloadFile(getDownloadURL(), cachedArchivePath, {
        cliProgress: true,
        parallelStreams: 3,
        skipExisting: false
      })

      LogHelper.success('CMake downloaded and cached')
    } else {
      LogHelper.info(`Using cached CMake ${CMAKE_VERSION}`)
    }

    LogHelper.info('Extracting CMake...')

    await FileHelper.extractArchive(cachedArchivePath, CMAKE_INSTALL_PATH, {
      stripComponents: 1
    })

    if (!fs.existsSync(CMAKE_BIN_PATH)) {
      throw new Error(`Cannot find CMake binary at "${CMAKE_BIN_PATH}"`)
    }

    await FileHelper.createManifestFile(CMAKE_MANIFEST_PATH, 'cmake', CMAKE_VERSION, {
      os: SystemHelper.getInformation().type,
      architecture: SystemHelper.getInformation().cpuArchitecture
    })

    LogHelper.success(`CMake ${CMAKE_VERSION} ready`)
  } catch (error) {
    throw new Error(`Failed to set up CMake: ${error}`)
  }
}
