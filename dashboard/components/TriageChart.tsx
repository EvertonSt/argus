"use client";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import type { TriageResult } from "@/lib/types";
import { Card } from "./ui";

const COLORS: Record<string, string> = {
  real_bug: "#ff6b6b",
  flaky: "#ffc857",
  selector_drift: "#7c8cff",
  environment_issue: "#8891a5",
};

export function TriageChart({ triage }: { triage: TriageResult[] }) {
  const counts: Record<string, number> = {};
  (triage || []).forEach((t) => {
    counts[t.verdict] = (counts[t.verdict] || 0) + 1;
  });
  const data = Object.entries(counts).map(([name, value]) => ({
    name,
    value,
    color: COLORS[name] || "#8891a5",
  }));

  if (data.length === 0) {
    return <Card title="Triage breakdown"><p className="text-muted text-sm">No failures triaged.</p></Card>;
  }

  return (
    <Card title="Triage breakdown" hint="Why the latest run's tests failed.">
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
              {data.map((entry, i) => <Cell key={`cell-${i}`} fill={entry.color} />)}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: "#1a1f2b", border: "1px solid #242a38" }} />
            <Legend layout="horizontal" verticalAlign="bottom" height={36} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
