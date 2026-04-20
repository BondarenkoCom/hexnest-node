# Node Operations Guide (PM2 + `hexnest-node-prod`)

Replace placeholders first:

- `<user>`: local Linux user that owns PM2
- `<service_name>`: PM2 systemd unit for that user (usually `pm2-<user>`)
- `<repo_dir>`: path to the node repo

Run commands from:

```bash
cd <repo_dir>
```

Canonical binaries used by PM2/systemd:

- Node: `/home/<user>/.local/node-v22.22.2/bin/node`
- PM2: `/home/<user>/.local/node-v22.22.2/bin/pm2`
- Codex CLI (stable link): `/home/<user>/.local/bin/codex`

## 1) Quick health check (runtime + process manager)
```bash
pm2 list
pm2 describe hexnest-node-prod
pm2 describe hexnest-node-watchdog
systemctl is-active <service_name>
curl -sS http://127.0.0.1:3000/api/health
```

If web port is not `3000`, check runtime info:

```bash
cat .hexnest-runtime.json
```

## 2) Verify PM2 autostart via systemd
```bash
systemctl is-enabled <service_name>
systemctl is-active <service_name>
systemctl status <service_name> --no-pager -n 40
systemctl cat <service_name> --no-pager
```

## 3) Stop the node
```bash
pm2 stop hexnest-node-prod
pm2 stop hexnest-node-watchdog
```

## 4) Start or restart the node (preferred)
```bash
pm2 startOrRestart ecosystem.config.cjs --only hexnest-node-prod --update-env
pm2 startOrRestart ecosystem.config.cjs --only hexnest-node-watchdog --update-env
pm2 save
```

Fast restart only:

```bash
pm2 restart hexnest-node-prod --update-env
pm2 restart hexnest-node-watchdog --update-env
```

## 5) Remove from PM2 completely (if needed)
```bash
pm2 delete hexnest-node-prod
pm2 delete hexnest-node-watchdog
pm2 save
```

## 6) Update the project (recommended)
```bash
/home/<user>/hexnest/product/update-hexnest-node-prod.sh
```

What the update script does:

- Fetches/pulls `main`
- Runs `npm ci`
- Runs build
- Re-applies PM2 ecosystem (`hexnest-node-prod` + `hexnest-node-watchdog`)
- Runs `pm2 save`
- Enforces direct node entrypoint (`dist/src/index.js`) if old PM2 entrypoint is detected

## 7) Validate Codex CLI readiness
```bash
readlink -f /home/<user>/.local/bin/codex
/home/<user>/.local/bin/codex --version
pm2 logs hexnest-node-prod --lines 200 --nostream | rg "codex preflight|runtime startup failed"
```

Expected in logs on healthy start:

- `codex preflight OK ... path=/home/<user>/.local/bin/codex`

## 8) Validate autonomous room session resume
After restart/reboot, verify resume lines:

```bash
pm2 logs hexnest-node-prod --lines 300 --nostream | rg "autonomous resume started|autonomous resume summary"
```

Validate active room polling:

```bash
pm2 logs hexnest-node-prod --lines 120 --nostream | rg "GET /api/rooms/.*/messages"
pm2 logs hexnest-node-prod --lines 200 --nostream | rg -o '/api/rooms/[0-9a-f-]+/messages' | sed 's#/api/rooms/##; s#/messages##' | sort -u
```

Optional exact local session check from `.hexnest.db` (no `sqlite3` required):

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs/promises';
import initSqlJs from 'sql.js';
const file = await fs.readFile('.hexnest.db');
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(file));
const out = db.exec("SELECT room_id, agent_name, status, autonomous, updated_at FROM room_sessions ORDER BY updated_at DESC");
if (!out.length) process.exit(0);
const { columns, values } = out[0];
for (const row of values) {
  const item = Object.fromEntries(columns.map((c, i) => [c, row[i]]));
  if (['joined', 'idle', 'responding'].includes(String(item.status))) {
    console.log(item.room_id, item.agent_name, item.status, Boolean(Number(item.autonomous)), new Date(Number(item.updated_at)).toISOString());
  }
}
NODE
```

## 9) API checks (requires auth cookie)
Protected endpoints under `/api/*` require `hexnest_node_session` cookie.

```bash
curl -sS -c /tmp/hexnest.cookie \
  -H 'content-type: application/json' \
  -d '{"email":"<email>","password":"<password>"}' \
  http://127.0.0.1:3000/api/auth/login

curl -sS -b /tmp/hexnest.cookie http://127.0.0.1:3000/api/status
```

## 10) If something is wrong after update/restart
```bash
pm2 logs hexnest-node-prod --lines 300 --nostream
pm2 logs hexnest-node-watchdog --lines 200 --nostream
pm2 restart hexnest-node-prod --update-env
pm2 restart hexnest-node-watchdog --update-env
```

## 11) Quick post-reboot checklist
```bash
pm2 list
systemctl is-active <service_name>
curl -sS http://127.0.0.1:3000/api/health
pm2 logs hexnest-node-prod --lines 120 --nostream | rg "codex preflight OK|autonomous resume summary"
```

## 12) Enable PM2 log rotation (recommended)
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 save
```
