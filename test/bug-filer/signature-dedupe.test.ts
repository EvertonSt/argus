import { describe, it, expect } from 'vitest';
import type { FiledBug, BugSignature } from '../../src/shared/types';
import { buildSignature, findDuplicate } from '../../src/bug-filer/duplicate-check';

describe('signature-based dedupe', () => {
  it('buildSignature creates a fingerprint from title + featureId + errorClass', () => {
    const sig = buildSignature(
      'Deleting a task removes wrong task',
      'f1',
      'AssertionError',
      'real_bug',
    );
    expect(sig.title).toBe('Deleting a task removes wrong task');
    expect(sig.featureId).toBe('f1');
    expect(sig.errorClass).toBe('assertionerror');
    expect(sig.verdict).toBe('real_bug');
  });

  it('does not flag bugs with same title but different errorClass as duplicates', () => {
    const a: FiledBug = {
      id: 'BUG-1',
      testCaseId: 'tc-1',
      title: 'Same title',
      severity: 'high',
      environment: 'test',
      reproSteps: [],
      filedAt: 'now',
      runId: 'r1',
      signature: {
        title: 'Same title',
        featureId: 'f1',
        errorClass: 'TypeError',
        verdict: 'real_bug',
      },
    };

    // Title-only match would score ~1.0, but errorClass differs → combined score < 0.55
    const sig: BugSignature = {
      title: 'Same title',
      featureId: 'f1',
      errorClass: 'AssertionError',
      verdict: 'real_bug',
    };
    expect(findDuplicate(sig, [a])).toBeNull();
  });

  it('flags bugs with same title and same errorClass as duplicates', () => {
    const a: FiledBug = {
      id: 'BUG-1',
      testCaseId: 'tc-1',
      title: 'Deleting wrong task',
      severity: 'high',
      environment: 'test',
      reproSteps: [],
      filedAt: 'now',
      runId: 'r1',
      signature: {
        title: 'Deleting wrong task',
        featureId: 'f1',
        errorClass: 'AssertionError',
        verdict: 'real_bug',
      },
    };
    const sig: BugSignature = {
      title: 'Deleting wrong task',
      featureId: 'f1',
      errorClass: 'AssertionError',
      verdict: 'real_bug',
    };
    const match = findDuplicate(sig, [a]);
    expect(match).not.toBeNull();
    expect(match!.id).toBe('BUG-1');
    expect(match!.score).toBeGreaterThan(0.55);
  });

  it('accepts a bare title string (backwards compatibility)', () => {
    const a: FiledBug = {
      id: 'BUG-1',
      testCaseId: 'tc-1',
      title: 'Deleting wrong task',
      severity: 'high',
      environment: 'test',
      reproSteps: [],
      filedAt: 'now',
      runId: 'r1',
      // No signature — legacy bug, should use title-only fallback
    };
    const match = findDuplicate('Deleting wrong task', [a]);
    expect(match).not.toBeNull();
    expect(match!.score).toBe(1); // Exact title match
  });
});
