import fs from 'fs';

const path = 'src/db/database.ts';
let code = fs.readFileSync(path, 'utf-8');

// Fix 1
code = code.replace(
  'const [id, type, name, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, createdAt, updatedAt] = row;',
  'const [id, type, name, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, isExported, createdAt, updatedAt] = row;'
);

// Fix 2
code = code.replace(
  'const [id, type, modelName, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, createdAt, updatedAt] =',
  'const [id, type, modelName, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, isExported, createdAt, updatedAt] ='
);

// Fix 3 (getActiveModel query)
code = code.replace(
  'SELECT id, type, name, model, base_url, api_key, api_key_env, roles, capabilities, enabled, agent_mode, response_mode, active, created_at, updated_at',
  'SELECT id, type, name, model, base_url, api_key, api_key_env, roles, capabilities, enabled, agent_mode, response_mode, active, is_exported, created_at, updated_at'
);
code = code.replace(
  'const [id, modelType, name, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, createdAt, updatedAt] = results[0].values[0];',
  'const [id, modelType, name, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, isExported, createdAt, updatedAt] = results[0].values[0];'
);

// Add isExported to the getActiveModel return parsing
code = code.replace(
  /active: Boolean\(active\),(\n\s*)createdAt: Number\(createdAt\),/,
  `active: Boolean(active),$1isExported: Boolean(isExported),$1createdAt: Number(createdAt),`
);

fs.writeFileSync(path, code);
