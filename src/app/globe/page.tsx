"use client";

import { useEffect, useMemo, useState } from "react";
import GlobeCesium, { type ImpactOverlay } from "@/components/GlobeCesium";
import Link from "next/link";

function toNum(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}
function niceInt(n: number | undefined) {
  if (!Number.isFinite(n as number)) return "—";
  return (n as number).toLocaleString();
}
function megaTonsFromKE(massKg?: number, velKps?: number) {
  if (!Number.isFinite(massKg!) || !Number.isFinite(velKps!)) return undefined;
  const v = (velKps as number) * 1000;
  const joules = 0.5 * (massKg as number) * v * v;
  return joules / 4.184e15; // J → MT
}

export default function ImpactGlobePage() {
  // Gate rendering to avoid hydration mismatch warnings
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [impact, setImpact] = useState<ImpactOverlay | null>(null);

  // Load from session + listen for event from Impactor Lab
  useEffect(() => {
    if (!mounted) return;
    try {
      const raw = sessionStorage.getItem("mm-impact-detail");
      if (raw) setImpact(JSON.parse(raw));
    } catch {}
    const onOpen = (e: any) => {
      if (e?.detail) {
        setImpact(e.detail as ImpactOverlay);
        try {
          sessionStorage.setItem("mm-impact-detail", JSON.stringify(e.detail));
        } catch {}
      }
    };
    window.addEventListener("mm-open-globe-impact", onOpen as any);
    return () => window.removeEventListener("mm-open-globe-impact", onOpen as any);
  }, [mounted]);

  const energyMT = useMemo(
    () => megaTonsFromKE(toNum(impact?.massKg), toNum(impact?.velKps)),
    [impact?.massKg, impact?.velKps]
  );
  const effects = useMemo(() => {
    const ck = toNum(impact?.craterKm) ?? 0;
    const severeBlastKm = Math.round(ck * 50);
    const popAffected = Math.max(0, Math.round(ck * 490_000));
    return { severeBlastKm, popAffected };
  }, [impact?.craterKm]);

  if (!mounted) {
    // simple stable shell for SSR
    return <main className="mx-auto max-w-[1400px] px-4 md:px-6 pb-6" />;
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 md:px-6 pb-6">
      <header className="py-3">
        <h1 className="text-lg font-semibold">Impact Site — 3D Globe</h1>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="rounded-xl bg-neutral-900 ring-1 ring-white/10 overflow-hidden">
          <GlobeCesium impact={impact ?? undefined} />
        </div>

        <aside className="rounded-xl bg-neutral-900 ring-1 ring-white/10 overflow-hidden">
          <div className="p-3 border-b border-white/10">
            <div className="text-sm text-white/70">
              Location:&nbsp;
              <span className="font-mono">
                {impact ? `${impact.lat?.toFixed?.(1)}°, ${impact.lon?.toFixed?.(1)}°` : "—"}
              </span>
            </div>
            <div className="text-sm text-white/70">
              ETA (UTC): <span className="font-mono">{impact?.etaISO ?? "—"}</span>
            </div>
          </div>

          <div className="p-3 space-y-3">
            <div className="rounded-lg bg-neutral-800/60 ring-1 ring-white/10 p-3">
              <div className="text-xs text-white/60">Diameter</div>
              <div className="text-lg font-semibold">
                {impact?.diameterKm ? `${impact.diameterKm.toLocaleString()} km` : "—"}
              </div>
            </div>

            <div className="rounded-lg bg-neutral-800/60 ring-1 ring-white/10 p-3">
              <div className="text-xs text-white/60">Speed</div>
              <div className="text-lg font-semibold">
                {impact?.velKps ? `${impact.velKps.toFixed(0)} km/s` : "—"}
              </div>
            </div>

            <div className="rounded-lg bg-neutral-800/60 ring-1 ring-white/10 p-3">
              <div className="text-xs text-white/60">Mass (used for energy)</div>
              <div className="text-lg font-semibold">
                {impact?.massKg ? `${impact.massKg.toExponential(2)} kg` : "—"}
              </div>
              <div className="text-[11px] text-white/60">Provided by simulator.</div>
            </div>

            <div className="rounded-lg bg-neutral-800/60 ring-1 ring-white/10 p-3">
              <div className="text-xs text-white/60">Energy</div>
              <div className="text-lg font-semibold">
                {energyMT ? `${Math.round(energyMT).toLocaleString()} MT` : "—"}
              </div>
            </div>

            <div className="rounded-lg bg-neutral-800/60 ring-
