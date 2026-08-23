import fs from 'node:fs';
import path from 'node:path';
import type { RunArtifact, RunIndexEntry, FiledBug, FeatureInventory, TestCase, TriageResult } from './types';

/** Root of the Argus repo, used to locate data/ at runtime. */
// The dashboard data dir (dashboard/data/). Falls back to repo root data/
// when the dashboard is run from within the main project.
const CWD = process.cwd();
export const ROOT = CWD;
const DASHBOARD_DATA = path.join(CWD, 'data');
const REPO_DATA = path.join(CWD, '..', 'data');
export const DATA_DIR = fs.existsSync(DASHBOARD_DATA) ? DASHBOARD_DATA : (fs.existsSync(REPO_DATA) ? REPO_DATA : DASHBOARD_DATA);
export const RUNS_DIR = path.join(DATA_DIR, 'runs');

interface LoadedState {
  runIndex: RunIndexEntry[];
  latestRun: RunArtifact | null;
  bugs: FiledBug[];
  inventory: FeatureInventory | null;
  testCases: TestCase[];
}

/**
 * Load all dashboard data from the JSON files the CLI writes. Designed to be
 * called at build time (SSG) and gracefully handle missing data.
 */
export function loadDashboardData(): LoadedState {
  const empty: LoadedState = {
    runIndex: [],
    latestRun: null,
    bugs: [],
    inventory: null,
    testCases: [],
  };

  try {
    const indexPath = path.join(RUNS_DIR, 'index.json');
    if (fs.existsSync(indexPath)) {
      empty.runIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as RunIndexEntry[];
    }

    if (empty.runIndex.length > 0) {
      const latestEntry = empty.runIndex[empty.runIndex.length - 1];
      const runPath = path.join(RUNS_DIR, latestEntry?.runId ?? '', 'run.json');
      if (fs.existsSync(runPath)) {
        empty.latestRun = JSON.parse(fs.readFileSync(runPath, 'utf-8')) as RunArtifact;
      }
    }

    const bugsPath = path.join(DATA_DIR, 'bugs.json');
    if (fs.existsSync(bugsPath)) {
      empty.bugs = JSON.parse(fs.readFileSync(bugsPath, 'utf-8')) as FiledBug[];
    }

    const invPath = path.join(DATA_DIR, 'inventory.json');
    if (fs.existsSync(invPath)) {
      empty.inventory = JSON.parse(fs.readFileSync(invPath, 'utf-8')) as FeatureInventory;
    }
    const tcPath = path.join(DATA_DIR, 'test-cases.json');
    if (fs.existsSync(tcPath)) {
      empty.testCases = JSON.parse(fs.readFileSync(tcPath, 'utf-8')) as TestCase[];
    }
  } catch (e) {
    console.warn('Dashboard data load error:', e);
  }

  return empty;
}

/** Derive coverage from the latest run. */
export function computeCoverage(latestRun: RunArtifact | null): {
  total: number;
  covered: number;
  uncovered: string[];
  totalTests: number;
} {
  if (!latestRun || !latestRun.inventory?.features) {
    return { total: 0, covered: 0, uncovered: [], totalTests: 0 };
  }
  const features = latestRun.inventory.features;
  const testedFeatureIds = new Set(latestRun.testCases?.map((tc) => tc.featureId) ?? []);
  const uncovered = features.filter((f) => !testedFeatureIds.has(f.id)).map((f) => f.name);
  return {
    total: features.length,
    covered: testedFeatureIds.size,
    uncovered,
    totalTests: latestRun.testCases?.length ?? 0,
  };
}
