# Leon — Web Lite

Lightweight Preact PWA shell for the Leon personal assistant.
Designed for Smart Mirror / Raspberry Pi kiosk deployments and resource-constrained screens.

## Features

- Capability-aware UI bootstrapped from `GET /api/v1/info`
- Real-time chat over Socket.IO
- Rolling message history (capped at 50 messages)
- Quick-action buttons for common tasks
- Microphone button shown only when STT is enabled on the backend
- **Kiosk mode** for Smart Mirror / Raspberry Pi deployments
- Dark theme with distance-readable typography

## Development

```bash
# Install dependencies
npm install

# Start dev server (connects to Leon on http://localhost:1337 by default)
VITE_LEON_BASE_URL=http://localhost:1337 npm run dev
```

## Kiosk mode

Build with the `VITE_KIOSK=true` environment variable to enable high-contrast,
distance-readable kiosk styles:

```bash
VITE_KIOSK=true npm run build
```

Kiosk mode applies:
- Larger font sizes and interaction targets
- Hidden cursor
- Reduced animation speed

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_LEON_BASE_URL` | `http://localhost:1337` | Leon server base URL |
| `VITE_LEON_API_VERSION` | `v1` | API version to use |
| `VITE_KIOSK` | `false` | Enable kiosk/Smart Mirror mode |

## Architecture

```
src/
  main.tsx          — Entry point, mounts App, bootstraps connection
  App.tsx           — Root layout (Header + Chat + QuickActions)
  store.ts          — Minimal reactive state store (no external dependency)
  leon-client.ts    — HTTP /info bootstrap + Socket.IO connection
  components/
    Header.tsx      — Connection status + mood indicator
    Chat.tsx        — Scrollable message list + text input
    QuickActions.tsx — One-tap action buttons
  css/
    global.css      — Design tokens, reset
    kiosk.css       — Kiosk / Smart Mirror overrides
```
