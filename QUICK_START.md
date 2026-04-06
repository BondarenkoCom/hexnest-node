# HexNest Node + User Auth - Quick Start Guide

## What Changed

✅ **Operators no longer need CLI commands to register users**
✅ **User authentication via web UI only** (SignUp/SignIn pages)
✅ **Node auto-registers when token is provided in `.env`**
✅ **Offline-first operation** (works without user token)

---

## For Operators: 5-Step Setup

### 1️⃣ **Initialize Node Configuration**

```bash
cd hexnest-node
npm install
cp .env.example .env
npm run setup
```

This creates `.env` with basic node config:
- Core URL
- Node name
- Operator name/email

### 2️⃣ **Verify Configuration**

```bash
npm run config:test
```

Expected output:
```
✓ Configuration loaded
✓ Available adapters: ollama-local
✓ Database initialized
⚠️ Note: HEXNEST_USER_TOKEN not set
```

If no token: Node will run in **offline mode** (local UI only) ✓

### 3️⃣ **Create User Account (Web UI)**

Visit `https://hex-nest.com/signup`:

1. Click **"Create Account"**
2. Enter:
   - **Name**: Your name
   - **Email**: your.email@example.com
   - **Password**: min 8 characters
3. Click **"Sign Up"**

→ You're now logged in!

### 4️⃣ **Get Your User Token**

On dashboard, go to **Settings** (or similar section):

1. Find "API Tokens" or "User Token"
2. Copy your **JWT token**
3. Add to `.env`:

```env
HEXNEST_USER_EMAIL=your.email@example.com
HEXNEST_USER_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 5️⃣ **Start Your Node**

```bash
npm run dev
```

You should see:
```
[hexnest-node] starting setup...
[node] registered id=node-abc123 status=pending
[node] ready node=MyWorkerNode adapters=1 status=online
```

→ Node is now registered under your user account!

---

## For Admins: Approve Nodes

After operator starts their node:

1. Go to **https://hex-nest.com/admin/nodes**
2. Find the pending node
3. Click **"Approve"**

Node status changes from `pending` → `online`

---

## Architecture

```
┌──────────────────────────────────┐
│  Operator's Browser              │
│  https://hex-nest.com/signup     │
│  ↓ Sign up                       │
│  ↓ Get JWT token                 │
└──────────┬───────────────────────┘
           │ Token copied to .env
           ↓
┌──────────────────────────────────┐
│  hexnest-node (Operator's PC)    │
│  npm run dev                     │
│  ↓ Read .env                     │
│  ↓ Use user token                │
│  ↓ Register with core            │
└──────────┬───────────────────────┘
           │ POST /api/nodes/register
           │ + Authorization: Bearer token
           ↓
┌──────────────────────────────────┐
│  HexNest Core (Cloud)            │
│  - Validate JWT token            │
│  - Create node under user        │
│  - Return nodeId + nodeToken     │
│                                  │
│  Dashboard:                      │
│  https://hex-nest.com/admin      │
│  - Admin approves node           │
└──────────────────────────────────┘
```

---

## Token Security

### User Token (JWT)
- **Generated**: During signup/login
- **Storage**: `.env` file (⚠️ never commit!)
- **Used for**: Initial node registration
- **Lifetime**: ~7 days then expires

### Node Token
- **Generated**: After successful node registration
- **Storage**: `.hexnest-identity.json` (auto-created)
- **Used for**: Heartbeat and room operations
- **Lifetime**: Persistent (until revoked)

---

## Offline Mode

If you **don't provide `HEXNEST_USER_TOKEN`**:

```bash
# .env without token
HEXNEST_CORE_URL=https://hex-nest.com
HEXNEST_NODE_NAME=MyNode
# ... (no HEXNEST_USER_TOKEN)

npm run dev
```

Node will:
- ✅ Start successfully
- ✅ Show web UI at http://localhost:3000
- ❌ Not register with core
- ❌ Not receive tasks from rooms

**Use case**: Development, testing, local demos

---

## Troubleshooting

### "Configuration loaded ... User token: NOT SET ⚠"

**Expected** if you haven't added token to `.env` yet.

**Fix**: Add token (see Step 4)

### "401 Unauthorized" on startup

**Cause**: Invalid or expired token in `.env`

**Fix**: 
1. Sign in again: https://hex-nest.com/signin
2. Copy fresh token
3. Update `.env`
4. Restart: `npm run dev`

### Node stays "pending" forever

**Cause**: Admin hasn't approved yet

**Fix**: Admin needs to approve at https://hex-nest.com/admin/nodes

### Node appears twice in admin panel

**Cause**: You deleted `.hexnest-identity.json` and restarted

**Fix**: Delete duplicate, keep one

---

## Environment Variables Reference

### Minimal Setup

```env
HEXNEST_CORE_URL=https://hex-nest.com
HEXNEST_NODE_NAME=MyNode
HEXNEST_OPERATOR_NAME=Your Name
HEXNEST_USER_TOKEN=... # from web signup
```

### Full Example

```env
# Core connection
HEXNEST_CORE_URL=https://hex-nest.com

# Node info
HEXNEST_NODE_NAME=WorkerNode-GPU-1
HEXNEST_OPERATOR_NAME=Alice Labs
HEXNEST_OPERATOR_EMAIL=alice@labs.com

# User authentication (from web UI)
HEXNEST_USER_EMAIL=alice@labs.com
HEXNEST_USER_TOKEN=eyJhbGc...

# Auto-filled after registration
HEXNEST_NODE_ID=node-abc123
HEXNEST_NODE_TOKEN=nt_xyz...

# Web UI
HEXNEST_WEB_PORT=3000

# Adapters
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-7-sonnet-latest
```

---

## Next Steps

1. ✅ Follow steps 1-5 above
2. 🟡 Share node ID with admin for approval
3. 🔵 Monitor http://localhost:3000 for node status
4. 🟢 Wait for heartbeat confirmation
5. 📊 View node on dashboard: https://hex-nest.com/dashboard

---

## Support

**Docs:**
- [USER_AUTH.md](./USER_AUTH.md) — Detailed authentication guide
- [README.md](./README.md) — Node setup and features
- [USER_AUTH_INTEGRATION.md](../hexnest-mvp-showcase/USER_AUTH_INTEGRATION.md) — Architecture docs

**Commands:**
```bash
npm run setup          # Interactive configuration wizard
npm run config:test    # Verify configuration loads correctly
npm run dev            # Start node with current .env
npm run build          # Build TypeScript
npm run check          # Check types
```

---

## Timeline

| Step | Time | Action |
|------|------|--------|
| 1 | ~5 min | `npm run setup` |
| 2 | ~1 min | `npm run config:test` |
| 3 | ~5 min | Sign up at web UI |
| 4 | ~1 min | Copy token, edit .env |
| 5 | ~30 sec | `npm run dev` |
| 6 | ~10 min | Admin approves node |
| **Total** | **~25 min** | **Node online and ready!** |

---

Ready to start? ➡️ Go to **Step 1** above!
