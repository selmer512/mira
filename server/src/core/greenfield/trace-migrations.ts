export interface TraceMigration {
  version: number
  name: string
  sql: string
}

export const TRACE_MIGRATIONS: TraceMigration[] = [
  {
    version: 1,
    name: 'create_encrypted_append_only_trace_store',
    sql: `
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;

      CREATE TABLE IF NOT EXISTS greenfield_trace_records (
        trace_id TEXT PRIMARY KEY,
        owner_hash TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        origin_event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL CHECK (
          event_type IN ('owner_request', 'sensed_event', 'scheduled_event', 'system_event')
        ),
        occurred_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        privacy_classification TEXT NOT NULL CHECK (
          privacy_classification IN ('public', 'private', 'sensitive', 'restricted')
        ),
        previous_record_hash TEXT,
        record_hash TEXT NOT NULL UNIQUE,
        retention_until INTEGER NOT NULL,
        redaction_status TEXT NOT NULL CHECK (
          redaction_status IN ('metadata_only', 'session_redacted')
        ),
        encryption_key_id TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        initialization_vector BLOB NOT NULL,
        authentication_tag BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_trace_owner_created
        ON greenfield_trace_records(owner_hash, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_greenfield_trace_retention
        ON greenfield_trace_records(retention_until ASC);

      CREATE INDEX IF NOT EXISTS idx_greenfield_trace_origin
        ON greenfield_trace_records(origin_event_id);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_no_update
      BEFORE UPDATE ON greenfield_trace_records
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace records are append-only');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_trace_purge_receipts (
        receipt_id TEXT PRIMARY KEY,
        owner_hash TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        purged_at INTEGER NOT NULL,
        record_count INTEGER NOT NULL,
        purged_record_hashes_json TEXT NOT NULL,
        receipt_hash TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_purge_owner_time
        ON greenfield_trace_purge_receipts(owner_hash, purged_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_purge_receipt_no_update
      BEFORE UPDATE ON greenfield_trace_purge_receipts
      BEGIN
        SELECT RAISE(ABORT, 'greenfield purge receipts are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_purge_receipt_no_delete
      BEFORE DELETE ON greenfield_trace_purge_receipts
      BEGIN
        SELECT RAISE(ABORT, 'greenfield purge receipts cannot be deleted');
      END;
    `
  }
]
