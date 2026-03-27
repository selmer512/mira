# Leon API Contract

This document describes the stable HTTP and Socket.IO contracts that lightweight clients
(Smart Mirror, iOS, watchOS) should target. All examples use API version `v1`.

---

## HTTP API

Base path: `/api/v1`

### Authentication

Endpoints under `POST /api/v1/utterance` require the HTTP API to be enabled
(`LEON_HTTP_API_KEY` set in `.env`) and the key supplied in every request:

```
X-Leon-Api-Key: <your-key>
```

All other endpoints are unauthenticated.

---

### GET /api/v1/info

Fetch server capabilities. Call this once on startup to drive capability-aware UI.

**Request**

```
GET /api/v1/info
```

**Response – success**

```json
{
  "success": true,
  "status": 200,
  "code": "info_pulled",
  "message": "Information pulled.",
  "after_speech": false,
  "telemetry": false,
  "shouldWarmUpLLMDuties": true,
  "isLLMActionRecognitionEnabled": true,
  "isLLMNLGEnabled": true,
  "timeZone": "America/New_York",
  "gpu": "NVIDIA GeForce RTX 4090",
  "graphicsComputeAPI": "CUDA",
  "totalVRAM": 24,
  "freeVRAM": 18,
  "usedVRAM": 6,
  "llm": {
    "enabled": true,
    "provider": "openai",
    "workflowProvider": "openai",
    "agentProvider": "openai",
    "workflowModel": "gpt-4o",
    "agentModel": "gpt-4o",
    "localModel": ""
  },
  "stt": {
    "enabled": true,
    "provider": "google"
  },
  "tts": {
    "enabled": true,
    "provider": "google"
  },
  "routingMode": "llm",
  "tcpServer": {
    "enabled": false
  },
  "mood": {
    "type": "happy",
    "emoji": "😊"
  },
  "version": "1.0.0-beta.10"
}
```

**Feature flags for UI behaviour**

| Field | Usage |
|---|---|
| `llm.enabled` | Show/hide LLM-powered features |
| `stt.enabled` | Show/hide microphone button |
| `tts.enabled` | Enable audio playback of responses |
| `shouldWarmUpLLMDuties` | Wait for `warmup-llm-duties` socket event before first utterance |
| `routingMode` | `"llm"` or `"nlp"` — affects routing indicator in UI |

---

### POST /api/v1/utterance

Submit a natural-language utterance for Leon to process.

**Request**

```
POST /api/v1/utterance
Content-Type: application/json
X-Leon-Api-Key: <key>

{
  "utterance": "What's the weather in Paris?"
}
```

**Response – success**

```json
{
  "success": true,
  "status": 200,
  "code": "utterance_processed",
  "message": "Utterance processed."
}
```

**Response – error**

```json
{
  "success": false,
  "status": 500,
  "code": "utterance_error",
  "message": "Failed to process utterance."
}
```

---

### POST /api/v1/run-action

Execute a skill action directly without natural-language routing.

**Request**

```
POST /api/v1/run-action
Content-Type: application/json

{
  "skill_action": "timer:create-timer",
  "action_params": {
    "action_arguments": ["5"],
    "duration": 5,
    "unit": "minutes"
  }
}
```

`skill_action` format: `<skill-name>:<action-name>`

**Response – action executed**

```json
{
  "success": true,
  "status": 200,
  "code": "action_executed",
  "message": "Skill action executed successfully.",
  "result": {
    "lastOutputFromSkill": {
      "speech": "Timer set for 5 minutes."
    }
  }
}
```

**Response – action not executed**

```json
{
  "success": true,
  "status": 200,
  "code": "action_not_executed",
  "message": "Skill action not executed.",
  "result": null
}
```

**Error responses**

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `missing_params` | `skill_action` or `action_params` missing |
| 400 | `skill_action_not_valid` | `skill_action` not in `skill:action` format |
| 500 | `run_action_error` | Unexpected execution error |

---

### GET /api/v1/fetch-widget

Fetch a cached widget component tree.

**Request**

```
GET /api/v1/fetch-widget?skill_action=todos%3Alist-todos&widget_id=widget-42
```

**Response – widget found**

```json
{
  "success": true,
  "status": 200,
  "code": "widget_fetched",
  "message": "Widget fetched successfully.",
  "widget": {
    "type": "List",
    "items": [
      { "id": "1", "label": "Buy groceries" },
      { "id": "2", "label": "Walk the dog" }
    ]
  }
}
```

**Response – widget not found**

```json
{
  "success": true,
  "status": 200,
  "code": "widget_not_fetched",
  "message": "Widget not fetched.",
  "widget": null
}
```

**Error responses**

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `missing_params` | `skill_action` or `widget_id` missing |
| 400 | `skill_action_not_valid` | `skill_action` not in `skill:action` format |
| 500 | `fetch_widget_error` | Unexpected execution error |

---

## Socket.IO Events

Connect to the root namespace of the Leon server (default: `http://localhost:1337`).

### Initialization handshake sequence

```
Client → server:  init("web-lite")
Server → client:  init-client-core-server-handshake("success")
Server → client:  init-tcp-server-boot("success")   // once Python bridge is ready
Server → client:  init-llm("success")               // once LLM is loaded (if enabled)
Server → client:  warmup-llm-duties("success")      // once LLM duties are warm (if configured)
Server → client:  ready                              // safe to send utterances
```

For clients where `shouldWarmUpLLMDuties` is `false` (from `/info`), the `ready` event
arrives before `warmup-llm-duties`.

---

### Server → Client events

| Event | Payload | Description |
|---|---|---|
| `init-client-core-server-handshake` | `"success"` | Handshake confirmed |
| `init-tcp-server-boot` | `"success"` | Python TCP bridge ready |
| `init-llm` | `"loading" \| "success" \| "error"` | LLM load state |
| `init-llama-server-boot` | `"loading" \| "success" \| "error"` | llama.cpp server state |
| `warmup-llm-duties` | `"success"` | LLM duties warmed up |
| `ready` | _(none)_ | All systems ready |
| `is-typing` | `boolean` | Leon generating/finished a response |
| `enable-record` | _(none)_ | Instruct client to enable audio capture |
| `widget-send-utterance` | `string` | Utterance relayed from widget interaction |

---

### Client → Server events

| Event | Payload | Description |
|---|---|---|
| `init` | `string` (client type, e.g. `"web-lite"`) | Start initialization |
| `utterance` | `{ client: string, value: string }` | Submit utterance over socket |
| `hotword-detected` | `{ hotword: string, buffer: ArrayBuffer }` | Hotword triggered |
| `asr-start-record` | _(none)_ | Begin streaming audio for ASR |
| `recognize` | `ArrayBuffer` | Audio buffer chunk for ASR |
| `widget-event` | `{ method: { methodName, methodParams }, data }` | Widget interaction |

---

### Utterance over Socket example

```js
socket.emit('utterance', {
  client: 'web-lite',
  value: 'Set a timer for 10 minutes'
})
```

---

## Error shape (LeonAPIError)

All HTTP errors from the Frontend SDK are wrapped in a `LeonAPIError` with the following
shape:

```ts
{
  name: "LeonAPIError"
  message: string       // human-readable
  status: number        // HTTP status (0 = network error)
  code: string          // machine-readable code
  retryable: boolean    // true for 5xx and 429
  retryAfterMs: number | null  // from Retry-After header (ms)
}
```

Clients should check `retryable` before scheduling retry attempts and honour
`retryAfterMs` when non-null.

---

## Reconnect semantics

After a socket disconnection:

1. Re-emit `init` with the client type string to restart the handshake.
2. Wait for the `ready` event before submitting new utterances.
3. Clients should **not** replay in-flight utterances automatically — surface the
   disconnection to the user and let them re-submit if needed.
4. Widget cache (`(skill_action, widget_id)` → component tree) can be retained
   across reconnects as it is immutable once fetched.
