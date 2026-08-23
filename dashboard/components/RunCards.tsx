"use client";
import { Card } from "./ui";
import type { RunArtifact } from "@/lib/types";
import { computeCoverage } from "@/lib/utils";

export function RunCards({ run, bugs }: { run: RunArtifact; bugs: any[] }) {
  const s = run.summary || { total: 0, passed: 0, failed: 0 };
  const realBugs = (run.triage || []).filter((t: any) => t.verdict === "real_bug").length;
  const openBugs = bugs.filter((b: any) => !b.isDuplicateOf).length;
  const passRate = s.total ? Math.round((s.passed / s.total) * 100) : 0;
  const cov = computeCoverage(run);

  const cards = [
    { label: "Pass rate", value: `${passRate}%`, cls: passRate >= 80 ? "text-ok" : passRate >= 50 ? "text-warn" : "text-danger" },
    { label: "Real bugs", value: String(realBugs), cls: "text-danger" },
    { label: "Open bugs", value: String(openBugs), cls: "text-warn" },
    { label: "AI calls", value: String(run.aiCalls), cls: "text-accent" },
    { label: "Features covered", value: `${cov.covered}/${cov.total}`, cls: "text-accent" },
    { label: "Test cases", value: String(cov.totalTests), cls: "text-muted" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-8">
      {cards.map((c) => (
        <div key={c.label} className="bg-panel border border-line rounded-xl p-4 text-center">
          <div className="text-xs uppercase tracking-wider text-muted mb-1">{c.label}</div>
          <div className={`text-2xl font-bold ${c.cls}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
