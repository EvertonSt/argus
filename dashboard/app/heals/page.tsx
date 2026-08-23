import { loadDashboardData } from "@/lib/data";
import { SelfHealList } from "@/components/SelfHealList";
import Link from "next/link";

export default function HealsPage() {
  const data = loadDashboardData();
  if (!data.latestRun) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-muted">No runs yet.</p>
      </main>
    );
  }
  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <Link href="/" className="text-access text-sm hover:underline mb-4 inline-block">← Back to dashboard</Link>
      <SelfHealList run={data.latestRun} />
    </main>
  );
}
