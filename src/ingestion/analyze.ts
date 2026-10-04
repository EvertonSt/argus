/**
 * Ingestion — pure analysis half.
 *
 * Everything here is deterministic and I/O-free: it takes an already-captured
 * DOM description (or markdown text) and turns it into features. That split is
 * what lets the whole module be unit-tested against a saved fixture without a
 * browser.
 */
import type { Feature, FeatureInventory } from '../shared/types.js';
import { slugify } from '../shared/storage.js';

/** A single interactive element observed on a page. */
export interface ObservedElement {
  kind: 'form' | 'button' | 'link' | 'input' | 'list' | 'checkbox';
  /** Visible text or accessible label. */
  label: string;
  /** Best available stable selector. */
  selector: string;
  /** For forms: the action attribute. For links: the href. */
  target?: string;
}

/** What the crawler captures from one page. */
export interface PageObservation {
  url: string;
  route: string;
  title: string;
  elements: ObservedElement[];
}

// ---------------------------------------------------------------------------
// Crawl → features
// ---------------------------------------------------------------------------

const NOISE_LABELS = new Set(['', 'submit', 'button', 'click here', 'link']);

function describeElement(el: ObservedElement): string {
  switch (el.kind) {
    case 'form':
      return `a form${el.target ? ` posting to ${el.target}` : ''}`;
    case 'button':
      return `a button labelled "${el.label}"`;
    case 'link':
      return `a link "${el.label}"${el.target ? ` to ${el.target}` : ''}`;
    case 'input':
      return `a text input "${el.label}"`;
    case 'checkbox':
      return `a checkbox "${el.label}"`;
    case 'list':
      return `a list of items ("${el.label}")`;
  }
}

/**
 * Group one page's observed elements into features.
 *
 * v1 heuristic, deliberately simple: a page becomes one "page feature"
 * summarising its content, plus one feature per distinct interactive
 * affordance worth testing (forms, buttons, checkboxes, lists). This is only
 * ever input to the planner LLM, so best-effort is genuinely sufficient.
 */
export function featuresFromPage(page: PageObservation): Feature[] {
  const features: Feature[] = [];
  const seen = new Set<string>();

  const push = (feature: Feature): void => {
    if (seen.has(feature.id)) return;
    seen.add(feature.id);
    features.push(feature);
  };

  const routeSlug = slugify(page.route === '/' ? 'home' : page.route);

  // One feature describing the page as a whole.
  const inventoryLine = page.elements.length
    ? page.elements.map(describeElement).join(', ')
    : 'no interactive elements detected';
  push({
    id: `${routeSlug}-page`,
    name: page.title || `Page ${page.route}`,
    description: `The ${page.route} screen. It contains ${inventoryLine}.`,
    routes: [page.route],
    keySelectors: page.elements.map((el) => el.selector),
  });

  // One feature per meaningful affordance.
  for (const el of page.elements) {
    const label = el.label.trim();
    if (NOISE_LABELS.has(label.toLowerCase())) continue;
    if (el.kind === 'link') continue; // navigation is covered by the page feature

    const id = `${routeSlug}-${slugify(`${el.kind}-${label}`)}`;
    push({
      id,
      name: label,
      description:
        el.kind === 'form'
          ? `Submitting the "${label}" form on ${page.route}.`
          : el.kind === 'checkbox'
            ? `Toggling "${label}" on ${page.route}.`
            : el.kind === 'list'
              ? `The "${label}" list rendered on ${page.route}.`
              : `Activating "${label}" on ${page.route}.`,
      routes: [page.route],
      keySelectors: [el.selector],
    });
  }

  return features;
}

export function inventoryFromPages(pages: PageObservation[]): FeatureInventory {
  const features: Feature[] = [];
  const byId = new Map<string, Feature>();

  for (const page of pages) {
    for (const feature of featuresFromPage(page)) {
      const existing = byId.get(feature.id);
      if (existing) {
        // Same affordance seen on another route — merge routes/selectors.
        existing.routes = [...new Set([...existing.routes, ...feature.routes])];
        existing.keySelectors = [
          ...new Set([...(existing.keySelectors ?? []), ...(feature.keySelectors ?? [])]),
        ];
        continue;
      }
      byId.set(feature.id, feature);
      features.push(feature);
    }
  }

  return { source: 'crawl', features };
}

// ---------------------------------------------------------------------------
// Markdown specs → features
// ---------------------------------------------------------------------------

export interface SpecFile {
  /** File name, used for id fallback and route inference. */
  name: string;
  contents: string;
}

/**
 * Parse a markdown spec into one feature per top-level (`#`) heading.
 *
 * A `Route:` or `Routes:` line anywhere in a section is picked up as the
 * feature's route; otherwise the route defaults to `/`.
 */
export function featuresFromSpec(file: SpecFile): Feature[] {
  const lines = file.contents.split(/\r?\n/);
  const features: Feature[] = [];

  let current: { name: string; body: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    const routes = extractRoutes(body);
    features.push({
      id: slugify(current.name),
      name: current.name,
      description: body || `Feature described in ${file.name}.`,
      routes: routes.length ? routes : ['/'],
    });
    current = null;
  };

  for (const line of lines) {
    const heading = /^#\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      flush();
      current = { name: heading[1] as string, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();

  return features;
}

function extractRoutes(body: string): string[] {
  const match = /^\s*routes?:\s*(.+)$/im.exec(body);
  if (!match) return [];
  return (match[1] as string)
    .split(',')
    .map((r) => r.trim().replace(/^`|`$/g, ''))
    .filter(Boolean);
}

export function inventoryFromSpecs(files: SpecFile[]): FeatureInventory {
  const features = files.flatMap(featuresFromSpec);
  return { source: 'specs', features };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export function mergeInventories(
  crawl: FeatureInventory | null,
  specs: FeatureInventory | null,
): FeatureInventory {
  if (crawl && !specs) return crawl;
  if (specs && !crawl) return specs;
  if (!crawl || !specs) return { source: 'crawl', features: [] };

  const features: Feature[] = [...specs.features];
  const byId = new Map(features.map((f) => [f.id, f]));
  // Spec headings ("Add a task") and crawled affordances ("Add task" on /)
  // describe the same behaviour but slugify differently, so id equality alone
  // never merges them. Match on the normalised name as well.
  const byName = new Map(features.map((f) => [normalizeName(f.name), f]));

  for (const feature of crawl.features) {
    const existing = byId.get(feature.id) ?? byName.get(normalizeName(feature.name));
    if (existing) {
      existing.routes = [...new Set([...existing.routes, ...feature.routes])];
      existing.keySelectors = [
        ...new Set([...(existing.keySelectors ?? []), ...(feature.keySelectors ?? [])]),
      ];
      continue;
    }
    byId.set(feature.id, feature);
    byName.set(normalizeName(feature.name), feature);
    features.push(feature);
  }

  return { source: 'both', features };
}

/**
 * Normalise a feature name for cross-source matching: lowercase, strip
 * articles and punctuation. "Add a task" and "Add task" both become "add task".
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['a', 'an', 'the'].includes(word))
    .join(' ');
}
