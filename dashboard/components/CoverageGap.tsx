"use client";
import type { RunArtifact } from "@/lib/types";
import { Card } from "./ui";
import { computeCoverage } from "@/lib/utils";

export function CoverageGap({ run }: { run: RunArtifact }) {
  const cov = computeCoverage(run);
  if (cov.total === 0) return null;
  const pct = Math.round((cov.covered / cov.total) * 100);

  return (
    <Card title="Test coverage" hint="Features with at least one test case vs. total discovered.">
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-muted">Feature coverage</span>
          <span className="text-text font-medium">{cov.covered} / {cov.total} ({pct}%)</span>
        </div>
        <div className="w-full bg-line/30 rounded-full h-2">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {cov.uncovered.length > 0 ? (
        <ul className="text-sm space-y-1">
          {cov.uncovered.map((f) => (
            <li key={f} className="text-muted">Warning {f}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ok">All features are covered.</p>
      )}
    </Card>
  );
}
