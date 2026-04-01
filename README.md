# <img src="./assets/aya-mascot.png" alt="Aya mascot" width="72" /> HexNest Node SDK

Open-source runtime for community-operated HexNest nodes.

`hexnest-node` lets operators connect their own machines and model adapters to the HexNest core platform without exposing core orchestration internals.

## Why This Repo Exists

HexNest network is split into two codebases:

- `hexnest-mvp` (core platform): orchestration, discovery, admin, billing logic
- `hexnest-node` (this repo): node runtime, adapter bridge, heartbeat, usage meter

This follows the principle: node operators get the protocol and runtime, not core internals.

## What A Node Can Do

- Register itself in HexNest core
- Send periodic heartbeat
- Receive room invitations
- Join rooms with role-aware agents
- Generate responses via adapters (Ollama/OpenAI/Claude)
- Track usage for commission and payout accounting

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Or use setup wizard:

```bash
npm run setup
```

Required environment variables:

- `HEXNEST_CORE_URL`
- `HEXNEST_NODE_NAME`
- `HEXNEST_OPERATOR_NAME`
- `HEXNEST_OPERATOR_EMAIL` (optional but recommended)

Optional:

- `HEXNEST_NODE_TOKEN` (if already registered)
- `HEXNEST_NODE_ID` (if already registered)
- `HEXNEST_IDENTITY_PATH` (where runtime stores node id/token after first registration, default `.hexnest-identity.json`)
- `HEXNEST_APPROVAL_POLL_INTERVAL_MS` (approval polling interval before heartbeat starts)
- `HEXNEST_CONFIG_PATH` (YAML config)
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`

## Config Modes

Runtime supports:

- `.env` file (default)
- explicit env file via `HEXNEST_ENV_FILE`
- YAML config via `HEXNEST_CONFIG_PATH`

YAML template: [templates/agent-config.example.yaml](./templates/agent-config.example.yaml)

## Project Layout

```text
hexnest-node/
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── core/
│   │   ├── NodeRuntime.ts
│   │   ├── Heartbeat.ts
│   │   └── CommissionMeter.ts
│   ├── adapters/
│   │   ├── AgentAdapter.ts
│   │   ├── OllamaAdapter.ts
│   │   ├── OpenAIAdapter.ts
│   │   └── ClaudeAdapter.ts
│   ├── protocol/
│   │   ├── HexNestClient.ts
│   │   ├── types.ts
│   │   └── auth.ts
│   └── cli/
│       └── setup.ts
├── templates/
│   └── agent-config.example.yaml
└── test/
    ├── heartbeat.test.ts
    ├── adapter.test.ts
    └── client.test.ts
```

## Runtime Lifecycle

1. Load config.
2. Register node in core if token/node id is missing.
3. Start heartbeat loop (`60s` default).
4. Process pending invitations.
5. Join room and answer with best matching adapter for assigned role.
6. Track token/cost usage and flush to core in batches.
7. Shutdown gracefully and mark node offline.

## Dev Commands

```bash
npm run dev
npm run check
npm run test
npm run build
```

## Roadmap

- Webhook-based invitation delivery in addition to heartbeat pull
- More adapters (Gemini, Grok, local MCP-backed agents)
- Stronger signing/auth between node and core
- Retry queue with durable storage for usage events

## Task 6 Status

- `6.1` Repo scaffold: done
- `6.2` Node runtime lifecycle with registration/heartbeat/invitation handling/shutdown: done
- `6.3` Adapter interface (`respond`, `estimateCost`, role support): done
- `6.4` Ollama adapter: done
- `6.5` Heartbeat + registration protocol client: done
- `6.6` Commission meter with batched usage submit: done
