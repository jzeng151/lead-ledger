"use client";

import { useEffect, useState } from "react";
import type { IcpConfig } from "@/lib/icp";

// The scoring knobs the editor exposes. Each maps a label to a getter/setter
// over the working IcpConfig draft. Other ICP fields (industries, titles, ...)
// are intentionally not editable here; this page is just the scoring dials.
type Knob = {
  label: string;
  hint?: string;
  step: number;
  get: (c: IcpConfig) => number;
  set: (c: IcpConfig, v: number) => IcpConfig;
};

const KNOBS: Knob[] = [
  {
    label: "Weight - firmographic",
    step: 0.05,
    get: (c) => c.weights.firmographic,
    set: (c, v) => ({ ...c, weights: { ...c.weights, firmographic: v } }),
  },
  {
    label: "Weight - role",
    step: 0.05,
    get: (c) => c.weights.role,
    set: (c, v) => ({ ...c, weights: { ...c.weights, role: v } }),
  },
  {
    label: "Weight - technographic",
    step: 0.05,
    get: (c) => c.weights.technographic,
    set: (c, v) => ({ ...c, weights: { ...c.weights, technographic: v } }),
  },
  {
    label: "Blend - fit",
    step: 0.05,
    get: (c) => c.blend.fit,
    set: (c, v) => ({ ...c, blend: { ...c.blend, fit: v } }),
  },
  {
    label: "Blend - engagement",
    step: 0.05,
    get: (c) => c.blend.engagement,
    set: (c, v) => ({ ...c, blend: { ...c.blend, engagement: v } }),
  },
  {
    label: "Review band - min",
    hint: "Priority at or above this and below max is flagged for review.",
    step: 1,
    get: (c) => c.reviewBand[0],
    set: (c, v) => ({ ...c, reviewBand: [v, c.reviewBand[1]] }),
  },
  {
    label: "Review band - max",
    step: 1,
    get: (c) => c.reviewBand[1],
    set: (c, v) => ({ ...c, reviewBand: [c.reviewBand[0], v] }),
  },
  {
    label: "Engagement decay / month",
    step: 0.05,
    get: (c) => c.engagementDecayPerMonth,
    set: (c, v) => ({ ...c, engagementDecayPerMonth: v }),
  },
];

export function IcpEditor() {
  const [config, setConfig] = useState<IcpConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/icp")
      .then((r) => r.json())
      .then((c: IcpConfig) => setConfig(c));
  }, []);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/icp", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      setConfig((await res.json()) as IcpConfig);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <p className="text-sm text-zinc-500">Loading settings...</p>;
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {KNOBS.map((knob) => (
          <label key={knob.label} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{knob.label}</span>
            <input
              type="number"
              step={knob.step}
              value={knob.get(config)}
              onChange={(e) => {
                const v = e.target.value === "" ? 0 : Number(e.target.value);
                if (Number.isNaN(v)) return;
                setConfig((prev) => (prev ? knob.set(prev, v) : prev));
                setSaved(false);
              }}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            {knob.hint ? <span className="text-xs text-zinc-500">{knob.hint}</span> : null}
          </label>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {saved ? <span className="text-sm text-green-600 dark:text-green-400">Saved</span> : null}
      </div>
    </div>
  );
}
