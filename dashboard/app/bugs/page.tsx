import { loadDashboardData } from "@/lib/data";
import { BugsTable } from "@/components/BugsTable";
import Link from "next/link";

export default function BugsPage() {
  const data = loadDashboardData();
  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <Link href="/" className="text-access text-sm hover:underline mb-4 inline-block">← Back to dashboard</Link>
      <BugsTable bugs={data.bugs} />
    </main>
  );
}
