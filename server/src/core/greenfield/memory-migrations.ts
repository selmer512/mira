export interface MemoryMigration {
  version: number
  name: string
  sql: string
}

export const MEMORY_MIGRATIONS: MemoryMigration[] = [
  {
    version: 1,
    name: 'create_provenance_aware_memory_lifecycle',
    sql: `
      CREATE TABLE IF NOT EXISTS greenfield_memory_candidates (
        candidate_id TEXT PRIMARY KEY,
        stable_owner_hash TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        memory_class TEXT NOT NULL,
        temporal_status TEXT NOT NULL,
        privacy_zone TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        salience REAL NOT NULL CHECK (salience >= 0 AND salience <= 1),
        content_hash TEXT NOT NULL,
        challenge_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        encryption_key_id TEXT NOT NULL,
        record_hash TEXT NOT NULL UNIQUE,
        ciphertext BLOB NOT NULL,
        initialization_vector BLOB NOT NULL,
        authentication_tag BLOB NOT NULL,
        UNIQUE(stable_owner_hash, content_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_candidate_owner_time
        ON greenfield_memory_candidates(stable_owner_hash, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_candidate_expiry
        ON greenfield_memory_candidates(expires_at ASC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_candidate_no_update
      BEFORE UPDATE ON greenfield_memory_candidates
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory candidates are immutable');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_memory_records (
        memory_id TEXT PRIMARY KEY,
        stable_owner_hash TEXT NOT NULL,
        memory_class TEXT NOT NULL,
        temporal_status TEXT NOT NULL,
        privacy_zone TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        salience REAL NOT NULL CHECK (salience >= 0 AND salience <= 1),
        observed_at INTEGER NOT NULL,
        valid_from INTEGER,
        valid_until INTEGER,
        content_hash TEXT NOT NULL,
        created_by_trace_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        encryption_key_id TEXT NOT NULL,
        record_hash TEXT NOT NULL UNIQUE,
        ciphertext BLOB NOT NULL,
        initialization_vector BLOB NOT NULL,
        authentication_tag BLOB NOT NULL,
        UNIQUE(stable_owner_hash, content_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_owner_time
        ON greenfield_memory_records(stable_owner_hash, observed_at DESC);

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_owner_temporal
        ON greenfield_memory_records(stable_owner_hash, temporal_status, observed_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_record_no_update
      BEFORE UPDATE ON greenfield_memory_records
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory records are append-only; corrections create a superseding record');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_memory_search_terms (
        stable_owner_hash TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        term_hash TEXT NOT NULL,
        term_weight REAL NOT NULL CHECK (term_weight > 0),
        created_at INTEGER NOT NULL,
        PRIMARY KEY(memory_id, term_hash),
        FOREIGN KEY(memory_id) REFERENCES greenfield_memory_records(memory_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_search_owner_term
        ON greenfield_memory_search_terms(stable_owner_hash, term_hash, term_weight DESC);

      CREATE TABLE IF NOT EXISTS greenfield_memory_graph_edges (
        edge_id TEXT PRIMARY KEY,
        stable_owner_hash TEXT NOT NULL,
        source_memory_id TEXT NOT NULL,
        relation TEXT NOT NULL CHECK (relation IN ('derived_from', 'contradicts', 'supersedes')),
        target_memory_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        edge_hash TEXT NOT NULL UNIQUE,
        UNIQUE(source_memory_id, relation, target_memory_id),
        FOREIGN KEY(source_memory_id) REFERENCES greenfield_memory_records(memory_id) ON DELETE CASCADE,
        FOREIGN KEY(target_memory_id) REFERENCES greenfield_memory_records(memory_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_graph_owner_source
        ON greenfield_memory_graph_edges(stable_owner_hash, source_memory_id);

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_graph_owner_target
        ON greenfield_memory_graph_edges(stable_owner_hash, target_memory_id);

      CREATE TABLE IF NOT EXISTS greenfield_memory_decision_receipts (
        decision_receipt_id TEXT PRIMARY KEY,
        stable_owner_hash TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('owner_confirmed', 'rejected')),
        decided_at INTEGER NOT NULL,
        memory_id TEXT,
        durable_record_hash TEXT,
        verification_status TEXT NOT NULL CHECK (verification_status IN ('succeeded', 'failed')),
        receipt_hash TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_decision_owner_time
        ON greenfield_memory_decision_receipts(stable_owner_hash, decided_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_decision_no_update
      BEFORE UPDATE ON greenfield_memory_decision_receipts
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory decision receipts are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_decision_no_delete
      BEFORE DELETE ON greenfield_memory_decision_receipts
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory decision receipts cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_memory_events (
        event_id TEXT PRIMARY KEY,
        stable_owner_hash TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        candidate_id TEXT,
        memory_id TEXT,
        event_type TEXT NOT NULL CHECK (
          event_type IN (
            'candidate_created',
            'candidate_confirmed',
            'candidate_rejected',
            'candidate_rolled_back',
            'memory_created',
            'memory_searched',
            'purge_planned',
            'purge_approved',
            'purge_rejected',
            'purge_executed',
            'purge_failed'
          )
        ),
        occurred_at INTEGER NOT NULL,
        metadata_hash TEXT NOT NULL,
        previous_event_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_event_owner_time
        ON greenfield_memory_events(stable_owner_hash, occurred_at ASC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_event_no_update
      BEFORE UPDATE ON greenfield_memory_events
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_event_no_delete
      BEFORE DELETE ON greenfield_memory_events
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory events cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_memory_purge_plans (
        plan_id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL UNIQUE,
        trace_id TEXT NOT NULL UNIQUE,
        stable_owner_hash TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        auth_session_hash TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        record_count INTEGER NOT NULL CHECK (record_count > 0 AND record_count <= 100),
        reason_code TEXT NOT NULL,
        challenge_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        encryption_key_id TEXT NOT NULL,
        plan_hash TEXT NOT NULL UNIQUE,
        ciphertext BLOB NOT NULL,
        initialization_vector BLOB NOT NULL,
        authentication_tag BLOB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_purge_plan_owner_time
        ON greenfield_memory_purge_plans(stable_owner_hash, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_purge_plan_no_update
      BEFORE UPDATE ON greenfield_memory_purge_plans
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory purge plans are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_purge_plan_no_delete
      BEFORE DELETE ON greenfield_memory_purge_plans
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory purge plans cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_memory_purge_approvals (
        approval_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL UNIQUE,
        stable_owner_hash TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        auth_session_hash TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
        decided_at INTEGER NOT NULL,
        approval_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(plan_id) REFERENCES greenfield_memory_purge_plans(plan_id)
      );

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_purge_approval_no_update
      BEFORE UPDATE ON greenfield_memory_purge_approvals
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory purge approvals are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_purge_approval_no_delete
      BEFORE DELETE ON greenfield_memory_purge_approvals
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory purge approvals cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_memory_purge_receipts (
        receipt_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL UNIQUE,
        action_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        stable_owner_hash TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        record_count INTEGER NOT NULL CHECK (record_count >= 0 AND record_count <= 100),
        execution_status TEXT NOT NULL CHECK (execution_status IN ('succeeded', 'failed')),
        verification_status TEXT NOT NULL CHECK (verification_status IN ('succeeded', 'failed')),
        verification_evidence_refs_json TEXT NOT NULL,
        executed_at INTEGER NOT NULL,
        verified_at INTEGER NOT NULL,
        failure_code TEXT,
        receipt_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(plan_id) REFERENCES greenfield_memory_purge_plans(plan_id)
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_memory_purge_receipt_owner_time
        ON greenfield_memory_purge_receipts(stable_owner_hash, executed_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_purge_receipt_no_update
      BEFORE UPDATE ON greenfield_memory_purge_receipts
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory purge receipts are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_memory_purge_receipt_no_delete
      BEFORE DELETE ON greenfield_memory_purge_receipts
      BEGIN
        SELECT RAISE(ABORT, 'greenfield memory purge receipts cannot be deleted');
      END;
    `
  }
]
