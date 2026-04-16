import { readFileSync, writeFileSync } from 'fs';
const dbPath = 'src/db/database.ts';
let content = readFileSync(dbPath, 'utf8');
content = content.replace(
  'CREATE TABLE IF NOT EXISTS model_configs (',
  'CREATE TABLE IF NOT EXISTS model_configs (\n              is_exported BOOLEAN DEFAULT 0,'
);
writeFileSync(dbPath, content, 'utf8');
console.log('Patched CREATE TABLE model_configs');
