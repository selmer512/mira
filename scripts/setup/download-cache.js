import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const CACHE_BASE = path.join(homedir(), '.mira', 'cache')

/**
 * Returns the absolute path for a file in the global Mira download cache,
 * creating the cache subdirectory if it does not exist yet.
 *
 * @param {string} category  - subdirectory name (e.g. 'llm', 'pytorch', 'nvidia')
 * @param {string} filename  - filename of the cached asset
 * @returns {Promise<string>} absolute path inside the cache
 */
export async function getMiraCachePath(category, filename) {
  const dir = path.join(CACHE_BASE, category)
  await fs.promises.mkdir(dir, { recursive: true })
  return path.join(dir, filename)
}
