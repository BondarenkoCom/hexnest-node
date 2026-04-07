# User Authentication and Node Registration

## Overview

HexNest Node now supports operator authentication directly from the local node manager.

The current flow is:

1. Start the local node manager
2. Sign up or sign in from the local auth screen
3. Let the runtime reconnect to HexNest Core automatically
4. Use the returned operator session to attach or register the node

Manual JWT copy-paste into `.env` is no longer the primary operator workflow.

## Where Authentication Happens

### Core platform

The HexNest core platform still owns user accounts and credentials.

Relevant upstream endpoints include:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/nodes/register`

### Local node manager

HexNest Node exposes local auth routes through its embedded manager:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`

The local manager proxies registration and login to core, stores the resulting operator session locally, and then tries to reconnect the node immediately.

## Recommended Operator Flow

### Step 1. Prepare the node locally

```bash
cd hexnest-node
npm install
cp .env.example .env
npm run setup
```

### Step 2. Start the node manager

For browser mode:

```bash
npm run dev
```

For desktop shell mode:

```bash
npm run desktop:dev
```

### Step 3. Authenticate from the local manager

Use one of these options:

- create a new operator account
- sign in with an existing operator account

On success, the local manager:

- stores `user_email` in the local database
- stores `user_token` in the local database
- creates a local authenticated session
- triggers a runtime reconnect to core

### Step 4. Let the runtime attach to core

After authentication, the runtime tries to:

- reuse the current node identity if valid
- reset a stale identity if needed
- register a fresh node if no valid identity exists
- report the result back to the local UI

The response flow includes:

- `coreUrl`
- `coreConnected`
- `nodeId`
- optional `coreConnectionError`

## Local Storage Model

### Stored in the local database

- operator email
- operator token
- node configuration values
- node identity
- model configuration

### Legacy identity file support

HexNest Node still supports the legacy identity file for compatibility:

- `.hexnest-identity.json`

If present, it can be migrated into the local database.

## Registration Behavior

Once the operator session is valid, HexNest Node registers or reconnects the node under that operator account.

Typical outcomes:

- `coreConnected: true` and a valid `nodeId`
- `coreConnected: false` with a connection error message
- local mode if core is unavailable

Depending on the core environment, the node may be:

- approved immediately
- placed in pending review

## Browser and Desktop UX

### Browser mode

The terminal prints the local URL:

```text
[hexnest-web] server running at http://127.0.0.1:3000
```

If the preferred port is occupied, the runtime selects a free one automatically.

### Desktop shell mode

The Tauri shell starts the runtime for you and redirects to the local manager automatically.

Additional desktop behavior:

- single-instance shell behavior
- close hides to tray
- tray menu supports show, hide, and quit

## Environment Variables

### Still useful

```env
HEXNEST_CORE_URL=https://hex-nest.com
HEXNEST_NODE_NAME=MyWorkerNode
HEXNEST_OPERATOR_NAME=Alice Labs
HEXNEST_OPERATOR_EMAIL=alice@example.com
```

### Optional manual auth injection

Manual auth in `.env` still works when needed:

```env
HEXNEST_USER_EMAIL=alice@example.com
HEXNEST_USER_TOKEN=eyJhbGc...xyz
```

Use this only when you explicitly want to seed auth without going through the local sign-in UI.

### Auto-managed values

HexNest Node may store and refresh these locally over time:

```env
HEXNEST_NODE_ID=node-abc123
HEXNEST_NODE_TOKEN=node_token_xyz
```

Those values are not the primary place of truth anymore when the local database is active.

## Troubleshooting

### Login succeeds but core stays disconnected

Look for:

- unreachable core URL
- revoked or stale node identity
- upstream core errors

The local auth response may include `coreConnectionError` with the reason.

### Local auth returns upstream error

HexNest Node maps upstream auth failures to JSON errors instead of exposing raw browser failures.

Typical cases:

- `400` invalid form payload
- `401` invalid credentials
- `503` core unavailable
- `504` upstream timeout

### Node was deleted in core

If core rejects heartbeat or usage submission with `401` or `404`, the runtime can clear the local identity and fall back to local mode.

At that point, sign in again or reconnect from the local manager.

### Operator wants to detach the node

The local manager supports protected operator flows for:

- disconnect from core
- reset local node identity
- remove the node from core

## Security Notes

### Operator token

- issued by core auth
- stored locally by HexNest Node
- used to reconnect or register the node under the operator account

### Node token

- issued after node registration
- used for node-to-core operations such as heartbeat and usage submission

### Best practice

- do not commit `.env`
- treat the local database and identity artifacts as sensitive operator data
- prefer desktop app data directories or managed runtime paths in packaged desktop mode

## Summary

The intended operator experience is now:

1. start HexNest Node locally
2. authenticate in the local manager
3. let the runtime reconnect and register itself automatically

That is the same auth model used by both browser mode and the Tauri desktop shell.

## Migration from Old Setup

If you had old hexnest-node without user auth:

```bash
# 1. Update .env with new fields
cp .env.example .env.new
# Copy old values except HEXNEST_NODE_TOKEN/ID

# 2. Add user token from signup
HEXNEST_USER_TEST=alice@example.com
HEXNEST_USER_TOKEN=... # from web UI

# 3. Delete old identity file
rm .hexnest-identity.json

# 4. Clear old node registration
# → Core will see it as new node with new owner

# 5. Start fresh
npm run dev
```

## Next Steps

- [ ] Test: `npm run config:test`
- [ ] Sign up: https://hex-nest.com/signup
- [ ] Add token to `.env`
- [ ] Start: `npm run dev`
- [ ] Approve: https://hex-nest.com/admin/nodes
- [ ] Watch: http://localhost:3000 (node web UI)

## Related Files

- [SignUpPage.tsx](../hexnest-mvp-showcase/frontend/src/pages/SignUpPage.tsx) — Web UI registration
- [SignInPage.tsx](../hexnest-mvp-showcase/frontend/src/pages/SignInPage.tsx) — Web UI login
- [src/routes/auth.ts](../hexnest-mvp-showcase/src/routes/auth.ts) — Auth endpoints
- [src/routes/nodes.ts](../hexnest-mvp-showcase/src/routes/nodes.ts) — Node registration (line 195)
- [src/protocol/HexNestClient.ts](./src/protocol/HexNestClient.ts) — API client methods
- [src/core/NodeRuntime.ts](./src/core/NodeRuntime.ts) — Node startup with auth
- [.env.example](./.env.example) — Configuration template
- [README.md](./README.md) — Quick start guide
