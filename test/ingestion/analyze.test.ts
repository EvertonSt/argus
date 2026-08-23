import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  featuresFromPage,
  featuresFromSpec,
  inventoryFromPages,
  inventoryFromSpecs,
  mergeInventories,
  type PageObservation,
} from '../../src/ingestion/analyze.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Real capture from the bundled demo app, recorded by the crawler. */
function loadCrawlFixture(): PageObservation[] {
  const file = path.join(ROOT, 'fixtures', 'crawl-observation.json');
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as PageObservation[];
}

describe('featuresFromPage', () => {
  const page: PageObservation = {
    url: 'http://localhost:4317/',
    route: '/',
    title: 'Tasks',
    elements: [
      { kind: 'form', label: 'Add task', selector: 'form', target: '/tasks/add' },
      { kind: 'button', label: 'Add task', selector: '[data-testid="add-task"]' },
      { kind: 'checkbox', label: 'Mark complete', selector: '[data-testid="toggle-complete"]' },
      { kind: 'link', label: 'Stats', selector: '[data-testid="nav-stats"]', target: '/stats' },
      { kind: 'button', label: 'submit', selector: 'button' },
    ],
  };

  it('always emits a page-level feature summarising the screen', () => {
    const features = featuresFromPage(page);
    const pageFeature = features.find((f) => f.id === 'home-page');
    expect(pageFeature).toBeDefined();
    expect(pageFeature?.routes).toEqual(['/']);
    expect(pageFeature?.description).toContain('a button labelled "Add task"');
    expect(pageFeature?.description).toContain('a form posting to /tasks/add');
  });

  it('emits one feature per meaningful affordance', () => {
    const ids = featuresFromPage(page).map((f) => f.id);
    expect(ids).toContain('home-form-add-task');
    expect(ids).toContain('home-checkbox-mark-complete');
  });

  it('skips navigation links, which the page feature already covers', () => {
    const ids = featuresFromPage(page).map((f) => f.id);
    expect(ids.some((id) => id.includes('link-stats'))).toBe(false);
  });

  it('filters out noise labels like a bare "submit" button', () => {
    const ids = featuresFromPage(page).map((f) => f.id);
    expect(ids).not.toContain('home-button-submit');
  });

  it('does not emit duplicate ids for repeated affordances', () => {
    const ids = featuresFromPage(page).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('handles a page with no interactive elements', () => {
    const empty = featuresFromPage({ url: 'u', route: '/about', title: 'About', elements: [] });
    expect(empty).toHaveLength(1);
    expect(empty[0]?.description).toContain('no interactive elements detected');
  });
});

describe('inventoryFromPages (against the recorded demo-app crawl)', () => {
  it('produces a crawl-sourced inventory covering every visited route', () => {
    const inventory = inventoryFromPages(loadCrawlFixture());
    expect(inventory.source).toBe('crawl');
    const routes = new Set(inventory.features.flatMap((f) => f.routes));
    expect(routes).toEqual(new Set(['/', '/stats', '/about']));
  });

  it('captures the three behaviours the demo app seeds bugs into', () => {
    const ids = inventoryFromPages(loadCrawlFixture()).features.map((f) => f.id);
    expect(ids).toContain('home-form-add-task');
    expect(ids).toContain('home-button-delete');
    expect(ids).toContain('home-checkbox-mark-complete');
  });

  it('keeps ids unique across pages', () => {
    const ids = inventoryFromPages(loadCrawlFixture()).features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('merges routes when the same affordance appears on several pages', () => {
    const shared: PageObservation[] = [
      {
        url: 'http://x/',
        route: '/',
        title: 'A',
        elements: [{ kind: 'button', label: 'Save', selector: '#save' }],
      },
      {
        url: 'http://x/',
        route: '/',
        title: 'A',
        elements: [{ kind: 'button', label: 'Save', selector: '#save-2' }],
      },
    ];
    const feature = inventoryFromPages(shared).features.find((f) => f.id === 'home-button-save');
    expect(feature?.keySelectors).toEqual(['#save', '#save-2']);
  });
});

describe('featuresFromSpec', () => {
  const spec = {
    name: 'tasks.md',
    contents: [
      '# Add a task',
      '',
      'Route: /',
      '',
      'A user types text and submits the form.',
      '',
      '# Delete a task',
      '',
      'Routes: /, /archive',
      '',
      'A user removes a task they no longer need.',
    ].join('\n'),
  };

  it('creates one feature per top-level heading', () => {
    const features = featuresFromSpec(spec);
    expect(features.map((f) => f.name)).toEqual(['Add a task', 'Delete a task']);
  });

  it('slugifies heading text into stable ids', () => {
    expect(featuresFromSpec(spec).map((f) => f.id)).toEqual(['add-a-task', 'delete-a-task']);
  });

  it('extracts a single route', () => {
    expect(featuresFromSpec(spec)[0]?.routes).toEqual(['/']);
  });

  it('extracts a comma-separated route list', () => {
    expect(featuresFromSpec(spec)[1]?.routes).toEqual(['/', '/archive']);
  });

  it('defaults to "/" when no route is declared', () => {
    const features = featuresFromSpec({ name: 'x.md', contents: '# Lonely\n\nNo route here.' });
    expect(features[0]?.routes).toEqual(['/']);
  });

  it('ignores sub-headings, treating them as body text', () => {
    const features = featuresFromSpec({
      name: 'x.md',
      contents: '# Top\n\n## Nested\n\nDetail.',
    });
    expect(features).toHaveLength(1);
    expect(features[0]?.description).toContain('## Nested');
  });

  it('returns nothing for a file with no top-level heading', () => {
    expect(featuresFromSpec({ name: 'x.md', contents: 'just prose' })).toEqual([]);
  });
});

describe('mergeInventories', () => {
  const crawl = inventoryFromPages([
    {
      url: 'http://x/',
      route: '/',
      title: 'T',
      elements: [{ kind: 'button', label: 'Add task', selector: '#add' }],
    },
  ]);
  const specs = inventoryFromSpecs([
    { name: 's.md', contents: '# Add task\n\nRoute: /\n\nAdds a task.' },
  ]);

  it('returns the crawl inventory unchanged when there are no specs', () => {
    expect(mergeInventories(crawl, null)).toBe(crawl);
  });

  it('returns the specs inventory unchanged when there is no crawl', () => {
    expect(mergeInventories(null, specs)).toBe(specs);
  });

  it('marks a combined inventory as source "both"', () => {
    expect(mergeInventories(crawl, specs).source).toBe('both');
  });

  it('enriches a spec feature with selectors discovered by the crawl', () => {
    const merged = mergeInventories(crawl, specs);
    const feature = merged.features.find((f) => f.id === 'add-task');
    expect(feature?.keySelectors).toContain('#add');
  });

  it('keeps crawl-only features that no spec described', () => {
    const ids = mergeInventories(crawl, specs).features.map((f) => f.id);
    expect(ids).toContain('home-page');
  });
});
