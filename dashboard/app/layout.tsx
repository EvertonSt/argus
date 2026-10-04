import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Argus - QA Dashboard',
  description: 'Autonomous AI QA agent - test planning, execution, triage, and bug filing.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-text min-h-screen">
        <Topbar />
        {children}
      </body>
    </html>
  );
}

function Topbar() {
  return (
    <header className="border-b border-line bg-panel/50">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent shadow-lg shadow-accent/30" />
          <div>
            <h1 className="font-semibold text-white">Argus Dashboard</h1>
            <p className="text-xs text-muted">Autonomous AI QA agent</p>
          </div>
        </div>
      </div>
    </header>
  );
}
