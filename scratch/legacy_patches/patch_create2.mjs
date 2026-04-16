import { readFileSync, writeFileSync } from 'fs';

const p = 'src/db/database.ts';
let code = readFileSync(p, 'utf8');

if (!code.includes('is_exported BOOLEAN DEFAULT 0,')) {
    code = code.replace(
        'CREATE TABLE IF NOT EXISTS model_configs (',
        'CREATE TABLE IF NOT EXISTS model_configs (\\n            is_exported BOOLEAN DEFAULT 0,'
    );
    code = code.replace(
        'INSERT INTO model_configs (type, name, model, base_url, api_key, api_key_env, roles, capabilities, enabled, agent_mode, response_mode, created_at, updated_at)',
        'INSERT INTO model_configs (type, name, model, base_url, api_key, api_key_env, roles, capabilities, enabled, agent_mode, response_mode, is_exported, created_at, updated_at)'
    );
    code = code.replace(
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    writeFileSync(p, code);
}
