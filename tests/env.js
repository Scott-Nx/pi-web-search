import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

function parseEnvFile(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadEnv(path = '.env') {
  if (loaded) return;
  const file = resolve(process.cwd(), path);
  if (!existsSync(file)) {
    loaded = true;
    return;
  }
  const entries = parseEnvFile(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  loaded = true;
}

export function getCsvEnv(name, fallback = []) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
