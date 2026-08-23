"use client";
import type { ReactNode } from 'react';
import type { Severity, TriageVerdict } from '@/lib/types';

export function SeverityBadge({ severity }: { severity: Severity }) {
  const styles: Record<Severity, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${styles[severity]}`}>
      {severity}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: TriageVerdict }) {
  const labels: Record<TriageVerdict, string> = {
    real_bug: 'Real bug',
    flaky: 'Flaky',
    selector_drift: 'Selector drift',
    environment_issue: 'Environment',
  };
  const styles: Record<TriageVerdict, string> = {
    real_bug: 'bg-red-500/20 text-red-400 border-red-500/30',
    flaky: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    selector_drift: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    environment_issue: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${styles[verdict]}`}>
      {labels[verdict]}
    </span>
  );
}

export function Card({ title, hint, children, className }: {
  title?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-panel border border-line rounded-xl p-6 mb-6 ${className ?? ''}`}>
      {title && <h2 className="text-lg font-semibold mb-1 text-text">{title}</h2>}
      {hint && <p className="text-sm text-muted mb-4">{hint}</p>}
      {children}
    </div>
  );
}

export function FormatDate({ iso }: { iso: string }) {
  if (!iso) return <>-</>;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return <>{iso}</>;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}
