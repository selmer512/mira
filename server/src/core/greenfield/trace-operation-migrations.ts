import type { TraceMigration } from './trace-migrations'

export const TRACE_OPERATION_MIGRATIONS: TraceMigration[] = [
  {
    version: 2,
    name: 'create_owner_authorized_trace_operations',
    sql: `
      CREATE TABLE IF NOT EXISTS greenfield_trace_operation_plans (
        plan_id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL UNIQUE,
        trace_id TEXT NOT NULL UNIQUE,
        owner_hash TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        auth_session_hash TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('export', 'purge')),
        capability TEXT NOT NULL CHECK (capability IN ('trace.export', 'trace.purge')),
        risk TEXT NOT NULL CHECK (risk IN ('high', 'critical')),
        scope_hash TEXT NOT NULL,
        trace_count INTEGER NOT NULL CHECK (trace_count > 0 AND trace_count <= 100),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        challenge_hash TEXT NOT NULL,
        plan_hash TEXT NOT NULL UNIQUE,
        ciphertext BLOB NOT NULL,
        initialization_vector BLOB NOT NULL,
        authentication_tag BLOB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_trace_operation_owner_time
        ON greenfield_trace_operation_plans(owner_hash, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_greenfield_trace_operation_expiry
        ON greenfield_trace_operation_plans(expires_at ASC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_operation_plan_no_update
      BEFORE UPDATE ON greenfield_trace_operation_plans
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace operation plans are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_operation_plan_no_delete
      BEFORE DELETE ON greenfield_trace_operation_plans
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace operation plans cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_trace_operation_approvals (
        approval_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL UNIQUE,
        owner_hash TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        auth_session_hash TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
        decided_at INTEGER NOT NULL,
        approval_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(plan_id) REFERENCES greenfield_trace_operation_plans(plan_id)
      );

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_operation_approval_no_update
      BEFORE UPDATE ON greenfield_trace_operation_approvals
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace operation approvals are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_operation_approval_no_delete
      BEFORE DELETE ON greenfield_trace_operation_approvals
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace operation approvals cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_trace_operation_receipts (
        receipt_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL UNIQUE,
        action_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        owner_hash TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('export', 'purge')),
        approval_id TEXT NOT NULL,
        execution_status TEXT NOT NULL CHECK (
          execution_status IN ('succeeded', 'failed', 'cancelled')
        ),
        verification_status TEXT NOT NULL CHECK (
          verification_status IN ('succeeded', 'failed')
        ),
        verification_evidence_refs_json TEXT NOT NULL,
        output_hash TEXT,
        purge_receipt_id TEXT,
        record_count INTEGER NOT NULL CHECK (record_count >= 0 AND record_count <= 100),
        executed_at INTEGER NOT NULL,
        verified_at INTEGER NOT NULL,
        failure_code TEXT,
        receipt_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(plan_id) REFERENCES greenfield_trace_operation_plans(plan_id),
        FOREIGN KEY(approval_id) REFERENCES greenfield_trace_operation_approvals(approval_id)
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_trace_operation_receipt_owner_time
        ON greenfield_trace_operation_receipts(owner_hash, executed_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_operation_receipt_no_update
      BEFORE UPDATE ON greenfield_trace_operation_receipts
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace operation receipts are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_operation_receipt_no_delete
      BEFORE DELETE ON greenfield_trace_operation_receipts
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace operation receipts cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS greenfield_trace_operation_events (
        event_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_event_id TEXT,
        plan_id TEXT NOT NULL,
        stage TEXT NOT NULL CHECK (
          stage IN ('plan', 'approval', 'execution', 'verification', 'receipt')
        ),
        status TEXT NOT NULL CHECK (
          status IN ('succeeded', 'failed', 'approved', 'rejected')
        ),
        occurred_at INTEGER NOT NULL,
        payload_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(plan_id) REFERENCES greenfield_trace_operation_plans(plan_id)
      );

      CREATE INDEX IF NOT EXISTS idx_greenfield_trace_operation_event_trace
        ON greenfield_trace_operation_events(trace_id, occurred_at ASC);

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_operation_event_no_update
      BEFORE UPDATE ON greenfield_trace_operation_events
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace operation events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_greenfield_trace_operation_event_no_delete
      BEFORE DELETE ON greenfield_trace_operation_events
      BEGIN
        SELECT RAISE(ABORT, 'greenfield trace operation events cannot be deleted');
      END;
    `
  }
]
