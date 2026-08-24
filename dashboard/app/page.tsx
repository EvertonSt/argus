import { loadDashboardData } from "@/lib/data";
import { RunCards } from "@/components/RunCards";
import { TrendChart } from "@/components/TrendChart";
import { TriageChart } from "@/components/TriageChart";
import { BugsTable } from "@/components/BugsTable";
import { SelfHealList } from "@/components/SelfHealList";
import { CoverageGap } from "@/components/CoverageGap";
import { Card, FormatDate } from "@/components/ui";
import Link from "next/link";

export default function DashboardHome() {
  const data = loadDashboardData();

  if (!data.latestRun) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Demonstration Run Banner */}
      <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-center text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
        Demonstration run · Synthetic test data
      </div>
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold mb-3">No runs yet</h2>
          <p className="text-muted mb-4">Run the pipeline to populate this dashboard. No API key is required:</p>
          <pre className="text-sm bg-panel border border-line rounded p-3 inline-block"><code>npm run run:mock</code></pre>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Demonstration Run Banner */}
      <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-center text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
        Demonstration run · Synthetic test data
      </div>
      <RunCards run={data.latestRun} bugs={data.bugs} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <TrendChart runs={data.runIndex} />
        </div>
        <div>
          <TriageChart triage={data.latestRun.triage || []} />
        </div>
      </div>

      <CoverageGap run={data.latestRun} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <BugsTable bugs={data.bugs} />
        <SelfHealList run={data.latestRun} />
      </div>

      <RunHistory runs={data.runIndex} />
    </main>
  );
}

function RunHistory({ runs }: { runs: any[] }) {
  if (!runs?.length) return null;
  return (
    <Card title="Recent runs" hint="Most recent first. Click for details.">
      <div className="space-y-2">
        {runs.slice().reverse().map((run) => (
          <Link
            key={run.runId}
            href={"/runs/" + run.runId}
            className="block p-3 bg-panel-2 rounded-lg border border-line/40 hover:border-line transition-colors"
          >
            <div className="flex justify-between items-center">
              <span className="font-medium text-sm text-text">{run.runId}</span>
              <span className="text-xs text-muted">
                <FormatDate iso={run.timestamp} />
              </span>
            </div>
            <div className="flex gap-4 mt-1 text-xs text-muted">
              <span>{run.passed} passed - {run.failed} failed</span>
              <span>Provider: {run.provider || "claude"}</span>
              <span className={run.gateFailed ? "text-danger" : "text-ok"}>
                Gate: {run.gateFailed ? "FAIL" : "PASS"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
