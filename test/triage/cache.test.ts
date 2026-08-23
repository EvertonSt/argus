import { describe, it, expect } from 'vitest';
import {
  normalizeForCache,
  computeCacheKey,
  lookupCachedVerdict,
  cacheVerdict,
  cachedToTriageResult,
} from '../../src/triage/cache';
import type { CachedVerdict } from '../../src/triage/cache';

describe('triage cache', () => {
  describe('normalizeForCache', () => {
    it('strips line:col references', () => {
      const result = normalizeForCache('Error at src/foo.ts:42:17: something broke');
      expect(result).not.toContain(':42:17');
      expect(result).toContain('something broke');
    });

    it('strips UUIDs', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = normalizeForCache(`Error processing ${uuid} in request`);
      expect(result).not.toContain(uuid);
    });

    it('strips ISO timestamps', () => {
      const result = normalizeForCache('Error at 2024-01-15T10:30:00 in module');
      expect(result).not.toContain('2024-01-15T10:30:00');
    });

    it('strips URLs', () => {
      const result = normalizeForCache('Failed to fetch https://api.example.com/users/123');
      expect(result).not.toContain('https://');
      expect(result).toContain('Failed to fetch');
    });

    it('collapses whitespace', () => {
      const result = normalizeForCache('Error    with   multiple    spaces');
      expect(result).toBe('Error with multiple spaces');
    });
  });

  describe('computeCacheKey', () => {
    it('produces deterministic keys', () => {
      const key1 = computeCacheKey('test-001', 'Element not found in DOM');
      const key2 = computeCacheKey('test-001', 'Element not found in DOM');
      expect(key1).toBe(key2);
    });

    it('produces different keys for different test cases', () => {
      const key1 = computeCacheKey('test-001', 'same error');
      const key2 = computeCacheKey('test-002', 'same error');
      expect(key1).not.toBe(key2);
    });

    it('produces same key for normalized (similar) errors', () => {
      const key1 = computeCacheKey('test-001', 'Error at src/foo.ts:10:5: not found');
      const key2 = computeCacheKey('test-001', 'Error at src/foo.ts:42:17: not found');
      expect(key1).toBe(key2);
    });

    it('returns a 16-char hex string', () => {
      const key = computeCacheKey('test-001', 'some error');
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('lookupCachedVerdict', () => {
    it('returns null for a cache miss', () => {
      const cache = new Map<string, CachedVerdict>();
      const result = lookupCachedVerdict(cache, 'test-001', 'some error');
      expect(result).toBeNull();
    });

    it('returns the cached verdict on a hit', () => {
      const cache = new Map<string, CachedVerdict>();
      cacheVerdict(cache, 'test-001', 'some error', 'real_bug', 0.9, 'obvious bug');
      const result = lookupCachedVerdict(cache, 'test-001', 'some error');
      expect(result).not.toBeNull();
      expect(result!.verdict).toBe('real_bug');
      expect(result!.confidence).toBe(0.9);
    });

    it('returns null for expired entries (older than 30 days)', () => {
      const cache = new Map<string, CachedVerdict>();
      cacheVerdict(cache, 'test-001', 'some error', 'real_bug', 0.9, 'obvious bug');
      // Simulate 31 days passing since the cache was written
      const futureDate = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
      const result = lookupCachedVerdict(cache, 'test-001', 'some error', futureDate);
      expect(result).toBeNull();
    });

    it('returns entry for recent cache (within 30 days)', () => {
      const cache = new Map<string, CachedVerdict>();
      cacheVerdict(cache, 'test-001', 'some error', 'real_bug', 0.9, 'obvious bug');
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const result = lookupCachedVerdict(cache, 'test-001', 'some error', recentDate);
      expect(result).not.toBeNull();
      expect(result!.verdict).toBe('real_bug');
    });
  });

  describe('cacheVerdict', () => {
    it('stores and returns the cache key', () => {
      const cache = new Map<string, CachedVerdict>();
      const key = cacheVerdict(cache, 'test-001', 'some error', 'flaky', 0.6, 'intermittent');
      expect(key).toMatch(/^[a-f0-9]{16}$/);
      expect(cache.has(key)).toBe(true);
    });

    it('stores the source as "ai" by default', () => {
      const cache = new Map<string, CachedVerdict>();
      cacheVerdict(cache, 'test-001', 'some error', 'real_bug', 0.9, 'bug');
      const key = computeCacheKey('test-001', 'some error');
      expect(cache.get(key)!.source).toBe('ai');
    });

    it('stores the source as "rules" when specified', () => {
      const cache = new Map<string, CachedVerdict>();
      cacheVerdict(cache, 'test-001', 'some error', 'real_bug', 0.9, 'bug', undefined, 'rules');
      const key = computeCacheKey('test-001', 'some error');
      expect(cache.get(key)!.source).toBe('rules');
    });

    it('stores optional suggestedFix', () => {
      const cache = new Map<string, CachedVerdict>();
      cacheVerdict(
        cache,
        'test-001',
        'some error',
        'selector_drift',
        0.85,
        'drift',
        'use page.locator',
      );
      const key = computeCacheKey('test-001', 'some error');
      expect(cache.get(key)!.suggestedFix).toBe('use page.locator');
    });
  });

  describe('cachedToTriageResult', () => {
    it('converts a cached verdict to TriageResult', () => {
      const cache = new Map<string, CachedVerdict>();
      cacheVerdict(cache, 'test-001', 'some error', 'real_bug', 0.9, 'obvious bug', 'fix it');
      const key = computeCacheKey('test-001', 'some error');
      const entry = cache.get(key)!;
      const result = cachedToTriageResult(entry, 'test-001');
      expect(result.testCaseId).toBe('test-001');
      expect(result.verdict).toBe('real_bug');
      expect(result.confidence).toBe(0.9);
      expect(result.reasoning).toContain('[CACHE]');
      expect(result.suggestedFix).toBe('fix it');
    });
  });
});
