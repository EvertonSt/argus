import { loadDashboardData } from "@/lib/data";
import { Card, FormatDate } from "@/components/ui";
import { TriageChart } from "@/components/TriageChart";
import Link from "next/link";
import type { RunArtifact } from "@/lib/types";

export async function generateStaticParams() {
  const data = loadDashboardData();
  const params: { id: string }[] = [];
  if (data.latestRun) params.push({ id: data.latestRun.runId }, { id: "latest" });
  else params.push({ id: "latest" });
  if (data.runIndex.length) {
    for (const r of data.runIndex) {
      if (!params.find((p) => p.id === r.runId)) {
        params.push({ id: r.runId });
      }
    }
  }
  return params;
}

function findRun(latest: RunArtifact | null, index: any[], id: string): RunArtifact | null {
  if (latest && latest.runId === id) return latest;
  return latest;
}

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = loadDashboardData();
  const run = findRun(data.latestRun, data.runIndex, id);

  if (!run) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Link href="/" className="text-access text-sm hover:underline mb-4 inline-block">&larr; Back to dashboard</Link>
        <p className="text-muted">Run not found.</p>
      </main>
    );
  }

  const summary = run.summary || { total: 0, passed: 0, failed: 0, failures: [] };
  const passRate = summary.total ? Math.round((summary.passed / summary.total) * 100) : 0;

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <Link href="/" className="text-access text-sm hover:underline mb-4 inline-block">&larr; Back to dashboard</Link>
      <h1 className="text-2xl font-bold mb-1">{run.runId}</h1>
      <p className="text-muted mb-6">
        {run.mode} mode &middot; Provider: {run.provider || "claude"} &middot; <FormatDate iso={run.timestamp} />
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        <Stat label="Pass rate" value={passRate + "%"} cls={passRate >= 80 ? "text-ok" : "text-danger"} />
        <Stat label="Total tests" value={summary.total} />
        <Stat label="Passed" value={summary.passed} cls="text-ok" />
        <Stat label="Failed" value={summary.failed} cls="text-danger" />
        <Stat label="AI calls" value={run.aiCalls} cls="text-accent" />
      </div>

      <TriageChart triage={run.triage || []} />

      {summary.failures && summary.failures.length > 0 && (
        <Card title="Failures" className="mt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-line">
                <th className="pb-2">Test case</th>
                <th className="pb-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {summary.failures.map((f) => (
                <tr key={f.testCaseId} className="border-b border-line/40">
                  <td className="py-2 font-mono text-sm text-text">{f.testCaseId}</td>
                  <td className="py-2 text-muted max-w-md truncate">{f.errorMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}

function Stat({ label, value, cls }: { label: string; value: string | number; cls?: string }) {
  return (
    <div className="bg-panel border border-line rounded-xl p-4 text-center">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-bold ${cls || "text-text"}`}>{value}</div>
    </div>
  );
}