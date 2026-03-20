import fs from 'node:fs'
import path from 'node:path'

import { SystemHelper } from '@/helpers/system-helper'

/**
 * Create or update a directory symlink, removing any existing entry at linkPath first.
 * Does nothing if targetPath does not exist.
 */
export async function ensureDirectoryLink(linkPath, targetPath) {
  if (!fs.existsSync(targetPath)) {
    return
  }

  await fs.promises.rm(linkPath, { recursive: true, force: true })
  await fs.promises.mkdir(path.dirname(linkPath), { recursive: true })

  const relativeTarget = path.relative(path.dirname(linkPath), targetPath)
  const linkType = SystemHelper.isWindows() ? 'junction' : 'dir'

  await fs.promises.symlink(relativeTarget, linkPath, linkType)
}
