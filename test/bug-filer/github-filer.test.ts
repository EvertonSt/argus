import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGitHubIssue,
  getGitHubConfig,
  fileBugsToGitHub,
} from '../../src/bug-filer/github-filer.js';
import type { FiledBug, TriageVerdict } from '../../src/shared/types.js';

describe('github-filer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockBug: FiledBug = {
    id: 'BUG-test-001',
    testCaseId: 'tc-1',
    title: 'Delete removes wrong task',
    severity: 'high',
    environment: 'macOS, Chrome 126',
    reproSteps: ['Navigate to /', 'Click delete on task A'],
    filedAt: '2025-01-15T10:30:00Z',
    runId: 'run-001',
    signature: {
      title: 'Delete removes wrong task',
      featureId: 'f1',
      errorClass: 'assertionerror',
      verdict: 'real_bug' as TriageVerdict,
    },
  };

  describe('getGitHubConfig', () => {
    it('reads token and repo from env', () => {
      process.env.ARGUS_GITHUB_TOKEN = 'ghp_test_token';
      process.env.ARGUS_GITHUB_REPO = 'EvertonSt/argus';
      const config = getGitHubConfig();
      expect(config.token).toBe('ghp_test_token');
      expect(config.repo).toBe('EvertonSt/argus');
      expect(config.owner).toBe('EvertonSt');
    });

    it('returns undefined when env vars are missing', () => {
      delete process.env.ARGUS_GITHUB_TOKEN;
      delete process.env.ARGUS_GITHUB_REPO;
      const config = getGitHubConfig();
      expect(config.token).toBeUndefined();
      expect(config.repo).toBeUndefined();
    });
  });

  describe('createGitHubIssue', () => {
    it('returns null when GitHub is not configured', async () => {
      delete process.env.ARGUS_GITHUB_TOKEN;
      delete process.env.ARGUS_GITHUB_REPO;
      const result = await createGitHubIssue(mockBug, {
        token: undefined,
        repo: undefined,
        owner: undefined,
      });
      expect(result).toBeNull();
    });

    it('returns isDuplicate=true when bug is a duplicate', async () => {
      const dupBug: FiledBug = { ...mockBug, isDuplicateOf: 'BUG-test-000' };
      const result = await createGitHubIssue(dupBug, {
        token: 'test-token',
        repo: 'EvertonSt/argus',
        owner: 'EvertonSt',
      });
      expect(result).toEqual({ number: 0, url: '', isDuplicate: true });
    });
  });

  describe('fileBugsToGitHub', () => {
    it('returns empty object when GitHub is not configured', async () => {
      delete process.env.ARGUS_GITHUB_TOKEN;
      delete process.env.ARGUS_GITHUB_REPO;
      const result = await fileBugsToGitHub([mockBug]);
      expect(result).toEqual({});
    });
  });
});
