import fs from 'fs';

const path = 'src/db/database.ts';
let code = fs.readFileSync(path, 'utf-8');

// 1. Fix getModelConfigs row parsing
code = code.replace(
  'const [id, type, name, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, createdAt, updatedAt] = row;\n          return {',
  'const [id, type, name, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, isExported, createdAt, updatedAt] = row;\n          return {'
);

// 2. Fix getModelConfig row parsing
code = code.replace(
  'const [id, type, modelName, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, createdAt, updatedAt] =\n          results[0].values[0];\n        return {',
  'const [id, type, modelName, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, responseMode, active, isExported, createdAt, updatedAt] =\n          results[0].values[0];\n        return {'
);

// Write to file
fs.writeFileSync(path, code);
console.log('patched');
