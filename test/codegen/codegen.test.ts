import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  compileClause,
  matchTemplate,
  quote,
  splitClause,
  unescapeCapture,
} from '../../src/codegen/templates.js';
import { codegenStats, generateTests, sanitizeLlmSnippet } from '../../src/codegen/index.js';
import type { AiClient } from '../../src/shared/ai-client.js';
import type { TestCase } from '../../src/shared/types.js';

const code = (clause: string): string | undefined => matchTemplate(clause)?.code;
const ruleOf = (clause: string): string | undefined => matchTemplate(clause)?.rule;

describe('quote / unescapeCapture', () => {
  it('wraps a plain value in single quotes', () => {
    expect(quote('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(quote("it's")).toBe("'it\\'s'");
  });

  it('escapes backslashes', () => {
    expect(quote('a\\b')).toBe("'a\\\\b'");
  });

  it('unescapes a model-escaped selector', () => {
    expect(unescapeCapture('[data-testid=\\"add-task\\"]')).toBe('[data-testid="add-task"]');
  });
});

describe('template rules — navigation', () => {
  it('compiles a page reload', () => {
    expect(code('I reload the page')).toBe('await page.reload();');
  });

  it('compiles an explicit navigation', () => {
    expect(code('I navigate to /stats')).toBe("await page.goto('/stats');");
  });

  it('treats "I am on the tasks page" as a no-op comment', () => {
    expect(ruleOf('I am on the tasks page')).toBe('on-page-noop');
  });

  it('compiles "the page has loaded" to a load-state wait', () => {
    expect(code('the page has loaded')).toBe("await page.waitForLoadState('domcontentloaded');");
  });
});

describe('template rules — input', () => {
  it('fills a selector with a value', () => {
    expect(code('I fill in "[data-testid=\\"new-task-input\\"]" with "Ship it"')).toBe(
      "await page.locator('[data-testid=\"new-task-input\"]').fill('Ship it');",
    );
  });

  it('fills a placeholder-labelled field', () => {
    expect(code('I type "Buy milk" into "What needs doing?"')).toBe(
      "await page.getByPlaceholder('What needs doing?').fill('Buy milk');",
    );
  });
});

describe('template rules — clicking', () => {
  it('clicks a button by label', () => {
    expect(code('I click the button labelled "Add task"')).toBe(
      "await page.getByRole('button', { name: 'Add task' }).first().click();",
    );
  });

  it('accepts the American spelling "labeled"', () => {
    expect(ruleOf('I click the button labeled "Add task"')).toBe('click-button-labelled');
  });

  it('clicks a link by label', () => {
    expect(code('I click the link labelled "Stats"')).toBe(
      "await page.getByRole('link', { name: 'Stats' }).first().click();",
    );
  });

  it('clicks the last element matching an escaped selector', () => {
    expect(code('I click the last element matching "[data-testid=\\"delete-task\\"]"')).toBe(
      'await page.locator(\'[data-testid="delete-task"]\').last().click();',
    );
  });

  it('clicks the second element matching a selector', () => {
    expect(code('I click the second element matching "#row"')).toBe(
      "await page.locator('#row').nth(1).click();",
    );
  });

  it('clicks a bare selector', () => {
    expect(code('I click "[data-testid=\\"add-task\\"]"')).toBe(
      'await page.locator(\'[data-testid="add-task"]\').first().click();',
    );
  });

  it('falls back to text matching for a non-selector target', () => {
    expect(ruleOf('I click "Delete"')).toBe('click-text');
  });
});

describe('template rules — checkboxes', () => {
  it('checks the first matching element', () => {
    expect(code('I check the first element matching "[data-testid=\\"toggle-complete\\"]"')).toBe(
      'await page.locator(\'[data-testid="toggle-complete"]\').first().check();',
    );
  });

  it('accepts "tick" as a synonym for check', () => {
    expect(ruleOf('I tick "#done"')).toBe('check-selector');
  });
});

describe('template rules — assertions', () => {
  it('asserts an element count', () => {
    expect(code('the element "[data-testid=\\"task-item\\"]" should have count 2')).toBe(
      'await expect(page.locator(\'[data-testid="task-item"]\')).toHaveCount(2);',
    );
  });

  it('asserts element text', () => {
    expect(code('the element "[data-testid=\\"stat-total\\"]" should have text "3"')).toBe(
      "await expect(page.locator('[data-testid=\"stat-total\"]')).toHaveText('3');",
    );
  });

  it('asserts the first element is checked', () => {
    expect(code('the first element matching "[data-testid=\\"toggle\\"]" should be checked')).toBe(
      'await expect(page.locator(\'[data-testid="toggle"]\').first()).toBeChecked();',
    );
  });

  it('asserts an element is NOT checked', () => {
    expect(ruleOf('the first element matching "#a" should not be checked')).toBe(
      'assert-nth-not-checked',
    );
  });

  it('asserts visible text', () => {
    expect(code('I should see "Ship the release"')).toBe(
      "await expect(page.getByText('Ship the release').first()).toBeVisible();",
    );
  });

  it('asserts absent text', () => {
    expect(code('I should not see "Deleted task"')).toBe(
      "await expect(page.getByText('Deleted task')).toHaveCount(0);",
    );
  });

  it('prefers the negative rule over the positive one', () => {
    expect(ruleOf('I should not see "x"')).toBe('assert-should-not-see');
  });

  it('asserts a selector is visible', () => {
    expect(ruleOf('the element "[data-testid=\\"stat-total\\"]" should be visible')).toBe(
      'assert-visible',
    );
  });

  it('asserts a selector is hidden', () => {
    expect(code('"[data-testid=\\"row\\"]" should be hidden')).toBe(
      'await expect(page.locator(\'[data-testid="row"]\').first()).toBeHidden();',
    );
  });
});

describe('splitClause', () => {
  it('splits a compound clause on " and "', () => {
    expect(splitClause('I click "A" and I click "B"')).toEqual(['I click "A"', 'I click "B"']);
  });

  it('does not split inside a quoted value', () => {
    expect(splitClause('I fill in "#x" with "salt and pepper"')).toEqual([
      'I fill in "#x" with "salt and pepper"',
    ]);
  });

  it('returns a single-part clause unchanged', () => {
    expect(splitClause('I reload the page')).toEqual(['I reload the page']);
  });

  it('ignores a trailing " and "', () => {
    expect(splitClause('I click "A" and ')).toEqual(['I click "A"']);
  });
});

describe('compileClause', () => {
  it('compiles every part of a compound clause', () => {
    const result = compileClause(
      'I fill in "#new" with "Task" and I click the button labelled "Add task"',
    );
    expect(result.steps).toHaveLength(2);
    expect(result.unmatched).toEqual([]);
  });

  it('reports a clause no template understands', () => {
    const result = compileClause('I telepathically will the form into submitting');
    expect(result.steps).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
  });

  it('marks template-compiled steps with origin "template"', () => {
    const result = compileClause('I reload the page');
    expect(result.steps[0]?.origin).toBe('template');
  });
});

describe('sanitizeLlmSnippet', () => {
  it('strips markdown fences', () => {
    expect(sanitizeLlmSnippet('```ts\nawait page.click("#a");\n```')).toEqual([
      'await page.click("#a");',
    ]);
  });

  it('drops import lines', () => {
    expect(
      sanitizeLlmSnippet("import { test } from '@playwright/test';\nawait page.reload();"),
    ).toEqual(['await page.reload();']);
  });

  it('drops prose the model wrapped around the code', () => {
    expect(sanitizeLlmSnippet('Sure! Here is the code:\nawait page.reload();')).toEqual([
      'await page.reload();',
    ]);
  });

  it('caps output at 3 statements', () => {
    const many = Array.from({ length: 6 }, (_, i) => `await page.click('#${i}');`).join('\n');
    expect(sanitizeLlmSnippet(many)).toHaveLength(3);
  });

  it('returns nothing usable for an empty response', () => {
    expect(sanitizeLlmSnippet('   ')).toEqual([]);
  });
});

describe('generateTests', () => {
  const testCase: TestCase = {
    id: 'sample-case',
    featureId: 'home-form-add-task',
    title: 'Adding a task works',
    priority: 'critical',
    gherkin: {
      given: 'I am on the tasks page',
      when: 'I click the button labelled "Add task"',
      then: 'I should see "Task added"',
    },
    targetRoute: '/',
  };

  const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'argus-codegen-'));

  it('writes one spec file per test case', async () => {
    const dir = tmpDir();
    const files = await generateTests([testCase], { outputDir: dir, ai: null });
    expect(files).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'sample-case.spec.ts'))).toBe(true);
  });

  it('includes the TestCase id in a comment header for traceability', async () => {
    const dir = tmpDir();
    const [file] = await generateTests([testCase], { outputDir: dir, ai: null });
    expect(file?.contents).toContain('TestCase.id : sample-case');
  });

  it('embeds the id as a Playwright annotation so results map back', async () => {
    const dir = tmpDir();
    const [file] = await generateTests([testCase], { outputDir: dir, ai: null });
    expect(file?.contents).toContain("description: 'sample-case'");
  });

  it('navigates to the target route before the steps run', async () => {
    const dir = tmpDir();
    const [file] = await generateTests([testCase], { outputDir: dir, ai: null });
    expect(file?.contents).toContain("await page.goto('/');");
  });

  it('produces syntactically balanced output', async () => {
    const dir = tmpDir();
    const [file] = await generateTests([testCase], { outputDir: dir, ai: null });
    const text = file?.contents ?? '';
    const opens = (text.match(/\{/g) ?? []).length;
    const closes = (text.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('uses no LLM calls when every clause matches a template', async () => {
    const dir = tmpDir();
    const [file] = await generateTests([testCase], { outputDir: dir, ai: null });
    expect(file?.usedLlmFallback).toBe(false);
  });

  it('cleans stale spec files before regenerating', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'old.spec.ts'), '// stale');
    await generateTests([testCase], { outputDir: dir, ai: null });
    expect(fs.existsSync(path.join(dir, 'old.spec.ts'))).toBe(false);
  });

  it('marks a clause as UNRESOLVED when no template matches and no AI is available', async () => {
    const dir = tmpDir();
    const odd: TestCase = {
      ...testCase,
      id: 'odd-case',
      gherkin: { ...testCase.gherkin, when: 'I perform an inscrutable ritual' },
    };
    const [file] = await generateTests([odd], { outputDir: dir, ai: null });
    expect(file?.contents).toContain('UNRESOLVED');
  });

  it('falls back to the LLM only for clauses no template matched', async () => {
    const dir = tmpDir();
    const calls: string[] = [];
    const ai: AiClient = {
      id: 'mock',
      mode: 'mock',
      callCount: 0,
      async complete(req) {
        calls.push(req.purpose);
        return "await page.getByText('ritual complete').click();";
      },
    };
    const odd: TestCase = {
      ...testCase,
      id: 'odd-case',
      gherkin: { ...testCase.gherkin, when: 'I perform an inscrutable ritual' },
    };
    const [file] = await generateTests([odd], { outputDir: dir, ai });
    expect(calls).toHaveLength(1);
    expect(file?.usedLlmFallback).toBe(true);
  });
});

describe('codegenStats', () => {
  it('separates template steps from LLM steps', () => {
    const stats = codegenStats([
      {
        testCaseId: 'a',
        fileName: 'a.spec.ts',
        filePath: '/a.spec.ts',
        contents: '',
        usedLlmFallback: true,
        steps: [
          { source: 's', code: 'c', origin: 'template', rule: 'click-text' },
          { source: 's', code: 'c', origin: 'llm', rule: 'llm-fallback' },
          { source: 's', code: 'c', origin: 'template', rule: 'unresolved' },
        ],
      },
    ]);
    expect(stats).toEqual({ files: 1, steps: 3, templateSteps: 1, llmSteps: 1, unresolved: 1 });
  });
});
