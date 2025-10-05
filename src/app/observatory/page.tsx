// src/app/observatory/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import ObservatorySidebar from "@/components/ObservatorySidebar";
import HeliocentricOrbits, {
  type ApproachRow,
} from "@/components/HeliocentricOrbits";
import HeliocentricCesium3D from "@/components/HeliocentricCesium3D";

export default function ObservatoryPage() {
  const [data, setData] = useState<ApproachRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [view3D, setView3D] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/neos", { cache: "no-store" });
        const json = await res.json();
        if (!ok) return;
        setData(
          Array.isArray(json?.items) ? (json.items as ApproachRow[]) : []
        );
      } catch {
        if (!ok) return;
        setData([]);
      } finally {
        if (!ok) return;
        setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  const neos = useMemo<ApproachRow[]>(
    () => (Array.isArray(data) ? data : []),
    [data]
  );

  return (
    <main className="mx-auto max-w-[1400px] px-4 md:px-6 pb-6">
      <header className="flex items-center justify-between py-3">
        <h1 className="text-lg font-semibold">Observatory</h1>

        <div className="inline-flex gap-2 rounded-md overflow-hidden ring-1 ring-white/10">
          <button
            className={`px-3 py-1.5 text-sm ${
              !view3D
                ? "bg-emerald-600 text-white"
                : "bg-neutral-800/70 text-white/85 hover:bg-neutral-700"
            }`}
            onClick={() => setView3D(false)}
          >
            2D
          </button>
          <button
            className={`px-3 py-1.5 text-sm ${
              view3D
                ? "bg-emerald-600 text-white"
                : "bg-neutral-800/70 text-white/85 hover:bg-neutral-700"
            }`}
            onClick={() => setView3D(true)}
          >
            3D
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        {/* Sidebar */}
        <div className="rounded-xl bg-neutral-900 ring-1 ring-white/10 overflow-hidden">
          <ObservatorySidebar
            neos={neos}
            loading={loading}
            selectedId={selectedId ?? undefined}
            onSelect={(id) => setSelectedId(id)}
          />
        </div>

        {/* Canvas / Cesium */}
        <section className="rounded-xl bg-neutral-900 ring-1 ring-white/10 overflow-hidden">
          {view3D ? (
            <HeliocentricCesium3D
              neos={neos}
              selectedId={selectedId ?? undefined}
            />
          ) : (
            <HeliocentricOrbits
              neos={neos}
              selectedId={selectedId ?? undefined}
              onSelect={setSelectedId}
            />
          )}
        </section>
      </section>
    </main>
  );
}
