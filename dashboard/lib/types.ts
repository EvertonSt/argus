// Mirror the CLI's types for the dashboard to consume JSON data.
// These are structurally compatible with src/shared/types.ts but kept
// separate so the dashboard is a standalone Next.js project.

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Priority = Severity;
export type TriageVerdict = 'real_bug' | 'flaky' | 'selector_drift' | 'environment_issue';

export interface Feature {
  id: string;
  name: string;
  description: string;
  routes: string[];
  keySelectors?: string[];
}

export interface FeatureInventory {
  source: 'crawl' | 'specs' | 'both';
  features: Feature[];
}

export interface Gherkin { given: string; when: string; then: string; }

export interface TestCase {
  id: string;
  featureId: string;
  title: string;
  priority: Priority;
  gherkin: Gherkin;
  targetRoute: string;
}

export interface RunFailure {
  testCaseId: string;
  errorMessage: string;
  screenshotPath?: string;
  tracePath?: string;
  domSnapshot?: string;
}

export interface RunSummary {
  runId: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  failures: RunFailure[];
  durationMs?: number;
}

export interface TriageResult {
  testCaseId: string;
  verdict: TriageVerdict;
  confidence: number;
  reasoning: string;
  suggestedFix?: string;
}

export interface BugSignature {
  title: string;
  featureId: string;
  errorClass: string;
  verdict: TriageVerdict;
}

export interface FiledBug {
  id: string;
  testCaseId: string;
  title: string;
  severity: Severity;
  environment: string;
  reproSteps: string[];
  isDuplicateOf?: string;
  filedAt: string;
  duplicateScore?: number;
  runId: string;
  signature?: BugSignature;
}

export interface RunArtifact {
  runId: string;
  timestamp: string;
  mode: 'live' | 'mock';
  target: string;
  provider: string;
  inventory: FeatureInventory;
  testCases: TestCase[];
  summary: RunSummary;
  triage: TriageResult[];
  filedBugs: FiledBug[];
  aiCalls: number;
  gateFailed?: boolean;
  gateReason?: string;
}

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
  environmentIssue: number;
  gateFailed: boolean;
  aiCalls: number;
}
