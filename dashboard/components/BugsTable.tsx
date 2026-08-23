"use client";
import type { FiledBug } from "@/lib/types";
import { Card, FormatDate, SeverityBadge } from "./ui";

export function BugsTable({ bugs }: { bugs: FiledBug[] }) {
  if (!bugs?.length) {
    return <Card title="Filed bugs"><p className="text-muted text-sm">No bugs filed yet.</p></Card>;
  }
  return (
    <Card title="Filed bugs" hint="Only failures triaged as real_bug are filed. Duplicates are flagged, never silently dropped.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-line">
              <th className="pb-3">Severity</th>
              <th className="pb-3">Title</th>
              <th className="pb-3">Test case</th>
              <th className="pb-3">Filed</th>
              <th className="pb-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {bugs.map((bug) => (
              <tr key={bug.id} className="border-b border-line/50">
                <td className="py-3"><SeverityBadge severity={bug.severity} /></td>
                <td className="py-3 text-text">{bug.title}</td>
                <td className="py-3 text-muted">{bug.testCaseId}</td>
                <td className="py-3 text-muted"><FormatDate iso={bug.filedAt} /></td>
                <td className="py-3">
                  {bug.isDuplicateOf ? (
                    <span className="text-xs text-muted">
                      Duplicate of {bug.isDuplicateOf} ({bug.duplicateScore})
                    </span>
                  ) : (
                    <SeverityBadge severity={bug.severity} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
