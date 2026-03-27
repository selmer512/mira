# Lightweight Frontend Plan (Raspberry Pi, Smart Mirror, Apple Watch, iOS)

## 1) What the current codebase already gives us

The current Leon codebase already exposes a good backend contract for thin clients:

- Real-time channel via Socket.IO (`server/src/core/socket-server.ts`) for:
  - app initialization status,
  - streaming/interactive events,
  - utterance submission,
  - widget events.
- HTTP API via Fastify (`server/src/core/http-server/http-server.ts`) including:
  - `GET /api/{version}/info` for runtime capabilities,
  - `POST /api/{version}/utterance` for text-to-response,
  - `POST /api/{version}/run-action` for direct action execution,
  - `GET /api/{version}/fetch-widget` for widget retrieval,
  - `POST /api/{version}/llm-inference` for optional direct duty invocations.
- Existing web app (`app/`) can be treated as a reference implementation, but it is heavier than needed for low-power and wearable use-cases.

Implication: we can keep one Leon backend and build platform-specific lightweight UIs on top of stable HTTP/WebSocket contracts, instead of porting core logic to each device.

## 2) Product strategy: one shared "thin-client" protocol, many shells

Build a **Frontend SDK + protocol adapter** first, then platform apps:

- Shared package: `frontend-sdk` (TypeScript-first, generated models from API contracts).
- Transport adapters:
  - `http-adapter` for request/response actions.
  - `socket-adapter` for real-time conversational state.
- UI shells:
  1. **Web Lite / Smart Mirror** (PWA, kiosk mode)
  2. **iOS app** (SwiftUI)
  3. **watchOS companion** (intent-first, glance UI)

Why this order:

1. Fastest validation on constrained hardware (Pi + Smart Mirror).
2. Reuses same backend contract.
3. iOS/watchOS can share logic through identical backend endpoints and event semantics.

## 3) Non-negotiable constraints for low-powered hardware

- Prefer **server-side intelligence** and minimal client compute.
- Keep UI at 30 FPS target acceptable for Pi-class GPUs; avoid heavy animation layers.
- Avoid long-lived large in-memory histories on client; keep rolling window + lazy pagination.
- Use push/event deltas over full-state redraw.
- Voice features should degrade gracefully if on-device STT/TTS is unavailable.
- Keep network payloads compact (IDs + delta events, avoid repeated full widget trees).

## 4) Proposed architecture

## 4.1 Frontend contract layer

Create a versioned client contract:

- `LeonSession`
  - init handshake (capabilities from `/info`)
  - send utterance
  - subscribe to answer/tool/widget events
- `LeonActionRunner`
  - wrapper for `/run-action`
- `LeonWidgetClient`
  - wrapper for `/fetch-widget`
- `LeonRealtime`
  - Socket.IO event map and typed payloads

Add explicit feature flags from `/info` to drive UI behavior:

- `llm.enabled`, `stt.enabled`, `tts.enabled`, `routingMode`, `shouldWarmUpLLMDuties`, etc.

## 4.2 State model for thin clients

Adopt a minimal store shape:

- `connection`: disconnected | connecting | ready
- `capabilities`: derived from `/info`
- `conversation`: rolling messages list (bounded)
- `widgets`: keyed cache by `(skill_action, widget_id)`
- `inputMode`: text | voice
- `telemetry`: optional perf counters

This keeps watchOS and Smart Mirror implementations aligned.

## 4.3 Rendering model

- Use platform-native primitives (not full parity with existing web app UI).
- Represent widgets as:
  1. Native components for top N critical widgets.
  2. Generic fallback card for unsupported widget types.

This avoids blocking platform delivery on complete widget-system parity.

## 5) Platform plans

## 5.1 Raspberry Pi + Smart Mirror (Phase 1)

Target: browser-based kiosk/PWA.

- Stack:
  - `Vite + Preact` (smaller runtime vs React)
  - optional `Socket.IO client` only when needed
  - CSS with low-motion defaults
- Features (MVP):
  - wake screen + clock + weather + recent assistant outputs
  - text input + optional microphone button
  - skill quick-actions (timer, weather, media controls)
- Performance tactics:
  - no large virtualized chat until needed
  - capped message history (e.g., 50)
  - static asset budget and deferred hydration
- Smart Mirror specifics:
  - high-contrast theme
  - distance-readable typography
  - optional auto-hide verbose logs/metadata

## 5.2 iOS app (Phase 2)

Target: SwiftUI app with strong offline UX shell.

- Modules:
  - `LeonAPI` (HTTP)
  - `LeonRealtime` (Socket.IO Swift client)
  - `ConversationView`, `QuickActionsView`, `WidgetHostView`
- Features (MVP):
  - text-first conversation
  - push-to-talk button (if STT enabled on backend)
  - run-action shortcuts
  - widget detail screens
- iOS platform extras (post-MVP):
  - Siri Shortcut handoff to Leon endpoints
  - Home Screen widgets for quick actions

## 5.3 watchOS companion (Phase 3)

Target: glanceable + action-centric interface.

- Features (MVP):
  - recent response card
  - dictation -> utterance
  - 3-5 one-tap actions (timer, reminder-style prompts)
- Constraints handling:
  - avoid continuous socket where unnecessary
  - prefer short HTTP requests + occasional sync
  - strict payload trimming

## 6) Backend alignment needed before frontend build-out

To reduce frontend complexity and improve stability:

1. **Publish an API contract** (OpenAPI + Socket event schema) from current routes/events.
2. **Add response IDs and correlation IDs** consistently across utterance/action/widget flows.
3. **Formalize widget schema versions** and deprecation policy.
4. **Add lightweight auth story** for mobile/watch clients (API key/session token lifecycle).
5. **Define reconnect semantics** (what to replay after socket reconnect).

## 7) Delivery roadmap (10 weeks)

### Weeks 1-2: Contract & foundations
- Extract typed API models from current endpoints.
- Build frontend SDK (TS package) + mock server fixtures.
- Define performance budgets for Pi and watchOS.

### Weeks 3-5: Web Lite / Smart Mirror MVP
- Build PWA shell + conversation + quick actions.
- Add capability-driven UI toggles from `/info`.
- Validate on Raspberry Pi kiosk setup.

### Weeks 6-8: iOS MVP
- Implement Swift client for endpoints and core flows.
- Ship conversation + quick actions + widget fallback renderer.
- Internal testflight build.

### Weeks 9-10: watchOS MVP
- Add minimal companion experience.
- Dictation -> utterance and quick actions.
- Battery/performance tuning and reconnect behavior.

## 8) Success criteria

- Raspberry Pi/Smart Mirror:
  - cold start to interactive under 3s on target hardware.
  - sustained low CPU usage while idle.
- iOS:
  - first-response latency parity with web lite.
  - crash-free session target > 99%.
- watchOS:
  - sub-2s quick-action trigger path for cached session.

## 9) Immediate next tasks (implementation-ready)

1. Create `packages/frontend-sdk` with typed clients for `/info`, `/utterance`, `/run-action`, `/fetch-widget`.
2. Add `docs/api-contract.md` with HTTP and socket event payload examples.
3. Build `apps/web-lite` (Preact) with capability-aware home + chat view.
4. Add a "kiosk mode" configuration profile for Smart Mirror deployments.
5. Start iOS proof-of-concept with two screens: conversation + quick actions.

---

This plan intentionally keeps the existing Leon backend as the single source of intelligence while shipping small, resilient clients tailored for low-power and wearable environments.
