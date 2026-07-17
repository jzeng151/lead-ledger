import Link from "next/link";
import { IcpEditor } from "@/app/components/IcpEditor";

export default function IcpPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-fg"
      >
        <span aria-hidden>&larr;</span> Back to queue
      </Link>
      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Scoring settings</h1>
        <p className="mt-1.5 text-sm text-muted">Tune the ICP scoring dials. Changes apply to the next run.</p>
      </header>
      <IcpEditor />
    </div>
  );
}
