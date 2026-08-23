/**
 * Verdict cache — avoids re-triaging the same error with an AI call.
 *
 * Mirrors Cerberus CI's approach: normalize the error message (strip line
 * numbers, UUIDs, timestamps), hash the signature, and cache the triage
 * verdict. On cache hit, skip the AI call entirely.
 *
 * Cache lives in data/triage-cache.json with a 30-day TTL (configurable).
 * Fully deterministic — the cache key is computed, not learned.
 */
import crypto from 'node:crypto';
import type { TriageVerdict, TriageResult } from '../shared/types.js';

export interface CachedVerdict {
  signature: string;
  verdict: TriageVerdict;
  confidence: number;
  reasoning: string;
  suggestedFix?: string;
  cachedAt: string;
  source: 'ai' | 'rules';
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Normalize an error message for caching. Strip line numbers, UUIDs,
 * timestamps, and other high-entropy tokens that vary between runs but
 * don't change the fundamental nature of the error.
 */
export function normalizeForCache(raw: string): string {
  return raw
    .replace(/:\d+:\d+/g, '') // strip :line:col
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '') // strip UUIDs
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '') // strip timestamps
    .replace(/https?:\/\/[^\s]+/g, '') // strip URLs
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compute a deterministic SHA-256 hash of the cache key. */
export function computeCacheKey(testCaseId: string, errorMessage: string): string {
  const normalized = normalizeForCache(errorMessage);
  return crypto
    .createHash('sha256')
    .update(testCaseId + '|' + normalized)
    .digest('hex')
    .slice(0, 16);
}

/** Check the verdict cache for a prior triage of the same error. */
export function lookupCachedVerdict(
  cache: Map<string, CachedVerdict>,
  testCaseId: string,
  errorMessage: string,
  now: Date = new Date(),
): CachedVerdict | null {
  const key = computeCacheKey(testCaseId, errorMessage);
  const entry = cache.get(key);
  if (!entry) return null;

  // TTL check
  const age = now.getTime() - new Date(entry.cachedAt).getTime();
  if (age > DEFAULT_TTL_MS) return null;

  return entry;
}

/** Store a triage verdict in the cache. */
export function cacheVerdict(
  cache: Map<string, CachedVerdict>,
  testCaseId: string,
  errorMessage: string,
  verdict: TriageVerdict,
  confidence: number,
  reasoning: string,
  suggestedFix?: string,
  source: 'ai' | 'rules' = 'ai',
): string {
  const key = computeCacheKey(testCaseId, errorMessage);
  cache.set(key, {
    signature: key,
    verdict,
    confidence,
    reasoning,
    suggestedFix,
    cachedAt: new Date().toISOString(),
    source,
  });
  return key;
}

/**
 * Build a triage result from a cached verdict, preserving the original
 * testCaseId and test-case context.
 */
export function cachedToTriageResult(cacheEntry: CachedVerdict, testCaseId: string): TriageResult {
  return {
    testCaseId,
    verdict: cacheEntry.verdict,
    confidence: cacheEntry.confidence,
    reasoning: `[CACHE] ${cacheEntry.reasoning}`,
    suggestedFix: cacheEntry.suggestedFix,
  };
}
