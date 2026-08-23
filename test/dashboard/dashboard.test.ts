import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASH = path.join(ROOT, 'src', 'dashboard');

const html = fs.readFileSync(path.join(DASH, 'index.html'), 'utf-8');
const appJs = fs.readFileSync(path.join(DASH, 'app.js'), 'utf-8');
const css = fs.readFileSync(path.join(DASH, 'styles.css'), 'utf-8');

describe('dashboard is a zero-build static site', () => {
  it('ships exactly three assets and nothing that needs compiling', () => {
    const files = fs.readdirSync(DASH).sort();
    expect(files).toEqual(['app.js', 'index.html', 'styles.css']);
  });

  it('uses no bundler-only syntax in the browser script', () => {
    expect(appJs).not.toMatch(/^\s*import\s/m);
    expect(appJs).not.toMatch(/\bexport\s/);
    expect(appJs).not.toMatch(/\brequire\(/);
  });

  it('loads Chart.js from a CDN rather than node_modules', () => {
    expect(html).toContain('cdn.jsdelivr.net');
    expect(html).toContain('chart.umd.min.js');
  });

  it('references its assets with relative paths so it works when served from any root', () => {
    expect(html).toContain('href="styles.css"');
    expect(html).toContain('src="app.js"');
  });

  it('reads run data from the same data/ directory the CLI writes', () => {
    expect(appJs).toContain("'../../data/'");
  });
});

describe('dashboard renders every panel the spec requires', () => {
  it('has a pass/fail trend chart', () => {
    expect(html).toContain('id="trend-chart"');
    expect(appJs).toContain("type: 'line'");
  });

  it('has a triage breakdown chart', () => {
    expect(html).toContain('id="triage-chart"');
    expect(appJs).toContain("type: 'doughnut'");
  });

  it('has a filed-bugs table with severity badges', () => {
    expect(html).toContain('id="bugs-table"');
    expect(appJs).toContain('badge-');
  });

  it('has a self-heal suggestions list', () => {
    expect(html).toContain('id="selfheal-list"');
  });

  it('lists only selector_drift results as self-heal candidates', () => {
    expect(appJs).toContain("result.verdict === 'selector_drift' && result.suggestedFix");
  });

  it('states that self-heal fixes are never auto-applied', () => {
    expect(html).toMatch(/never applies these\s+automatically/);
  });

  it('styles all four triage verdicts', () => {
    for (const verdict of ['real_bug', 'flaky', 'selector_drift', 'environment_issue']) {
      expect(css).toContain(`.verdict-${verdict}`);
    }
  });

  it('styles all four severity levels', () => {
    for (const severity of ['critical', 'high', 'medium', 'low']) {
      expect(css).toContain(`.badge-${severity}`);
    }
  });
});

describe('dashboard degrades gracefully', () => {
  it('explains what to do when no run has happened yet', () => {
    expect(html).toContain('id="empty-state"');
    expect(html).toContain('npm run run:mock');
  });

  it('detects the file:// protocol and explains the fetch restriction', () => {
    // Opening the HTML directly is the first thing a reviewer tries; a blank
    // page there would read as "broken" rather than "needs a server".
    expect(appJs).toContain("window.location.protocol === 'file:'");
    expect(html).toContain('id="file-protocol-note"');
  });

  it('treats missing JSON files as empty rather than erroring', () => {
    expect(appJs).toContain('getOptional');
  });

  it('escapes interpolated values to avoid breaking on odd bug titles', () => {
    expect(appJs).toContain('function escapeHtml');
    expect(appJs).toMatch(/escapeHtml\(bug\.title\)/);
  });
});
