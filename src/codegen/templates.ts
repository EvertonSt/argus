/**
 * Codegen — the deterministic template library.
 *
 * Architectural note worth defending in an interview: Argus does NOT ask an
 * LLM to write Playwright code by default. Pure LLM codegen is flaky, produces
 * a different file every run, and is miserable to debug when it breaks. Here a
 * fixed set of Gherkin verb patterns compiles to Playwright calls
 * deterministically; the LLM is only consulted for clauses no pattern matches
 * (see ./index.ts). That keeps generated suites stable run-to-run and keeps
 * the AI spend near zero.
 *
 * Everything in this file is pure — no I/O, no model calls.
 */
import type { GeneratedStep } from '../shared/types.js';

/**
 * Matches a quoted string, tolerating backslash escapes inside it.
 *
 * This matters in practice: a model asked for a CSS selector routinely returns
 * `"[data-testid=\"add-task\"]"`, and a naive `"([^"]+)"` stops at the first
 * inner quote and silently mangles the selector. Group 1 is the raw body.
 */
const QUOTED = '["\'`]((?:[^"\'`\\\\]|\\\\.)*)["\'`]';

/** Undo backslash escapes inside a captured quoted value. */
export function unescapeCapture(value: string): string {
  return value.replace(/\\(["'`\\])/g, '$1');
}

/** Escape a value for embedding in a single-quoted TS string literal. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** Capture group N, unescaped and quoted as a TS literal. */
function lit(match: RegExpMatchArray, index: number): string {
  return quote(unescapeCapture(match[index] as string));
}

/** Build a `.first()` / `.last()` / `.nth(1)` locator from an ordinal word. */
function ordinalLocator(word: string, selectorLiteral: string): string {
  switch (word.toLowerCase()) {
    case 'last':
      return `page.locator(${selectorLiteral}).last()`;
    case 'second':
      return `page.locator(${selectorLiteral}).nth(1)`;
    default:
      return `page.locator(${selectorLiteral}).first()`;
  }
}

export interface TemplateRule {
  name: string;
  pattern: RegExp;
  build: (match: RegExpMatchArray) => string;
}

const rule = (name: string, source: string, build: TemplateRule['build']): TemplateRule => ({
  name,
  pattern: new RegExp(source, 'i'),
  build,
});

/**
 * Ordered: the first rule that matches wins, so more specific patterns are
 * listed before more general ones.
 */
export const TEMPLATE_RULES: TemplateRule[] = [
  // --- navigation ---------------------------------------------------------
  rule('reload', String.raw`\breload(?:ing)?\s+the\s+page\b`, () => `await page.reload();`),
  rule(
    'navigate-to-route',
    String.raw`\b(?:navigate|go)\s+to\s+["'\`]?(\/[^\s"'\`]*)["'\`]?`,
    (m) => `await page.goto(${quote(m[1] as string)});`,
  ),
  rule(
    'on-page-noop',
    String.raw`^\s*(?:i\s+am\s+on|the\s+user\s+is\s+on|given\s+i\s+am\s+on)\b`,
    () => `// starting state — the test already navigated to the target route`,
  ),
  rule(
    'page-loaded-noop',
    String.raw`^\s*the\s+page\s+(?:has\s+)?load(?:ed|s)\b`,
    () => `await page.waitForLoadState('domcontentloaded');`,
  ),

  // --- input --------------------------------------------------------------
  rule(
    'fill-selector-with-value',
    String.raw`\bfill\s+in\s+` + QUOTED + String.raw`\s+with\s+` + QUOTED,
    (m) => `await page.locator(${lit(m, 1)}).fill(${lit(m, 2)});`,
  ),
  rule(
    'fill-labelled-field',
    String.raw`\b(?:fill\s+in|type|enter)\s+` +
      QUOTED +
      String.raw`\s+(?:in|into)\s+(?:the\s+)?` +
      QUOTED,
    (m) => `await page.getByPlaceholder(${lit(m, 2)}).fill(${lit(m, 1)});`,
  ),

  // --- clicking -----------------------------------------------------------
  rule(
    'click-nth-selector',
    String.raw`\bclick\s+(?:on\s+)?the\s+(first|last|second)\s+(?:element\s+)?(?:matching\s+)?` + QUOTED,
    (m) => `await ${ordinalLocator(m[1] as string, lit(m, 2))}.click();`,
  ),
  rule(
    'click-button-labelled',
    String.raw`\bclick\s+(?:on\s+)?the\s+button\s+(?:labell?ed\s+)?` + QUOTED,
    (m) => `await page.getByRole('button', { name: ${lit(m, 1)} }).first().click();`,
  ),
  rule(
    'click-link-labelled',
    String.raw`\bclick\s+(?:on\s+)?the\s+link\s+(?:labell?ed\s+)?` + QUOTED,
    (m) => `await page.getByRole('link', { name: ${lit(m, 1)} }).first().click();`,
  ),
  rule(
    'click-selector',
    String.raw`\bclick\s+(?:on\s+)?["'\`]((?:\[|#)(?:[^"'\`\\]|\\.)*)["'\`]`,
    (m) => `await page.locator(${lit(m, 1)}).first().click();`,
  ),
  rule('click-text', String.raw`\bclick\s+(?:on\s+)?` + QUOTED, (m) =>
    `await page.getByText(${lit(m, 1)}).first().click();`),

  // --- checkboxes ---------------------------------------------------------
  rule(
    'check-nth-selector',
    String.raw`\b(?:check|tick|toggle)\s+the\s+(first|last|second)\s+(?:element\s+)?(?:matching\s+)?` +
      QUOTED,
    (m) => `await ${ordinalLocator(m[1] as string, lit(m, 2))}.check();`,
  ),
  rule('check-selector', String.raw`\b(?:check|tick|toggle)\s+` + QUOTED, (m) =>
    `await page.locator(${lit(m, 1)}).first().check();`),

  // --- assertions ---------------------------------------------------------
  rule(
    'assert-count',
    QUOTED + String.raw`\s+should\s+have\s+(?:a\s+)?count\s+(?:of\s+)?(\d+)`,
    (m) => `await expect(page.locator(${lit(m, 1)})).toHaveCount(${m[2]});`,
  ),
  rule('assert-text', QUOTED + String.raw`\s+should\s+have\s+text\s+` + QUOTED, (m) =>
    `await expect(page.locator(${lit(m, 1)})).toHaveText(${lit(m, 2)});`),
  rule(
    'assert-nth-checked',
    String.raw`\bthe\s+(first|last|second)\s+(?:element\s+)?(?:matching\s+)?` +
      QUOTED +
      String.raw`\s+should\s+be\s+checked`,
    (m) => `await expect(${ordinalLocator(m[1] as string, lit(m, 2))}).toBeChecked();`,
  ),
  rule(
    'assert-nth-not-checked',
    String.raw`\bthe\s+(first|last|second)\s+(?:element\s+)?(?:matching\s+)?` +
      QUOTED +
      String.raw`\s+should\s+not\s+be\s+checked`,
    (m) => `await expect(${ordinalLocator(m[1] as string, lit(m, 2))}).not.toBeChecked();`,
  ),
  rule('assert-not-checked', QUOTED + String.raw`\s+should\s+not\s+be\s+checked`, (m) =>
    `await expect(page.locator(${lit(m, 1)}).first()).not.toBeChecked();`),
  rule('assert-checked', QUOTED + String.raw`\s+should\s+be\s+checked`, (m) =>
    `await expect(page.locator(${lit(m, 1)}).first()).toBeChecked();`),
  rule(
    'assert-not-visible',
    QUOTED + String.raw`\s+should\s+(?:not\s+be\s+visible|be\s+hidden)`,
    (m) => `await expect(page.locator(${lit(m, 1)}).first()).toBeHidden();`,
  ),
  rule(
    'assert-visible',
    String.raw`["'\`]((?:\[|#)(?:[^"'\`\\]|\\.)*)["'\`]\s+should\s+be\s+visible`,
    (m) => `await expect(page.locator(${lit(m, 1)}).first()).toBeVisible();`,
  ),
  rule('assert-should-not-see', String.raw`\bshould\s+not\s+see\s+` + QUOTED, (m) =>
    `await expect(page.getByText(${lit(m, 1)})).toHaveCount(0);`),
  rule('assert-should-see', String.raw`\bshould\s+see\s+` + QUOTED, (m) =>
    `await expect(page.getByText(${lit(m, 1)}).first()).toBeVisible();`),
];

/**
 * Split a Gherkin clause into sub-steps on " and ", so a compound clause like
 * "I fill in X and click Y" produces two statements. Quoted regions are
 * protected, since a literal " and " can legitimately appear inside a value.
 */
export function splitClause(clause: string): string[] {
  const parts: string[] = [];
  let buffer = '';
  let quoteChar: string | null = null;

  for (let i = 0; i < clause.length; i += 1) {
    const char = clause[i] as string;

    if (quoteChar) {
      buffer += char;
      if (char === quoteChar && clause[i - 1] !== '\\') quoteChar = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quoteChar = char;
      buffer += char;
      continue;
    }

    if (clause.slice(i).toLowerCase().startsWith(' and ')) {
      parts.push(buffer.trim());
      buffer = '';
      i += 4;
      continue;
    }
    buffer += char;
  }

  if (buffer.trim()) parts.push(buffer.trim());
  return parts.filter(Boolean);
}

/** Try to compile one clause deterministically. Returns null if no rule fits. */
export function matchTemplate(clause: string): GeneratedStep | null {
  for (const templateRule of TEMPLATE_RULES) {
    const match = clause.match(templateRule.pattern);
    if (match) {
      return {
        source: clause,
        code: templateRule.build(match),
        origin: 'template',
        rule: templateRule.name,
      };
    }
  }
  return null;
}

export interface CompileResult {
  steps: GeneratedStep[];
  /** Clauses that no template matched — candidates for the LLM fallback. */
  unmatched: string[];
}

/** Compile a full Gherkin clause (possibly compound) via templates only. */
export function compileClause(clause: string): CompileResult {
  const steps: GeneratedStep[] = [];
  const unmatched: string[] = [];

  for (const part of splitClause(clause)) {
    const step = matchTemplate(part);
    if (step) steps.push(step);
    else unmatched.push(part);
  }

  return { steps, unmatched };
}
