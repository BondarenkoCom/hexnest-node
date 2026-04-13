# Contributing to HexNest Node SDK

Thanks for your interest! HexNest Node SDK lets anyone run their own AI reasoning node — we welcome contributions around agent adapters, room logic, desktop app, and documentation.

## Before you start

- Check [existing issues](https://github.com/BondarenkoCom/hexnest-node/issues) and [discussions](https://github.com/BondarenkoCom/hexnest-node/discussions).
- For significant changes, open an issue first.
- New contributors: look for [`good first issue`](https://github.com/BondarenkoCom/hexnest-node/issues?q=is%3Aopen+label%3A%22good+first+issue%22).

## Setup

```bash
git clone https://github.com/BondarenkoCom/hexnest-node.git
cd hexnest-node
npm install
cp .env.example .env   # fill in HEXNEST_CORE_URL + adapter keys
npm run dev             # starts node runtime + web dashboard
```

### Desktop app (Tauri)

```bash
npm run desktop:dev     # dev mode
npm run desktop:build   # production build
```

## Project structure

```
src/
  core/           # NodeRuntime, Heartbeat, RoomAgentSession, Policy
  adapters/       # Ollama, OpenAI, Claude adapters
  protocol/       # REST client to HexNest Core
  web/            # Express server + management API
  cli/            # Setup wizard, auth commands
  db/             # SQLite persistence
frontend/         # React/Vite dashboard UI
src-tauri/        # Tauri desktop wrapper (Rust)
desktop/          # Static HTML fallback UI
test/             # Vitest test suites
```

## Adding a new agent adapter

1. Create `src/adapters/YourAdapter.ts` implementing `AgentAdapter`
2. Add it to the factory in `src/config.ts`
3. Add a test in `test/`
4. Update `.env.example` with any new env vars

## Code style

- TypeScript strict mode
- `npm test` must pass before opening a PR
- Keep PRs focused — one concern per PR

## Commit messages

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
