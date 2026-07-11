import fs from 'node:fs'

const storePath = 'server/src/core/greenfield/memory-store.ts'
const routePath = 'server/src/core/http-server/api/greenfield/memory.ts'
const workflowPath = '.github/workflows/greenfield-memory-lint-patch.yml'
const scriptPath = 'scripts/greenfield/apply-memory-lint-fix.mjs'

function replaceExactly(source, from, to) {
  const occurrences = source.split(from).length - 1
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one occurrence of ${from}; found ${occurrences}.`)
  }
  return source.replace(from, to)
}

let store = fs.readFileSync(storePath, 'utf8')
store = replaceExactly(
  store,
  "? ` AND r.temporal_status = 'historical'`",
  "? ' AND r.temporal_status = \\'historical\\''"
)
store = replaceExactly(
  store,
  ": timeScope === 'prospective'\n          ? ` AND r.temporal_status = 'prospective'`",
  ": timeScope === 'prospective'\n          ? ' AND r.temporal_status = \\'prospective\\''"
)
fs.writeFileSync(storePath, store)

let route = fs.readFileSync(routePath, 'utf8')
route = replaceExactly(
  route,
  '  type IdentityResolver,',
  '  type IdentityContext,\n  type IdentityResolver,'
)
route = replaceExactly(
  route,
  '  credential: string\n) {',
  '  credential: string\n): Promise<IdentityContext> {'
)
fs.writeFileSync(routePath, route)

fs.rmSync(workflowPath)
fs.rmSync(scriptPath)
