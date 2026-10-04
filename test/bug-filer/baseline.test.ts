import { describe, it, expect } from 'vitest';
import type { BugSignature, FiledBug } from '../../src/shared/types';
import {
  isBaselineBug,
  loadBaseline,
  matchBaseline,
  nextBaselineId,
  parseBaseline,
  type BaselineBug,
} from '../../src/bug-filer/baseline';
import { newBugs } from '../../src/bug-filer';

/** A minimal valid entry, overridden per test. */
function entry(overrides: Partial<BaselineBug> = {}): BaselineBug {
  return {
    id: 'BASE-001',
    title: 'Deleting a task removes the task that was clicked',
    featureId: 'home-button-delete',
    verdict: 'real_bug',
    severity: 'critical',
    note: 'demo app BUG-1',
    recordedAt: '2026-10-04',
    ...overrides,
  };
}

function sig(overrides: Partial<BugSignature> = {}): BugSignature {
  return {
    title: 'Deleting a task removes the task that was clicked',
    featureId: 'home-button-delete',
    errorClass: 'error: expect().tohavecount() failed',
    verdict: 'real_bug',
    ...overrides,
  };
}

describe('isBaselineBug', () => {
  it('accepts a complete entry', () => {
    expect(isBaselineBug(entry())).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 42, 'BASE-001', true]) {
      expect(isBaselineBug(value)).toBe(false);
    }
  });

  it('rejects an entry with a missing or empty id', () => {
    expect(isBaselineBug({ ...entry(), id: undefined })).toBe(false);
    expect(isBaselineBug({ ...entry(), id: '' })).toBe(false);
  });

  it('rejects a typo in the severity', () => {
    expect(isBaselineBug({ ...entry(), severity: 'blocker' })).toBe(false);
  });

  it('rejects a typo in the verdict', () => {
    expect(isBaselineBug({ ...entry(), verdict: 'defect' })).toBe(false);
  });

  it('accepts an empty featureId — legacy entries fall back to title matching', () => {
    expect(isBaselineBug(entry({ featureId: '' }))).toBe(true);
  });
});

describe('parseBaseline', () => {
  it('keeps valid entries and counts the malformed ones', () => {
    const parsed = parseBaseline([
      entry({ id: 'BASE-001' }),
      { id: 'BASE-002' },
      entry({ id: 'BASE-003' }),
    ]);
    expect(parsed.entries.map((e) => e.id)).toEqual(['BASE-001', 'BASE-003']);
    expect(parsed.rejected).toBe(1);
  });

  it('treats a non-array as entirely rejected', () => {
    expect(parseBaseline({ entries: [] })).toEqual({ entries: [], rejected: 1 });
  });

  it('treats an absent file as an empty baseline, not an error', () => {
    expect(parseBaseline(undefined)).toEqual({ entries: [], rejected: 0 });
  });

  it('returns nothing for an empty array', () => {
    expect(parseBaseline([])).toEqual({ entries: [], rejected: 0 });
  });
});

describe('loadBaseline', () => {
  it('returns an empty list when the file does not exist', () => {
    // A project with no known defects has no baseline file; that is normal and
    // must not be an error, or the gate would break on a fresh project.
    expect(loadBaseline('/nonexistent/known-bugs.json')).toEqual([]);
  });
});

describe('matchBaseline', () => {
  it('matches on featureId and verdict', () => {
    const match = matchBaseline(sig(), [entry()]);
    expect(match?.entry.id).toBe('BASE-001');
    expect(match?.titleScore).toBe(1);
  });

  it('still matches when the title has been reworded', () => {
    // The whole reason matching is not keyed on the Playwright error text: a
    // live run's planner words its test case differently from a mock run's, and
    // the failure must not suddenly read as a new bug because of that.
    const match = matchBaseline(sig({ title: 'Delete button removes the wrong task' }), [entry()]);
    expect(match?.entry.id).toBe('BASE-001');
  });

  it('still matches when the error class is completely different', () => {
    // A Playwright error embeds retry counts and call logs. Keyed on that, a
    // baseline entry would stop matching on the very next run.
    const match = matchBaseline(
      sig({ errorClass: 'error: totally different text 9 × with a call log' }),
      [entry()],
    );
    expect(match?.entry.id).toBe('BASE-001');
  });

  it('does not match a different feature', () => {
    expect(matchBaseline(sig({ featureId: 'home-form-add-task' }), [entry()])).toBeNull();
  });

  it('does not match a different verdict', () => {
    expect(matchBaseline(sig({ verdict: 'flaky' }), [entry()])).toBeNull();
  });

  it('does not match a different feature even when the title is identical', () => {
    // Guards the failure mode where title similarity alone would suppress a
    // genuine regression in an unrelated part of the app.
    expect(matchBaseline(sig({ featureId: 'about-page-copy' }), [entry()])).toBeNull();
  });

  it('falls back to title similarity when the entry pins no feature', () => {
    const legacy = entry({ id: 'BASE-009', featureId: '' });
    expect(matchBaseline(sig({ featureId: '' }), [legacy])?.entry.id).toBe('BASE-009');
  });

  it('does not match a legacy entry on an unrelated title', () => {
    const legacy = entry({ id: 'BASE-009', featureId: '' });
    expect(
      matchBaseline(sig({ featureId: '', title: 'Stats page total is wrong' }), [legacy]),
    ).toBeNull();
  });

  it('returns the best match when several entries share a feature', () => {
    const match = matchBaseline(sig(), [
      entry({ id: 'BASE-001', title: 'Totally unrelated words here' }),
      entry({ id: 'BASE-002', title: 'Deleting a task removes the task that was clicked' }),
    ]);
    expect(match?.entry.id).toBe('BASE-002');
  });

  it('returns null against an empty baseline', () => {
    expect(matchBaseline(sig(), [])).toBeNull();
  });
});

describe('nextBaselineId', () => {
  it('starts at BASE-001 for an empty baseline', () => {
    expect(nextBaselineId([])).toBe('BASE-001');
  });

  it('increments past the highest id, zero-padded', () => {
    expect(nextBaselineId([entry({ id: 'BASE-007' })])).toBe('BASE-008');
  });

  it('ignores ids that are not in the BASE-N form', () => {
    expect(nextBaselineId([entry({ id: 'legacy-thing' })])).toBe('BASE-001');
  });

  it('handles a gap in the numbering', () => {
    expect(nextBaselineId([entry({ id: 'BASE-002' }), entry({ id: 'BASE-009' })])).toBe('BASE-010');
  });
});

describe('newBugs — what the gate counts', () => {
  function filed(overrides: Partial<FiledBug>): FiledBug {
    return {
      id: 'BUG-1',
      testCaseId: 'tc-1',
      title: 'A bug',
      severity: 'high',
      environment: 'test',
      reproSteps: [],
      filedAt: '2026-10-04T00:00:00.000Z',
      runId: 'run-1',
      ...overrides,
    };
  }

  it('counts a plain bug as new', () => {
    expect(newBugs([filed({ id: 'BUG-1' })])).toHaveLength(1);
  });

  it('excludes a bug that duplicates one already filed in this workspace', () => {
    expect(newBugs([filed({ id: 'BUG-1', isDuplicateOf: 'BUG-0' })])).toHaveLength(0);
  });

  it('excludes a bug that matches the committed baseline', () => {
    expect(newBugs([filed({ id: 'BUG-1', baselinedAs: 'BASE-001' })])).toHaveLength(0);
  });

  it('keeps the new bugs and drops both kinds of known one', () => {
    const bugs = [
      filed({ id: 'BUG-1' }),
      filed({ id: 'BUG-2', baselinedAs: 'BASE-001' }),
      filed({ id: 'BUG-3', isDuplicateOf: 'BUG-1' }),
    ];
    expect(newBugs(bugs).map((b) => b.id)).toEqual(['BUG-1']);
  });
});
