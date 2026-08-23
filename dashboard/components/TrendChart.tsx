"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { RunIndexEntry } from "@/lib/types";
import { Card } from "./ui";

export function TrendChart({ runs }: { runs: RunIndexEntry[] }) {
  const data = runs.slice().reverse().map((r) => ({
    date: new Date(r.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    passed: r.passed,
    failed: r.failed,
    provider: r.provider ?? "unknown",
  }));

  return (
    <Card title="Pass / fail trend" hint="Recent runs, oldest first." className="md:col-span-2">
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#242a38" />
            <XAxis dataKey="date" tick={{ fill: "#8891a5", fontSize: 12 }} />
            <YAxis tick={{ fill: "#8891a5", fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: "#1a1f2b", border: "1px solid #242a38" }} />
            <Bar dataKey="passed" stackId="a" fill="#3ddc97" />
            <Bar dataKey="failed" stackId="a" fill="#ff6b6b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
