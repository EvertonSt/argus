/**
 * Ingestion — I/O half.
 *
 * Drives Playwright to observe a page, and reads markdown specs off disk.
 * All the interpretation lives in analyze.ts; this file only gathers raw
 * observations so the analysis stays unit-testable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import type { FeatureInventory } from '../shared/types.js';
import { ArgusError } from '../shared/ai-client.js';
import { log } from '../shared/logger.js';
import { COLLECT_ELEMENTS_SCRIPT } from './browser-script.js';
import {
  inventoryFromPages,
  inventoryFromSpecs,
  mergeInventories,
  type ObservedElement,
  type PageObservation,
  type SpecFile,
} from './analyze.js';

/**
 * Visit the given routes and observe each one.
 *
 * v1 scope: the entry page plus same-origin nav links found on it, capped at
 * `maxPages`. No autonomous multi-page crawling — that is a documented stretch
 * goal, and unbounded crawling is not needed to cover the demo app.
 */
export async function crawl(baseUrl: string, maxPages = 5): Promise<PageObservation[]> {
  const browser = await chromium.launch();
  const observations: PageObservation[] = [];

  try {
    const page = await browser.newPage();
    const origin = new URL(baseUrl).origin;

    const visit = async (url: string): Promise<PageObservation> => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      const elements = (await page.evaluate(COLLECT_ELEMENTS_SCRIPT)) as ObservedElement[];
      return {
        url,
        route: new URL(url).pathname,
        title: (await page.title()).split('·')[0]?.trim() ?? '',
        elements,
      };
    };

    const entry = await visit(baseUrl);
    observations.push(entry);

    const queue = entry.elements
      .filter((el) => el.kind === 'link' && el.target)
      .map((el) => new URL(el.target as string, baseUrl).toString())
      .filter((url) => url.startsWith(origin));

    const visited = new Set([new URL(baseUrl).pathname]);
    for (const url of queue) {
      if (observations.length >= maxPages) break;
      const route = new URL(url).pathname;
      if (visited.has(route)) continue;
      visited.add(route);
      try {
        observations.push(await visit(url));
      } catch {
        log.warn(`Could not load ${route} — skipping.`);
      }
    }
  } finally {
    await browser.close();
  }

  return observations;
}

export function readSpecFiles(dir: string): SpecFile[] {
  if (!fs.existsSync(dir)) {
    throw new ArgusError(
      `Specs path not found: ${dir}`,
      'Pass --specs with a folder of markdown files describing your features.',
    );
  }
  const stat = fs.statSync(dir);
  const files = stat.isFile()
    ? [dir]
    : fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.join(dir, f));

  if (files.length === 0) {
    throw new ArgusError(`No markdown files found in ${dir}.`);
  }

  return files.map((file) => ({
    name: path.basename(file),
    contents: fs.readFileSync(file, 'utf-8'),
  }));
}

export interface IngestOptions {
  url?: string | undefined;
  specsPath?: string | undefined;
  maxPages?: number;
}

export async function ingest(options: IngestOptions): Promise<FeatureInventory> {
  const { url, specsPath } = options;
  if (!url && !specsPath) {
    throw new ArgusError('Nothing to ingest: pass --target <url> or --specs <path> (or both).');
  }

  let crawlInventory: FeatureInventory | null = null;
  let specsInventory: FeatureInventory | null = null;

  if (url) {
    log.item(`Crawling ${url}`);
    const pages = await crawl(url, options.maxPages ?? 5);
    for (const page of pages) {
      log.detail(`${page.route} — ${page.elements.length} interactive elements`);
    }
    crawlInventory = inventoryFromPages(pages);
  }

  if (specsPath) {
    log.item(`Reading specs from ${specsPath}`);
    const files = readSpecFiles(specsPath);
    for (const file of files) log.detail(file.name);
    specsInventory = inventoryFromSpecs(files);
  }

  return mergeInventories(crawlInventory, specsInventory);
}

export * from './analyze.js';
export { COLLECT_ELEMENTS_SCRIPT, DOM_SNAPSHOT_SCRIPT } from './browser-script.js';
