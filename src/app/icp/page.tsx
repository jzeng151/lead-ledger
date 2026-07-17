import Link from "next/link";
import { IcpEditor } from "@/app/components/IcpEditor";

export default function IcpPage() {
  return (
    <div className="min-h-full bg-zinc-50 dark:bg-black">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          &larr; Back to queue
        </Link>
        <header className="mt-4 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Scoring settings</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Tune the ICP scoring dials. Changes apply to the next run.
          </p>
        </header>
        <IcpEditor />
      </div>
    </div>
  );
}
