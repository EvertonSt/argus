"use client";
import type { RunArtifact } from "@/lib/types";
import { Card } from "./ui";

export function SelfHealList({ run }: { run: RunArtifact }) {
  const drift = (run.triage || []).filter((t) => t.verdict === "selector_drift" && t.suggestedFix);
  if (!drift.length) {
    return (
      <Card title="Self-heal suggestions" hint="Selector-drift fixes proposed by triage. Never auto-applied.">
        <p className="text-muted text-sm">No selector drift detected in the latest run.</p>
      </Card>
    );
  }
  return (
    <Card title="Self-heal suggestions" hint="Selector-drift fixes proposed by triage. Never auto-applied - a human approves every change.">
      <div className="space-y-4">
        {drift.map((t) => (
          <div key={t.testCaseId} className="border border-line/50 rounded-lg p-4">
            <div className="font-medium text-text mb-2">{t.testCaseId}</div>
            <pre className="text-xs text-muted bg-panel-2 rounded p-3 overflow-x-auto">
              {t.suggestedFix}
            </pre>
            <div className="text-xs text-muted mt-2">Confidence: {Math.round(t.confidence * 100)}%</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
