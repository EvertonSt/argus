import { describe, it, expect } from 'vitest';
import { renderAnnotations, renderCiOutput } from '../../src/cli/ci-report.js';
import type { CiReportInput } from '../../src/cli/ci-report.js';

describe('ci-report annotations', () => {
  const mockArtifact: CiReportInput = {
    runId: 'run-test-001',
    timestamp: '2025-01-15T10:30:00Z',
    mode: 'mock',
    provider: 'mock',
    target: 'http://localhost:4317',
    inventory: {
      source: 'crawl',
      features: [{ id: 'f1', name: 'Delete task', description: 'test', routes: ['/'] }],
    },
    testCases: [
      {
        id: 'tc-2',
        featureId: 'f1',
        title: 'can delete',
        priority: 'high',
        gherkin: { given: '', when: '', then: '' },
        targetRoute: '/',
      },
    ],
    summary: {
      runId: 'run-test-001',
      timestamp: '2025-01-15T10:30:00Z',
      total: 3,
      passed: 0,
      failed: 3,
      failures: [{ testCaseId: 'tc-2', errorMessage: 'AssertionError: element not found' }],
    },
    triage: [{ testCaseId: 'tc-2', verdict: 'real_bug', confidence: 0.94, reasoning: 'test' }],
    filedBugs: [
      {
        id: 'BUG-1',
        testCaseId: 'tc-2',
        title: 'Delete removes wrong task',
        severity: 'high',
        environment: 'macOS',
        reproSteps: [],
        filedAt: '2025-01-15T10:30:00Z',
        runId: 'run-test-001',
      },
    ],
    aiCalls: 5,
    gateFailed: true,
    gateReason: '1 high severity bug found',
    threshold: 'high',
  };

  describe('renderAnnotations', () => {
    it('generates ::error annotations for real bugs', () => {
      const output = renderAnnotations(mockArtifact);
      expect(output).toContain('::error file=generated-tests/tc-2.spec.ts,line=1::');
      expect(output).toContain('Argus 🐞 Real bug (94%)');
      expect(output).toContain('AssertionError: element not found');
    });

    it('generates ::warning annotations for non-critical verdicts', () => {
      const flakyArtifact: CiReportInput = {
        ...mockArtifact,
        summary: {
          ...mockArtifact.summary,
          failures: [{ testCaseId: 'tc-flaky', errorMessage: 'timeout' }],
        },
        triage: [
          { testCaseId: 'tc-flaky', verdict: 'flaky', confidence: 0.62, reasoning: 'flaky' },
        ],
      };
      const output = renderAnnotations(flakyArtifact);
      expect(output).toContain('::warning');
    });

    it('returns empty string when there are no failures', () => {
      const cleanArtifact: CiReportInput = {
        ...mockArtifact,
        summary: { ...mockArtifact.summary, failures: [], total: 5, passed: 5, failed: 0 },
        triage: [],
      };
      const output = renderAnnotations(cleanArtifact);
      expect(output).toBe('');
    });
  });

  describe('renderCiOutput', () => {
    it('combines PR comment and annotations', () => {
      const output = renderCiOutput(mockArtifact);
      expect(output).toContain('INLINE ANNOTATIONS');
      expect(output).toContain('::error');
    });
  });
});
