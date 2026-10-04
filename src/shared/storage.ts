/**
 * Storage: plain, human-readable JSON files under data/.
 *
 * No database by design — this is a portfolio project and inspectability
 * matters more than scale. Every write is pretty-printed so a reviewer can
 * open any artifact in a text editor and understand it.
 */
import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export function appendJsonArray<T>(file: string, items: T[]): T[] {
  const existing = readJson<T[]>(file, []);
  const merged = [...existing, ...items];
  writeJson(file, merged);
  return merged;
}

/** Sortable, human-readable run id: run-20260805-142233-a1b2. */
export function newRunId(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `run-${stamp}-${suffix}`;
}

/** Stable slug for feature / test-case ids. */
export function slugify(input: string, maxLength = 40): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'item').slice(0, maxLength).replace(/-+$/g, '');
}

/**
 * Load and merge all dashboard data from the data/ directory into a single
 * object, for static export or in-memory dashboard queries.
 */
export function loadDashboardJson(dataDir: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const files = ['run-index.json', 'bugs.json', 'inventory.json', 'test-cases.json'];
  for (const file of files) {
    result[file] = readJson(path.join(dataDir, file), []);
  }
  return result;
}
