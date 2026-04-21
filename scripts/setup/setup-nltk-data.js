import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

import { getMiraCachePath } from './download-cache.js'
import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'

/**
 * NLTK data required by the TCP server binary at runtime (used by g2p_en / MeloTTS).
 * The frozen binary bundles nltk itself but not its corpora/tagger data files.
 * These are downloaded to ~/nltk_data which is the first path nltk searches.
 */

const NLTK_BASE = path.join(homedir(), 'nltk_data')
const NLTK_DATA_BASE_URL =
  'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages'

const PACKAGES = [
  {
    name: 'cmudict',
    archiveName: 'cmudict.zip',
    url: `${NLTK_DATA_BASE_URL}/corpora/cmudict.zip`,
    targetDir: path.join(NLTK_BASE, 'corpora'),
    markerPath: path.join(NLTK_BASE, 'corpora', 'cmudict')
  },
  {
    name: 'averaged_perceptron_tagger',
    archiveName: 'averaged_perceptron_tagger.zip',
    url: `${NLTK_DATA_BASE_URL}/taggers/averaged_perceptron_tagger.zip`,
    targetDir: path.join(NLTK_BASE, 'taggers'),
    markerPath: path.join(NLTK_BASE, 'taggers', 'averaged_perceptron_tagger')
  },
  {
    name: 'averaged_perceptron_tagger_eng',
    archiveName: 'averaged_perceptron_tagger_eng.zip',
    url: `${NLTK_DATA_BASE_URL}/taggers/averaged_perceptron_tagger_eng.zip`,
    targetDir: path.join(NLTK_BASE, 'taggers'),
    markerPath: path.join(
      NLTK_BASE,
      'taggers',
      'averaged_perceptron_tagger_eng'
    )
  }
]

export default async () => {
  LogHelper.info('Checking NLTK data for TCP server...')

  for (const pkg of PACKAGES) {
    if (fs.existsSync(pkg.markerPath)) {
      LogHelper.success(`NLTK ${pkg.name} already present`)
      continue
    }

    const cachedArchive = await getMiraCachePath('nltk', pkg.archiveName)

    if (!fs.existsSync(cachedArchive)) {
      LogHelper.info(`Downloading NLTK ${pkg.name}...`)
      await FileHelper.downloadFile(pkg.url, cachedArchive)
      LogHelper.success(`NLTK ${pkg.name} downloaded`)
    } else {
      LogHelper.info(`Using cached NLTK ${pkg.name}`)
    }

    LogHelper.info(`Extracting NLTK ${pkg.name}...`)
    await fs.promises.mkdir(pkg.targetDir, { recursive: true })
    await FileHelper.extractArchive(cachedArchive, pkg.targetDir)
    LogHelper.success(`NLTK ${pkg.name} ready`)
  }
}
