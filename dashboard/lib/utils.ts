// Pure data utilities for the dashboard — no Node.js imports.

import type { RunArtifact, TriageResult, FiledBug, RunIndexEntry } from "./types";

/** Derive coverage metrics from a run artifact. */
export function computeCoverage(run: RunArtifact | null): {
  total: number;
  covered: number;
  uncovered: string[];
  totalTests: number;
} {
  if (!run || !run.inventory?.features) {
    return { total: 0, covered: 0, uncovered: [], totalTests: 0 };
  }
  const features = run.inventory.features;
  const testedFeatureIds = new Set(
    run.testCases?.map((tc) => tc.featureId) ?? []
  );
  const uncovered = features
    .filter((f) => !testedFeatureIds.has(f.id))
    .map((f) => f.name);
  return {
    total: features.length,
    covered: testedFeatureIds.size,
    uncovered,
    totalTests: run.testCases?.length ?? 0,
  };
}

/** Format an ISO timestamp for display. */
export function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
