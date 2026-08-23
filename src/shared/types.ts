/**
 * Argus — shared domain types.
 *
 * These interfaces are the contract between pipeline stages. Each stage
 * consumes the previous stage's output type and nothing else, which is what
 * lets the whole pipeline be exercised from fixtures with no live services.
 */

// ---------------------------------------------------------------------------
// Stage 1 — Ingestion
// ---------------------------------------------------------------------------

export interface Feature {
  /** Short slug, e.g. "add-task". Stable across runs. */
  id: string;
  name: string;
  /** Plain-language summary handed to the planner LLM. */
  description: string;
  /** URLs or route paths involved. */
  routes: string[];
  /** Known selectors, populated only when the source was a crawl. */
  keySelectors?: string[];
}

export interface FeatureInventory {
  source: 'crawl' | 'specs' | 'both';
  features: Feature[];
}

// ---------------------------------------------------------------------------
// Stage 2 — Planning
// ---------------------------------------------------------------------------

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Gherkin {
  given: string;
  when: string;
  then: string;
}

export interface TestCase {
  id: string;
  featureId: string;
  title: string;
  priority: Priority;
  gherkin: Gherkin;
  targetRoute: string;
}

// ---------------------------------------------------------------------------
// Stage 3 — Codegen
// ---------------------------------------------------------------------------

/** A single Playwright statement plus how Argus arrived at it. */
export interface GeneratedStep {
  /** The Gherkin clause this step was derived from. */
  source: string;
  /** Emitted TypeScript, already indented for a test body. */
  code: string;
  /** `template` = deterministic pattern match. `llm` = model fallback. */
  origin: 'template' | 'llm';
  /** Which template rule matched, for debuggability. */
  rule?: string;
}

export interface GeneratedTestFile {
  testCaseId: string;
  fileName: string;
  filePath: string;
  contents: string;
  steps: GeneratedStep[];
  /** True when at least one step needed the LLM fallback. */
  usedLlmFallback: boolean;
}

// ---------------------------------------------------------------------------
// Stage 4 — Execution
// ---------------------------------------------------------------------------

export interface RunFailure {
  testCaseId: string;
  errorMessage: string;
  screenshotPath?: string;
  tracePath?: string;
  /** Trimmed DOM at failure time, when the reporter could capture it. */
  domSnapshot?: string;
}

export interface RunSummary {
  runId: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  failures: RunFailure[];
  /** Wall-clock duration of the Playwright run, in milliseconds. */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Stage 5 — Triage
// ---------------------------------------------------------------------------

export const TRIAGE_VERDICTS = [
  'real_bug',
  'flaky',
  'selector_drift',
  'environment_issue',
] as const;
export type TriageVerdict = (typeof TRIAGE_VERDICTS)[number];

export interface TriageResult {
  testCaseId: string;
  verdict: TriageVerdict;
  /** 0-1. */
  confidence: number;
  reasoning: string;
  /** Populated only for `selector_drift`. Never auto-applied. */
  suggestedFix?: string;
}

export interface TriageLogEntry extends TriageResult {
  runId: string;
  testTitle: string;
  errorMessage: string;
  triagedAt: string;
  /** `mock` when served from fixtures rather than a live model call. */
  source: 'live' | 'mock';
}

// ---------------------------------------------------------------------------
// Stage 6 — Bug filing
// ---------------------------------------------------------------------------

export type Severity = Priority;

/**
 * Fingerprint of a filed bug, used for cross-run dedupe. Capturing the
 * fields that distinguish real defects beyond the (sometimes auto-generated)
 * title lets the signature avoid both false-collisions and false-misses.
 */
export interface BugSignature {
  title: string;
  featureId: string;
  /** The Playwright error, normalised to its message-class. */
  errorClass: string;
  /** The triage verdict that led to this bug being filed. */
  verdict: TriageVerdict;
}

export interface FiledBug {
  id: string;
  testCaseId: string;
  title: string;
  severity: Severity;
  environment: string;
  reproSteps: string[];
  /** Id of an existing bug this duplicates, when matched above threshold. */
  isDuplicateOf?: string;
  filedAt: string;
  /** Similarity score behind `isDuplicateOf`, for auditability. */
  duplicateScore?: number;
  runId: string;
  /**
   * Fingerprint computed at filing time, so subsequent runs can score against
   * it without re-running triage. Omitted on legacy records.
   */
  signature?: BugSignature;
  /** GitHub issue created for this bug, if ARGUS_GITHUB_* is configured. */
  githubIssue?: { number: number; url: string };
}

/** A single row in the run history index. Written to data/runs/index.json. */
export interface RunIndexEntry {
  runId: string;
  timestamp: string;
  mode: 'live' | 'mock';
  target: string;
  provider: string;
  total: number;
  passed: number;
  failed: number;
  realBugs: number;
  flaky: number;
  selectorDrift: number;
  environmentIssues: number;
  newBugs: number;
  gateFailed: boolean;
  aiCalls: number;
}

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

export interface EnvironmentInfo {
  os: string;
  cpu: string;
  ramGB: number | string;
  browser: string;
  node: string;
}

/** Everything one `argus run` produced. Written to data/runs/<runId>/. */
export interface RunArtifact {
  runId: string;
  timestamp: string;
  mode: 'live' | 'mock';
  target: string;
  inventory: FeatureInventory;
  testCases: TestCase[];
  summary: RunSummary;
  triage: TriageResult[];
  filedBugs: FiledBug[];
  aiCalls: number;
  /** Which AI provider was used for this run. */
  provider: string;
}
