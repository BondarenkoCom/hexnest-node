# HexNest Node Manager UI

## Overview

HexNest Node ships with a built-in local manager UI for:

- operator authentication
- node readiness and status
- adapter and model management
- runtime configuration
- core reconnect and detach flows

The same UI is used in:

- browser mode via `npm run dev`
- desktop shell mode via `npm run desktop:dev`

## Launch Modes

### Browser mode

```bash
npm run dev
```

The terminal prints the active local URL.

Typical example:

```text
[hexnest-web] server running at http://127.0.0.1:3000
```

If that port is already occupied, HexNest Node automatically switches to a free port unless strict port mode is enabled.

### Desktop shell mode

```bash
npm run desktop:dev
```

This starts the Tauri shell, launches the local runtime, and routes the desktop window into the same local manager.

## Main Features

### Operator auth

- sign up from the local manager
- sign in from the local manager
- maintain a local authenticated session
- reconnect to core immediately after auth

### Readiness and node status

- operator session visibility
- core reachability checks
- node identity status
- model readiness checks
- provider coverage summary
- recent runtime activity

### Model management

- add, edit, enable, disable, and remove models
- manage Ollama, OpenAI, and Claude provider settings
- activate a model per provider type

### Runtime and core actions

- reconnect to core
- disconnect from core
- reset node identity
- remove current node from core

## URL and Port Behavior

### Default host

```env
HEXNEST_WEB_HOST=127.0.0.1
```

### Default port

```env
HEXNEST_WEB_PORT=3000
```

### Automatic free port selection

If the requested port is busy, the runtime can fall back to an available local port.

Explicit automatic selection:

```env
HEXNEST_WEB_PORT=0
```

### Strict port mode

If you want startup to fail instead of switching ports:

```env
HEXNEST_WEB_PORT_STRICT=true
```

## Desktop Shell Behavior

The Tauri shell currently adds desktop-specific UX on top of the same manager UI.

Included behavior:

- single-instance app behavior
- tray icon support
- close hides window to tray instead of stopping the runtime
- tray menu actions for show, hide, and quit

Development command:

```bash
npm run desktop:dev
```

Packaged desktop flow:

```bash
npm run desktop:sidecar
npm run desktop:build
```

## API Surface

### Public auth routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/health`

### Protected routes

- `GET /api/status`
- `GET /api/status/readiness`
- `GET /api/models`
- `POST /api/models`
- `PATCH /api/models/:name`
- `DELETE /api/models/:name`
- `GET /api/config`
- `PATCH /api/config`
- core management routes under `/api/core`
- room inspection routes under `/api/rooms`

## Typical Operator Flow

1. Start the local manager.
2. Sign up or sign in from the local auth screen.
3. Review readiness.
4. Add or activate your model providers.
5. Confirm that the node is connected to core.

## Development Notes

### Frontend assets

- `public/index.html`

### Local web server

- `src/web/server.ts`
- `src/web/api/`

### Desktop shell scaffold

- `src-tauri/src/main.rs`
- `src-tauri/tauri.conf.json`
- `desktop/index.html`
- `desktop/styles.css`

## Troubleshooting

### The browser tab does not open on port 3000

Check the actual URL printed by the runtime. The manager may have switched to another free local port.

### The desktop window disappears after close

That is expected in desktop mode. Use the tray icon to restore the window.

### The manager shows local mode

This usually means one of the following:

- core is unreachable
- operator is not signed in yet
- node identity needs to be refreshed

Use the readiness view and reconnect action to inspect the current state.

## Summary

Think of the HexNest Node UI as a local node manager, not just a static web page.
It is now the primary operator surface for both authentication and day-to-day runtime control.
