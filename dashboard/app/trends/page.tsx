import { loadDashboardData } from "@/lib/data";
import { TrendChart } from "@/components/TrendChart";
import { Card } from "@/components/ui";
import Link from "next/link";

export default function TrendsPage() {
  const data = loadDashboardData();

  if (!data.runIndex.length) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-muted">No runs to show trends for.</p>
      </main>
    );
  }

  const totalRealBugs = data.runIndex.reduce((sum, r) => sum + (r.realBugs || 0), 0);
  const totalFlaky = data.runIndex.reduce((sum, r) => sum + (r.flaky || 0), 0);
  const totalDrift = data.runIndex.reduce((sum, r) => sum + (r.selectorDrift || 0), 0);
  const totalEnv = data.runIndex.reduce((sum, r) => sum + (r.environmentIssue || 0), 0);

  const verdictData = [
    { name: "Real bugs", value: totalRealBugs, color: "#ff6b6b" },
    { name: "Flaky", value: totalFlaky, color: "#ffc857" },
    { name: "Selector drift", value: totalDrift, color: "#7c8cff" },
    { name: "Environment", value: totalEnv, color: "#8891a5" },
  ].filter((d) => d.value > 0);

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <Link href="/" className="text-access text-sm hover:underline mb-4 inline-block">← Back to dashboard</Link>
      <h1 className="text-2xl font-bold mb-6">Trends</h1>

      <TrendChart runs={data.runIndex} />

      <Card title="Verdict distribution across all runs" hint="Cumulative triage outcomes.">
        <div className="h-[260px]">
          {verdictData.length === 0 ? (
            <p className="text-muted text-sm">No triage data across runs.</p>
          ) : (
            <div className="space-y-3">
              {verdictData.map((v) => (
                <div key={v.name} className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: v.color }} />
                  <span className="w-24 text-sm text-muted">{v.name}</span>
                  <span className="font-bold text-text">{v.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </main>
  );
}
