# Mira Owner AI Harness

## Delivery status

This milestone rebuilds Mira's core execution boundary and outer web shell around a provider-independent AI harness. The harness owns task lifecycle, identity, permission and privacy enforcement, idempotency, cancellation, bounded delegation, human approval checkpoints, artifacts, lifecycle events, and encrypted restart-readable journaling. Models, tools, remote agents, and capability adapters remain replaceable participants inside that boundary.

The existing greenfield status, trace, rotation, and memory routes remain available for compatibility. The first capability moved through the new harness is fresh `system.status.read` evidence and its grounded owner response.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Provider-independent harness contracts | IMPLEMENTED | `server/src/core/harness/contracts.ts` |
| Capability manifests and negotiation | IMPLEMENTED | `registry.ts` and authenticated harness card |
| Deterministic permission/privacy/input/output guardrails | IMPLEMENTED | `guardrails.ts` |
| Ordered lifecycle hooks | IMPLEMENTED | `hooks.ts` |
| Task lifecycle, idempotency, cancellation, bounded handoffs | IMPLEMENTED | `kernel.ts` |
| Human approval checkpoint and decision lifecycle | IMPLEMENTED | task state machine and decision API |
| Model, MCP, and A2A ports | IMPLEMENTED | `protocols.ts` |
| Live MCP client/server transport | NOT YET STARTED | interfaces only |
| Live A2A remote-agent transport | NOT YET STARTED | interfaces only |
| Provider model adapters through `ModelProviderPort` | NOT YET STARTED | existing model manager not yet wrapped |
| Fresh status capability adapter | TESTED | kernel and route suites |
| Encrypted SQLite task and event journal | TESTED | migration, restart read, secrecy, immutability, and tamper tests |
| Authenticated task lifecycle API | TESTED | Fastify integration suite |
| Event-driven owner shell | TESTED | browser model/security tests and production Vite build |
| Owner-controlled staging configuration and smoke path | TESTED | static/shell validation; live host remains unavailable |
| Live deployment | BLOCKED | staging runner is not connected |
| Production readiness | BLOCKED | acceptance evidence from file 12 remains incomplete |

## Design principles

1. **The harness is authoritative.** Models and adapters propose messages, artifacts, handoffs, or approval checkpoints. Deterministic identity, capability policy, privacy zones, lifecycle transitions, cancellation, execution limits, and owner decisions decide what occurs.
2. **Tasks are first-class.** Every request has a stable task ID, context ID, idempotency key, state, capability, messages, artifacts, approval, error, trace identity, timestamps, and bounded step count.
3. **Events are causal evidence.** Every lifecycle change is an ordered event carrying the task/context/capability identity and OpenTelemetry-compatible GenAI attributes.
4. **Capabilities are discoverable.** The authenticated harness card includes only the manifests allowed by the current owner session's permissions and privacy zones.
5. **Providers are adapters.** Models, MCP servers, A2A agents, deterministic services, workflows, and verified actions enter through ports. No provider controls Mira identity or policy.
6. **Foreground work wins.** The kernel is asynchronous, cancelable, bounded, and observable. The shell displays actual events rather than simulated typing or timer-derived state.
7. **Sensitive state is encrypted.** When persistence is enabled, owner/device/session/input/messages/artifacts/events and approval data are encrypted at rest. Only opaque indexes and operational metadata remain outside ciphertext.

## Standards alignment

The implementation adopts concepts from current primary-source standards without coupling Mira to one framework runtime:

- **Model Context Protocol:** capability negotiation, explicit tools/resources/prompts/sampling/elicitation ports, progress tokens, cancellation, and host-controlled consent.
- **Agent2Agent Protocol:** agent/capability cards, task/message/artifact semantics, context IDs, idempotency, asynchronous states, cancellation, and delegation to a remote task.
- **OpenTelemetry GenAI semantic conventions:** GenAI operation and agent attributes, stable task/context/capability IDs, and a shared trace identity across lifecycle events.
- **Modern agent runtimes:** ordered lifecycle hooks, input/output guardrails, sessions, handoffs, human-in-the-loop checkpoints, streaming-ready task events, and bounded execution.

These are architectural contracts. Mira does not import a vendor agent framework in this milestone.

## Core contracts

### Harness card

The owner-scoped card returns:

- harness identity, version, and protocol version;
- filtered capability manifests;
- task lifecycle, event, idempotency, cancellation, approval, handoff, session, and negotiation features;
- interoperability declarations for MCP-ready ports, A2A task semantics, and OTel GenAI attributes.

### Capability manifest

Each adapter declares:

- stable capability ID, name, description, and version;
- execution kind: deterministic, evidence, model, tool, agent, workflow, or action;
- required permissions and allowed privacy zones;
- risk and confirmation policy;
- streaming, cancellation, and handoff support;
- input/output schema references;
- provider, optional model, and tags.

A capability cannot be registered twice and cannot omit permissions or privacy zones.

### Task lifecycle

Supported states:

```text
queued
working
input_required
approval_required
completed
failed
canceled
rejected
```

Terminal tasks cannot transition again. Invalid transitions fail closed. A deterministic guardrail rejection is a distinct `rejected` outcome, not a model failure.

### Messages and artifacts

Messages contain typed text, JSON, or reference parts and a role. Artifacts contain typed parts, media type, privacy classification, capability identity, and metadata. The shell renders these through `textContent` and never trusts server HTML.

## Kernel execution sequence

For a new task:

1. Re-verify API credential and paired device at the identity boundary.
2. Resolve the capability adapter from the owner-filtered registry.
3. Hash normalized input, context, capability, and metadata.
4. Return an existing task for an identical owner idempotency key, or reject conflicting reuse.
5. Persist the queued task and append `task.created`.
6. Transition to `working`.
7. Execute ordered input guardrails.
8. Run classification hooks and append `capability.selected`.
9. Run context hooks and invoke adapter context assembly.
10. Enforce an automatic approval checkpoint for capabilities declaring `confirmation: always`.
11. Run model/action lifecycle hooks as applicable.
12. Execute the adapter under a combined owner-cancellation and timeout `AbortSignal`.
13. Process a bounded handoff, approval request, or final result.
14. Execute output guardrails.
15. Persist assistant messages and artifacts.
16. Append the terminal event and release transient controller state.

The default deterministic bound is 12 execution/handoff steps and 120 seconds per adapter invocation. Both are configurable.

## Guardrails

The default guardrail set enforces:

- all manifest permissions are present in the authenticated session;
- at least one manifest privacy zone is allowed by the session;
- non-empty normalized input;
- a 32,768-character input limit;
- a 256-character idempotency-key limit;
- at least one final assistant message;
- no more than 32 artifacts;
- no more than 262,144 aggregate text characters in final messages and artifacts.

Adapters cannot suppress or replace deterministic guardrails.

## Hooks

Hook stages are ordered by priority and then stable hook ID:

```text
before_classification
after_classification
before_context_assembly
after_context_assembly
before_model_call
after_model_call
before_action
after_action
before_verification
after_verification
before_memory_write
after_memory_write
```

Duplicate IDs at one stage are rejected. A hook failure fails the task rather than silently continuing.

## Interoperability ports

### MCP

`McpClientPort` provides initialization/capability negotiation, tool discovery, tool calls, progress tokens, resource references, structured content, and cancellation. A future transport adapter must convert MCP results into Mira artifacts and remain inside the same guardrails and approval boundary.

### A2A

`A2AClientPort` provides remote agent cards, skills, task submission, task reads, and cancellation. Remote tasks map into Mira task states but do not acquire owner permissions automatically. Agent cards are capability declarations, not trust grants.

### Models

`ModelProviderPort` accepts provider/model identity, typed messages, tool definitions, optional response schema, limits, and an `AbortSignal`. It returns typed parts, tool requests, finish reason, usage, and provider metadata. Tool requests remain proposals until the harness resolves a registered capability and policy permits it.

## First adapter: fresh status evidence

`SystemStatusHarnessAdapter` implements `system.status.read` as a low-risk evidence capability. It reads current runtime state, records observation time and a 30-second freshness window, hashes the evidence, and returns:

- a private JSON evidence artifact;
- a grounded private answer artifact;
- a final assistant message;
- explicit limitations when an enabled LLM provider is not ready.

It does not require or call a model.

## Encrypted task journal

Enable with:

```dotenv
MIRA_HARNESS_ENABLED=true
MIRA_HARNESS_PERSISTENCE=true
MIRA_HARNESS_DB_PATH=/absolute/private/path/harness.sqlite
MIRA_HARNESS_MASTER_KEY=<independent-base64-32-byte-key>
MIRA_HARNESS_KEY_VERSION=v1
MIRA_HARNESS_MAX_STEPS=12
MIRA_HARNESS_EXECUTION_TIMEOUT_MS=120000
```

The journal uses:

- SQLite WAL, foreign keys, and `synchronous=FULL`;
- migration ledger version 1;
- AES-256-GCM ciphertext;
- a dedicated harness encryption key;
- the separate stable owner lookup key for opaque owner/idempotency/context indexes;
- authenticated metadata and SHA-256 encrypted-record hashes;
- mutable encrypted task snapshots;
- append-only, non-deletable encrypted lifecycle events;
- task delete prevention outside a future approved retention migration.

Tests verify reopen reads, migration idempotence, owner-scoped idempotency, absence of raw owner/device/session/input/idempotency/event details in database files, append-only triggers, immutable task identity, and authenticated metadata tamper detection.

### Restart limitation

The journal preserves task and event evidence across restart. This milestone does **not** automatically replay a task that was executing during process loss because generic replay could duplicate an external action. A future recovery coordinator must classify adapters as replay-safe, reconcilable, or owner-review-required and append an explicit recovery event before resuming or failing interrupted tasks.

## HTTP API

All endpoints are behind Mira's existing API-key pre-handler and independently resolve owner/device/session identity. All responses use `Cache-Control: no-store`.

### Capability discovery

```http
GET /api/v1/harness/card?device_id=<paired-device>
X-API-Key: <owner-key>
```

### Start task

```http
POST /api/v1/harness/tasks
X-API-Key: <owner-key>
Content-Type: application/json
```

```json
{
  "device_id": "paired-device",
  "context_id": "owner-context-1",
  "idempotency_key": "stable-retry-key",
  "capability_id": "system.status.read",
  "input": "Report current Mira system status.",
  "metadata": {}
}
```

The response is HTTP 202 and includes the task plus events already appended.

### Incremental event read

```http
GET /api/v1/harness/tasks/<task-id>?device_id=<paired-device>&after_sequence=<n>
X-API-Key: <owner-key>
```

### Cancel

```http
POST /api/v1/harness/tasks/<task-id>/cancel
X-API-Key: <owner-key>
Content-Type: application/json
```

### Approval decision

```http
POST /api/v1/harness/tasks/<task-id>/decision
X-API-Key: <owner-key>
Content-Type: application/json
```

The decision is bound to the authenticated owner session, task, and pending approval ID.

## Outer shell

The **Harness** panel is mounted alongside the existing Mira UI. It provides:

- memory-only paired-device and API-key inputs;
- owner-filtered capability discovery;
- capability metadata and risk display;
- bounded task submission;
- real task state and step count;
- task/context/capability/trace facts;
- incremental append-only event timeline;
- artifacts and metadata;
- final owner response or failure evidence;
- approval review, approve, and reject controls;
- cancellation when declared by the active capability.

The shell clears credentials and active polling on close, restores focus, supports Escape, uses live regions, responsive layout, reduced motion, and forced colors. It does not use local storage, session storage, cookies, or API keys in URLs.

The current transport uses authenticated incremental reads. A fetch-streaming transport can be added later without changing task/event contracts.

## Staging deployment

The owner-controlled staging example now requires a fourth independent key and journal path:

```dotenv
MIRA_HARNESS_ENABLED=true
MIRA_HARNESS_PERSISTENCE=true
MIRA_HARNESS_DB_PATH=/home/mira-staging/mira-state/greenfield/harness.sqlite
MIRA_HARNESS_MASTER_KEY=<fourth-independent-base64-32-byte-key>
MIRA_HARNESS_KEY_VERSION=v1
```

Preflight rejects:

- missing or placeholder values;
- keys that are not 32 bytes;
- reuse among trace, owner lookup, memory, and harness keys;
- journal paths outside owner-controlled persistent state;
- disabled harness or journal flags;
- broad secret-file permissions;
- destructive capabilities before explicit acceptance.

The staging smoke script authenticates, reads the harness card, creates or idempotently reuses a `system.status.read` task, waits for completion, verifies contiguous lifecycle events and shared trace identity, and checks evidence/answer artifacts. Uploaded evidence contains only protocol version, booleans, counts, and artifact kinds.

Live staging remains **BLOCKED** until the `mira-staging` self-hosted runner is connected and the protected environment approves an exact SHA.

## Validation commands

```bash
npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build --workspace aurora
npx tsc --noEmit --project tsconfig.json
npm run test:greenfield
npx eslint \
  'server/src/core/harness/**/*.{ts,js}' \
  'server/src/core/http-server/api/greenfield/**/*.{ts,js}' \
  'app/src/js/harness-*.js' \
  'test/greenfield/harness-*.ts' \
  --ignore-pattern .gitignore
npm run build:server
npm run build:app
npm run test:agentic-loop:unit
npm run test:over-http
bash -n scripts/deploy/staging-preflight.sh
bash -n scripts/deploy/staging-smoke.sh
```

## Deployment sequence

1. Preserve the current release, databases, keys, and configuration.
2. Generate a fourth independent 32-byte harness key outside source control.
3. Add the harness variables to the mode-600 owner environment file.
4. Run staging preflight.
5. Deploy an exact reviewed SHA through the protected workflow.
6. Confirm the harness card exposes only permitted capabilities.
7. Confirm a fresh status task completes and creates ordered causal events and evidence artifacts.
8. Restart the service and verify the task and events remain readable.
9. Inspect database and WAL files for raw secrets and owner content.
10. Exercise rollback and verify prior task evidence remains readable.

## Rollback

Immediate harness shutdown:

```dotenv
MIRA_HARNESS_ENABLED=false
MIRA_HARNESS_PERSISTENCE=false
```

Restart Mira and verify harness routes fail closed while the legacy greenfield request, trace, memory, and existing UI paths remain available according to their own feature flags.

Preserve the harness database and every key needed to decrypt retained task evidence. Code rollback is not authorization to delete tasks, events, artifacts, approvals, or causal evidence.

## Risks and next milestone

| Area | Status | Risk / next action |
| --- | --- | --- |
| Durable task/event evidence | TESTED | deployment restart evidence still BLOCKED |
| Automatic interrupted-task replay | NOT YET STARTED | must classify replay safety and prevent duplicate actions |
| Server push / SSE transport | NOT YET STARTED | incremental authenticated reads are current transport |
| Existing model manager adapter | NOT YET STARTED | wrap through `ModelProviderPort` with usage and guardrails |
| MCP transport and trust registry | NOT YET STARTED | implement allowlisted local/remote servers and consent UI |
| A2A remote-agent transport | NOT YET STARTED | implement authenticated cards, remote task mapping, and owner trust policy |
| Generic verified action adapter | NOT YET STARTED | integrate exact plans, approval, execution receipt, and verification |
| Memory context hook | NOT YET STARTED | retrieve historical memory only when capability policy permits it |
| Current-evidence retrieval hook | NOT YET STARTED | add replaceable source-grounding providers beyond runtime status |
| Browser end-to-end acceptance | BLOCKED | no connected staging browser environment |
| Production readiness | BLOCKED | full file-12 evidence is incomplete |

The next production vertical slice should wrap one existing model provider through `ModelProviderPort`, expose one allowlisted MCP-style tool capability, require the harness to resolve and approve any high-risk call, persist all lifecycle events, and render the complete task in the owner shell. No generic remote tool or agent should be enabled before that slice is independently verified.
