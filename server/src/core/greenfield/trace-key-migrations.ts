export interface TraceKeyMigration {
  version: number
  name: string
  sql: string
}

export const TRACE_KEY_MIGRATIONS: TraceKeyMigration[] = [
  {
    version: 3,
    name: 'create_trace_encryption_key_version_registry',
    sql: `
      CREATE TABLE IF NOT EXISTS greenfield_trace_key_versions (
        key_version TEXT PRIMARY KEY,
        encryption_key_id TEXT NOT NULL UNIQUE,
        algorithm TEXT NOT NULL CHECK (algorithm = 'aes-256-gcm'),
        registered_at INTEGER NOT NULL,
        metadata_hash TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_trace_key_id
        ON greenfield_trace_key_versions(encryption_key_id);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_key_version_no_update
      BEFORE UPDATE ON greenfield_trace_key_versions
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace key versions are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_key_version_no_delete
      BEFORE DELETE ON greenfield_trace_key_versions
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace key versions cannot be deleted');
      END;
    `
  }
]
