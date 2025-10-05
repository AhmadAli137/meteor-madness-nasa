// src/components/ObservatorySidebar.tsx
"use client";

import { useMemo, useState } from "react";
import type { ApproachRow } from "./HeliocentricOrbits";

export default function ObservatorySidebar({
  neos,
  loading,
  selectedId,
  onSelect,
}: {
  neos: ApproachRow[];
  loading?: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const base = Array.isArray(neos) ? neos : [];
    const filtered = q.trim()
      ? base.filter(
          (n) =>
            n.name.toLowerCase().includes(q.toLowerCase()) ||
            n.neo_reference_id.toLowerCase().includes(q.toLowerCase())
        )
      : base;

    return filtered.slice(0, 500); // keep panel snappy
  }, [neos, q]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/10">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search NEO name or ID…"
          className="w-full px-3 py-2 rounded bg-neutral-800/70 ring-1 ring-white/10 text-sm"
        />
        <div className="mt-1 text-[11px] text-white/60">
          {loading ? "Loading…" : `${list.length} shown`}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {list.map((n) => {
          const active = n.id === selectedId;
          return (
            <button
              key={n.id}
              className={`w-full text-left px-3 py-2 border-b border-white/5 hover:bg-neutral-800/50 ${
                active ? "bg-emerald-700/40" : ""
              }`}
              onClick={() => onSelect(n.id)}
              title="Center in view"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{n.name}</div>
                <span
                  className={`text-[10px] px-2 py-[1px] rounded-full ${
                    n.hazardous ? "bg-rose-600" : "bg-emerald-700"
                  }`}
                >
                  {n.hazardous ? "Hazard" : "Normal"}
                </span>
              </div>
              <div className="text-[11px] text-white/70">
                {n.approach?.date ?? "—"} • miss{" "}
                {n.approach
                  ? `${(n.approach.miss_km / 1000).toFixed(2)} Mm`
                  : "—"}
              </div>
              {Number.isFinite(n.dia_km) && (
                <div className="text-[11px] text-white/60">
                  Diameter ~ {n.dia_km} km
                </div>
              )}
            </button>
          );
        })}
        {!loading && list.length === 0 && (
          <div className="p-3 text-sm text-white/70">No objects match.</div>
        )}
      </div>
    </div>
  );
}
