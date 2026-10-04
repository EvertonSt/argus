import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderVerification, verifyRun } from '../../src/cli/verify-run';

let root: string;
let runsDir: string;
let generatedTestsDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-verify-'));
  runsDir = path.join(root, 'data', 'runs');
  generatedTestsDir = path.join(root, 'generated-tests');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(generatedTestsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const options = () => ({ runsDir, generatedTestsDir, root });

/** A complete, passing run. Overridable so tests can break one field at a time. */
function writeCompleteRun(overrides: Record<string, unknown> = {}, opts: { specs?: number } = {}) {
  const runId = 'run-1';
  const index = [
    {
      runId,
      timestamp: '2026-10-04T00:00:00.000Z',
      mode: 'mock',
      target: 'http://localhost:4317',
      provider: 'mock',
      total: 8,
      passed: 8,
      failed: 0,
      realBugs: 0,
      flaky: 0,
      selectorDrift: 0,
      environmentIssues: 0,
      newBugs: 0,
      gateFailed: false,
      aiCalls: 0,
    },
  ];
  fs.writeFileSync(path.join(runsDir, 'index.json'), JSON.stringify(index));

  const artifact = {
    runId,
    timestamp: '2026-10-04T00:00:00.000Z',
    mode: 'mock',
    provider: 'mock',
    target: 'http://localhost:4317',
    inventory: { source: 'crawl', features: [] },
    testCases: [],
    summary: {
      runId,
      timestamp: '2026-10-04T00:00:00.000Z',
      total: 8,
      passed: 8,
      failed: 0,
      failures: [],
    },
    triage: [],
    filedBugs: [],
    aiCalls: 0,
    gateFailed: false,
    gateReason: 'no new bugs at or above "high" severity',
    ...overrides,
  };
  const runDir = path.join(runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(artifact));

  const specs = opts.specs ?? 1;
  for (let i = 0; i < specs; i += 1) {
    fs.writeFileSync(path.join(generatedTestsDir, `case-${i}.spec.ts`), '');
  }
  return runId;
}

describe('verifyRun — a complete run', () => {
  it('reports ok when the gate passed', () => {
    writeCompleteRun();
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('ok');
    expect(verdict.problems).toEqual([]);
    expect(verdict.runId).toBe('run-1');
    expect(verdict.passed).toBe(8);
    expect(verdict.total).toBe(8);
  });

  it('reports gate_failed when the recorded verdict is a failure', () => {
    writeCompleteRun({ gateFailed: true, gateReason: '1 new bug(s) at or above "high" severity' });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('gate_failed');
    expect(verdict.gateReason).toContain('1 new bug');
  });

  it('counts new and baselined bugs separately', () => {
    writeCompleteRun({
      filedBugs: [
        { id: 'BUG-1', isDuplicateOf: 'BUG-0' },
        { id: 'BUG-2', baselinedAs: 'BASE-001' },
        { id: 'BUG-3' },
      ],
    });
    const verdict = verifyRun(options());
    expect(verdict.newBugs).toBe(1);
    expect(verdict.knownBugs).toBe(1);
  });

  it('uses the newest run when several are indexed', () => {
    writeCompleteRun();
    const indexPath = path.join(runsDir, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    fs.writeFileSync(
      indexPath,
      JSON.stringify([...index, { ...index[0], runId: 'run-2', gateFailed: true }]),
    );
    const runDir = path.join(runsDir, 'run-2');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify({
        runId: 'run-2',
        gateFailed: true,
        gateReason: 'new bug',
        summary: { total: 1, passed: 1, failed: 0 },
        testCases: [],
        inventory: {},
      }),
    );
    const verdict = verifyRun(options());
    expect(verdict.runId).toBe('run-2');
    expect(verdict.status).toBe('gate_failed');
  });
});

describe('verifyRun — the pipeline did not finish', () => {
  it('reports incomplete when no run index exists', () => {
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems[0]).toContain('never reached the report stage');
  });

  it('reports incomplete when the index is empty', () => {
    fs.writeFileSync(path.join(runsDir, 'index.json'), '[]');
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems[0]).toContain('empty');
  });

  it('reports incomplete when the index is corrupt, and says so', () => {
    // The regression this guards: falling back to a default would turn "the run
    // wrote something broken" into "the run never happened".
    fs.writeFileSync(path.join(runsDir, 'index.json'), '{not json');
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems[0]).toContain('could not be parsed');
  });

  it('reports incomplete when the index is not an array', () => {
    fs.writeFileSync(path.join(runsDir, 'index.json'), '{"runs":[]}');
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems[0]).toContain('not an array');
  });

  it('reports incomplete when a run is indexed but its artifact is missing', () => {
    fs.writeFileSync(
      path.join(runsDir, 'index.json'),
      JSON.stringify([{ runId: 'run-9', gateFailed: true }]),
    );
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems[0]).toContain('started and did not finish');
  });

  it('reports incomplete when the newest entry has no run id', () => {
    fs.writeFileSync(path.join(runsDir, 'index.json'), JSON.stringify([{ gateFailed: true }]));
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems[0]).toContain('no run id');
  });

  it('reports incomplete when codegen produced no specs', () => {
    writeCompleteRun({}, { specs: 0 });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems.some((p) => p.includes('codegen stage produced nothing'))).toBe(true);
  });

  it('reports incomplete when the generated-tests directory is absent', () => {
    writeCompleteRun();
    fs.rmSync(generatedTestsDir, { recursive: true, force: true });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
  });
});

describe('verifyRun — a half-written artifact is not a verdict', () => {
  it('refuses to act on a gate flag when the summary is missing', () => {
    // The artifact says gateFailed: false, but it is not a real record. Trusting
    // it would let a crashed report stage pass as a green gate.
    writeCompleteRun({ summary: undefined });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems.some((p) => p.includes('execution summary'))).toBe(true);
  });

  it('refuses to act on a gate flag when the summary counts are missing', () => {
    writeCompleteRun({ summary: { total: 8 } });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems.some((p) => p.includes('no passed count'))).toBe(true);
    expect(verdict.problems.some((p) => p.includes('no failed count'))).toBe(true);
  });

  it('refuses to act when no gate verdict is recorded', () => {
    writeCompleteRun({ gateFailed: undefined });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems.some((p) => p.includes('no gate verdict'))).toBe(true);
  });

  it('refuses to act when the gate reason is empty', () => {
    writeCompleteRun({ gateReason: '' });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems.some((p) => p.includes('no gate reason'))).toBe(true);
  });

  it('refuses to act when the planned test cases are missing', () => {
    writeCompleteRun({ testCases: undefined });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems.some((p) => p.includes('no planned test cases'))).toBe(true);
  });

  it('refuses to act when the feature inventory is missing', () => {
    writeCompleteRun({ inventory: undefined });
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems.some((p) => p.includes('no feature inventory'))).toBe(true);
  });

  it('reports a mismatch between the index and the artifact', () => {
    writeCompleteRun();
    const runPath = path.join(runsDir, 'run-1', 'run.json');
    const artifact = JSON.parse(fs.readFileSync(runPath, 'utf-8'));
    fs.writeFileSync(runPath, JSON.stringify({ ...artifact, runId: 'run-other' }));
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems.some((p) => p.includes('index points at run-1'))).toBe(true);
  });

  it('collects every problem rather than only the first', () => {
    writeCompleteRun({ gateFailed: undefined, gateReason: '', inventory: undefined });
    const verdict = verifyRun(options());
    expect(verdict.problems.length).toBeGreaterThanOrEqual(3);
  });

  it('reports incomplete when the artifact is corrupt JSON', () => {
    writeCompleteRun();
    fs.writeFileSync(path.join(runsDir, 'run-1', 'run.json'), '{{{');
    const verdict = verifyRun(options());
    expect(verdict.status).toBe('incomplete');
    expect(verdict.problems[0]).toContain('could not be parsed');
  });
});

describe('renderVerification', () => {
  it('says explicitly that an incomplete run is not a gate result', () => {
    // The whole point. The old message said "found a new real bug" when Argus
    // had found nothing at all.
    const text = renderVerification(verifyRun(options()));
    expect(text).toContain('did not complete');
    expect(text).toContain('not a failing gate');
    expect(text).not.toContain('new real bug');
  });

  it('shows the gate verdict and counts for a passing run', () => {
    writeCompleteRun();
    const text = renderVerification(verifyRun(options()));
    expect(text).toContain('Gate passed');
    expect(text).toContain('8/8 passed');
    expect(text).toContain('run-1');
  });

  it('shows the gate reason for a failing run', () => {
    writeCompleteRun({ gateFailed: true, gateReason: '2 new bug(s) at or above "high" severity' });
    const text = renderVerification(verifyRun(options()));
    expect(text).toContain('Gate FAILED');
    expect(text).toContain('2 new bug(s)');
  });

  it('points a failing run at the baseline as the thing to check', () => {
    writeCompleteRun({ gateFailed: true, gateReason: '1 new bug(s)' });
    expect(renderVerification(verifyRun(options()))).toContain('baseline/known-bugs.json');
  });

  it('lists each specific problem', () => {
    fs.writeFileSync(path.join(runsDir, 'index.json'), '{not json');
    const text = renderVerification(verifyRun(options()));
    expect(text).toContain('could not be parsed');
  });
});
