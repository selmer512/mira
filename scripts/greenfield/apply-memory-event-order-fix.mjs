import fs from 'node:fs'

const sourcePath = 'server/src/core/greenfield/memory-store.ts'
const workflowPath = '.github/workflows/greenfield-memory-source-patch.yml'
const scriptPath = 'scripts/greenfield/apply-memory-event-order-fix.mjs'

let source = fs.readFileSync(sourcePath, 'utf8')
const replacements = [
  {
    from: 'ORDER BY occurred_at DESC, rowid DESC LIMIT 1',
    to: 'ORDER BY rowid DESC LIMIT 1'
  },
  {
    from: 'ORDER BY occurred_at ASC, rowid ASC',
    to: 'ORDER BY rowid ASC'
  }
]

for (const replacement of replacements) {
  const occurrences = source.split(replacement.from).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one occurrence of ${replacement.from}; found ${occurrences}.`
    )
  }
  source = source.replace(replacement.from, replacement.to)
}

fs.writeFileSync(sourcePath, source)
fs.rmSync(workflowPath)
fs.rmSync(scriptPath)
