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
  },
  {
    version: 4,
    name: 'create_stable_owner_bindings_and_rotation_plans',
    sql: `
      CREATE TABLE IF NOT EXISTS greenfield_trace_owner_key_bindings (
        stable_owner_hash TEXT NOT NULL,
        key_version TEXT NOT NULL,
        encryption_key_id TEXT NOT NULL,
        owner_hash TEXT NOT NULL UNIQUE,
        registered_at INTEGER NOT NULL,
        metadata_hash TEXT NOT NULL UNIQUE,
        PRIMARY KEY (stable_owner_hash, key_version),
        UNIQUE (stable_owner_hash, encryption_key_id),
        FOREIGN KEY (key_version)
          REFERENCES greenfield_trace_key_versions(key_version)
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_owner_binding_lookup
        ON greenfield_trace_owner_key_bindings(stable_owner_hash, key_version);

      CREATE TABLE IF NOT EXISTS greenfield_trace_rotation_plans (
        rotation_plan_id TEXT PRIMARY KEY,
        stable_owner_hash TEXT NOT NULL,
        target_key_version TEXT NOT NULL,
        target_encryption_key_id TEXT NOT NULL,
        trace_count INTEGER NOT NULL CHECK (trace_count >= 0),
        operation_plan_count INTEGER NOT NULL CHECK (operation_plan_count >= 0),
        estimated_rewrite_bytes INTEGER NOT NULL CHECK (estimated_rewrite_bytes >= 0),
        required_free_bytes INTEGER NOT NULL CHECK (required_free_bytes >= 0),
        available_free_bytes INTEGER,
        backup_status TEXT NOT NULL CHECK (
          backup_status IN ('verified', 'missing', 'invalid', 'not_configured')
        ),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        encryption_key_id TEXT NOT NULL,
        plan_hash TEXT NOT NULL UNIQUE,
        ciphertext BLOB NOT NULL,
        initialization_vector BLOB NOT NULL,
        authentication_tag BLOB NOT NULL,
        FOREIGN KEY (target_key_version)
          REFERENCES greenfield_trace_key_versions(key_version)
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_rotation_plan_owner_time
        ON greenfield_trace_rotation_plans(stable_owner_hash, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_owner_binding_no_update
      BEFORE UPDATE ON greenfield_trace_owner_key_bindings
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace owner key bindings are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_owner_binding_no_delete
      BEFORE DELETE ON greenfield_trace_owner_key_bindings
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace owner key bindings cannot be deleted');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_rotation_plan_no_update
      BEFORE UPDATE ON greenfield_trace_rotation_plans
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace rotation plans are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_rotation_plan_no_delete
      BEFORE DELETE ON greenfield_trace_rotation_plans
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace rotation plans cannot be deleted');
      END;
    `
  }
]
