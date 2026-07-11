import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

function numberValue(value) {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

function stringValue(value) {
  return value == null ? '' : String(value)
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function readMigrationVersions(database) {
  return database
    .prepare(
      `SELECT version FROM greenfield_trace_schema_migrations
       ORDER BY version ASC`
    )
    .all()
    .map((row) => numberValue(row.version))
}

function readTableCount(database, tableName) {
  const table = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = ? LIMIT 1`
    )
    .get(tableName)
  if (!table) return 0
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get()
  return numberValue(row?.count || 0)
}

function verifySnapshot(liveDatabase, backupPath) {
  const backup = new DatabaseSync(backupPath)
  try {
    const integrityRow = backup.prepare('PRAGMA integrity_check').get()
    const integrity = integrityRow
      ? stringValue(Object.values(integrityRow)[0])
      : ''
    const migrationVersions = readMigrationVersions(backup)
    const liveMigrationVersions = readMigrationVersions(liveDatabase)
    const traceCount = readTableCount(backup, 'greenfield_trace_records')
    const liveTraceCount = readTableCount(
      liveDatabase,
      'greenfield_trace_records'
    )
    const operationPlanCount = readTableCount(
      backup,
      'greenfield_trace_operation_plans'
    )
    const liveOperationPlanCount = readTableCount(
      liveDatabase,
      'greenfield_trace_operation_plans'
    )
    const rotationPlanCount = readTableCount(
      backup,
      'greenfield_trace_rotation_plans'
    )
    const liveRotationPlanCount = readTableCount(
      liveDatabase,
      'greenfield_trace_rotation_plans'
    )
    const valid =
      integrity === 'ok' &&
      JSON.stringify(migrationVersions) ===
        JSON.stringify(liveMigrationVersions) &&
      traceCount === liveTraceCount &&
      operationPlanCount === liveOperationPlanCount &&
      rotationPlanCount === liveRotationPlanCount

    if (!valid) {
      throw new Error(
        'Backup integrity, migration versions, or protected record counts differ from the live database.'
      )
    }

    return {
      integrity_check: integrity,
      migration_versions: migrationVersions,
      trace_count: traceCount,
      operation_plan_count: operationPlanCount,
      rotation_plan_count: rotationPlanCount
    }
  } finally {
    backup.close()
  }
}

export function createTraceBackup({
  databasePath,
  backupPath,
  replaceExisting = false,
  now = () => new Date()
}) {
  if (!databasePath || !backupPath) {
    throw new Error('Both live database and backup paths are required.')
  }

  const livePath = path.resolve(databasePath)
  const destinationPath = path.resolve(backupPath)
  if (livePath === destinationPath) {
    throw new Error('The backup path cannot point to the live database.')
  }
  if (!fs.existsSync(livePath)) {
    throw new Error('The live trace database does not exist.')
  }
  if (fs.existsSync(destinationPath) && !replaceExisting) {
    throw new Error(
      'The backup already exists. Set the explicit replacement option only after preserving the current backup.'
    )
  }

  const destinationDirectory = path.dirname(destinationPath)
  fs.mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 })
  const temporaryPath = `${destinationPath}.pending-${process.pid}`
  fs.rmSync(temporaryPath, { force: true })

  const liveDatabase = new DatabaseSync(livePath)
  try {
    liveDatabase.exec('PRAGMA busy_timeout = 5000;')
    liveDatabase.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    liveDatabase.exec(`VACUUM INTO ${sqlString(temporaryPath)};`)
    const evidence = verifySnapshot(liveDatabase, temporaryPath)

    if (fs.existsSync(destinationPath)) {
      fs.rmSync(destinationPath, { force: true })
    }
    fs.renameSync(temporaryPath, destinationPath)
    try {
      fs.chmodSync(destinationDirectory, 0o700)
      fs.chmodSync(destinationPath, 0o600)
    } catch {
      // Platforms without POSIX permissions retain their native controls.
    }

    return {
      status: 'verified',
      backup_path: destinationPath,
      size_bytes: fs.statSync(destinationPath).size,
      created_at: now().toISOString(),
      ...evidence
    }
  } finally {
    liveDatabase.close()
    fs.rmSync(temporaryPath, { force: true })
  }
}

async function main() {
  try {
    const evidence = createTraceBackup({
      databasePath: process.env['MIRA_GREENFIELD_TRACE_DB_PATH'] || '',
      backupPath: process.env['MIRA_GREENFIELD_TRACE_BACKUP_PATH'] || '',
      replaceExisting:
        process.env['MIRA_GREENFIELD_TRACE_BACKUP_REPLACE'] === 'true'
    })
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await main()
}
