// src/components/HeliocentricOrbits.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ApproachRow = {
  id: string;
  neo_reference_id: string;
  name: string;
  hm: number;
  dia_km?: number;
  hazardous: boolean;
  approach: {
    epoch: number; // ms since epoch
    date: string;
    miss_km: number;
    miss_au: number;
    vel_kps: number;
  };
  orbital_data?: {
    eccentricity?: string;
    semi_major_axis?: string; // AU
    inclination?: string; // deg (ignored in 2D sketch)
    ascending_node_longitude?: string; // deg (ignored in 2D sketch)
    perihelion_argument?: string; // deg (ignored in 2D sketch)
    epoch_osculation?: string; // JD
    mean_anomaly?: string; // deg
    mean_motion?: string; // deg/day
    orbit_class?: any;
  };
};

type Props = {
  neos: ApproachRow[] | unknown;
  selectedId?: string;
  onSelect?: (id: string) => void;
};

// ----------------- math helpers -----------------
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const DEG2RAD = Math.PI / 180;
const JD_UNIX_EPOCH = 2440587.5; // 1970-01-01

// Allow a wider zoom span but bias to tighter view
const ZOOM_MIN = 20;
const ZOOM_MAX = 1600;
const ZOOM_STEP = 1.2;

const msToJD = (ms: number) => JD_UNIX_EPOCH + ms / 86_400_000;
const wrapDeg = (d: number) => {
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
};

function aphelionAU(od?: ApproachRow["orbital_data"]) {
  if (!od) return 1;
  const a = Number(od.semi_major_axis);
  const e = Number(od.eccentricity);
  if (!isFinite(a) || !isFinite(e)) return 1;
  return a * (1 + e);
}

function percentile(sortedVals: number[], p: number) {
  if (!sortedVals.length) return 1;
  const idx = clamp((sortedVals.length - 1) * p, 0, sortedVals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const t = idx - lo;
  return sortedVals[lo] * (1 - t) + sortedVals[hi] * t;
}

// Solve Kepler: M = E - e*sin(E)
function eccentricAnomalyFromMean(Mrad: number, e: number) {
  let E = Mrad;
  for (let i = 0; i < 15; i++) {
    const f = E - e * Math.sin(E) - Mrad;
    const fp = 1 - e * Math.cos(E);
    const step = f / fp;
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return E;
}

// ----------------- component -----------------
export default function HeliocentricOrbits({
  neos,
  selectedId,
  onSelect,
}: Props) {
  const items = useMemo<ApproachRow[]>(
    () => (Array.isArray(neos) ? (neos as ApproachRow[]) : []),
    [neos]
  );

  // canvas sizing
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });

  // view state — start more zoomed in
  const [pxPerAU, setPxPerAU] = useState(220);
  const pxPerAURef = useRef(pxPerAU);
  useEffect(() => {
    pxPerAURef.current = pxPerAU;
  }, [pxPerAU]);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  // UI toggles
  const [showLabels, setShowLabels] = useState(false); // default: off (hover only)
  const [showEarthRing, setShowEarthRing] = useState(true);

  // hover + markers
  const [hover, setHover] = useState<{
    id: string;
    x: number;
    y: number;
    mx: number;
    my: number;
  } | null>(null);
  const markersRef = useRef<
    Array<{ id: string; x: number; y: number; r: number }>
  >([]);

  // -------------- resize observer --------------
  useEffect(() => {
    if (!hostRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize((prev) => {
        const w = Math.max(260, Math.floor(r.width));
        const h = Math.max(260, Math.floor(r.height));
        if (prev.w === w && prev.h === h) return prev;
        return { w, h };
      });
    });
    ro.observe(hostRef.current);
    return () => ro.disconnect();
  }, []);

  // -------------- compute "fit" scale --------------
  const fitToData = () => {
    const aps = items
      .map((it) => aphelionAU(it.orbital_data))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let maxAU = aps.length ? percentile(aps, 0.9) : 1;
    maxAU = clamp(maxAU, 1.2, 4.0);
    const margin = 0.88;
    const next = clamp(
      (margin * Math.min(size.w, size.h)) / (maxAU * 2),
      ZOOM_MIN,
      ZOOM_MAX
    );
    setOffset({ x: 0, y: 0 });
    setPxPerAU(next);
  };

  useEffect(() => {
    const aps = items
      .map((it) => aphelionAU(it.orbital_data))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let maxAU = aps.length ? percentile(aps, 0.9) : 1;
    maxAU = clamp(maxAU, 1.2, 4.0);
    const margin = 0.88;
    const next = clamp(
      (margin * Math.min(size.w, size.h)) / (maxAU * 2),
      ZOOM_MIN,
      ZOOM_MAX
    );
    if (Math.abs(next - pxPerAURef.current) > 1e-6) setPxPerAU(next);
  }, [items, size.w, size.h]);

  // -------------- interactions --------------
  // drag pan
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let dragging = false;
    let sx = 0,
      sy = 0;
    let baseX = 0,
      baseY = 0;

    const onDown = (e: MouseEvent) => {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      baseX = offsetRef.current.x;
      baseY = offsetRef.current.y;
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      setOffset({ x: baseX + dx, y: baseY + dy });
    };
    const onUp = () => {
      dragging = false;
    };

    c.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      c.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // mouse wheel zoom (about cursor)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const prev = pxPerAURef.current;
      const next = clamp(prev * factor, ZOOM_MIN, ZOOM_MAX);
      if (next === prev) return;

      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cx = c.width / 2 + offsetRef.current.x;
      const cy = c.height / 2 + offsetRef.current.y;

      const vx = mx - cx;
      const vy = my - cy;
      const ratio = next / prev;

      const nx = cx + vx - vx * ratio;
      const ny = cy + vy - vy * ratio;
      setOffset({ x: nx - c.width / 2, y: ny - c.height / 2 });
      setPxPerAU(next);

      e.preventDefault();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  // marker hover + click select
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const onMove = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let found: { id: string; x: number; y: number; r: number } | null = null;
      let bestD2 = Infinity;
      for (const m of markersRef.current) {
        const d2 = (mx - m.x) ** 2 + (my - m.y) ** 2;
        if (d2 <= (m.r + 6) ** 2 && d2 < bestD2) {
          bestD2 = d2;
          found = m;
        }
      }
      if (found) setHover({ id: found.id, x: found.x, y: found.y, mx, my });
      else if (hover) setHover(null);
    };
    const onLeave = () => setHover(null);

    const onClick = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let best: { id: string; d2: number } | null = null;
      for (const m of markersRef.current) {
        const d2 = (mx - m.x) ** 2 + (my - m.y) ** 2;
        const r2 = (m.r + 6) ** 2;
        if (d2 <= r2 && (!best || d2 < best.d2)) best = { id: m.id, d2 };
      }
      if (best?.id && onSelect) onSelect(best.id);
    };

    c.addEventListener("mousemove", onMove);
    c.addEventListener("mouseleave", onLeave);
    c.addEventListener("click", onClick);
    return () => {
      c.removeEventListener("mousemove", onMove);
      c.removeEventListener("mouseleave", onLeave);
      c.removeEventListener("click", onClick);
    };
  }, [hover, onSelect]);

  // -------------- draw --------------
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = size.w;
    c.height = size.h;

    const g = c.getContext("2d");
    if (!g) return;

    // pre-compute dia range (for relative marker sizes)
    const dVals = items
      .map((n) => Number(n.dia_km ?? 0.5))
      .filter((v) => isFinite(v) && v > 0);
    const dMin = dVals.length ? Math.min(...dVals) : 0.2;
    const dMax = dVals.length ? Math.max(...dVals) : 5;

    const diaToPx = (dKm: number) => {
      const sMin = Math.sqrt(Math.max(dMin, 0.05));
      const sMax = Math.sqrt(Math.max(dMax, 0.1));
      const s = Math.sqrt(Math.max(dKm, 0.05));
      const t = (s - sMin) / (sMax - sMin + 1e-6);
      return clamp(3 + 9 * t, 3, 12);
    };

    const cx = c.width / 2 + offset.x;
    const cy = c.height / 2 + offset.y;

    // background
    g.fillStyle = "#05070a";
    g.fillRect(0, 0, c.width, c.height);

    // Sun
    g.fillStyle = "#ffda44";
    g.beginPath();
    g.arc(cx, cy, 8, 0, Math.PI * 2);
    g.fill();
    if (true) {
      g.fillStyle = "#d0b000";
      g.font = "12px sans-serif";
      g.fillText("Sun", cx + 12, cy + 4);
    }

    // Earth ~1 AU
    if (showEarthRing) {
      g.strokeStyle = "rgba(120,165,255,0.6)";
      g.setLineDash([5, 5]);
      g.beginPath();
      g.arc(cx, cy, pxPerAU, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    // clear markers store
    markersRef.current = [];

    // Draw orbits then markers
    for (const n of items) {
      const od = n.orbital_data;
      if (!od) continue;
      const a = Number(od.semi_major_axis);
      const e = Number(od.eccentricity);
      if (!isFinite(a) || !isFinite(e) || a <= 0) continue;

      const ra = a * pxPerAU;
      const rb = ra * Math.sqrt(1 - e * e);
      const rp = a * (1 - e) * pxPerAU;
      const focus = ra - rp;

      g.save();
      g.translate(cx, cy);
      g.strokeStyle = n.hazardous ? "#ff6b6b" : "#4ade80";
      g.lineWidth = 1.4;
      const steps = 200;
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const E = (i / steps) * Math.PI * 2;
        const x = -focus + ra * Math.cos(E);
        const y = rb * Math.sin(E);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.restore();

      // Closest-approach marker
      const M0 = Number(od.mean_anomaly);
      const nDegPerDay = Number(od.mean_motion);
      const epochOscJD = Number(od.epoch_osculation);
      const approachEpoch = n?.approach?.epoch;

      if (
        isFinite(M0) &&
        isFinite(nDegPerDay) &&
        isFinite(epochOscJD) &&
        typeof approachEpoch === "number"
      ) {
        const approachJD = msToJD(approachEpoch);
        const dDays = approachJD - epochOscJD;
        const M_at_CA_deg = wrapDeg(M0 + nDegPerDay * dDays);
        const M = M_at_CA_deg * DEG2RAD;

        const E = eccentricAnomalyFromMean(M, clamp(e, 0, 0.99));
        const x_AU = a * (Math.cos(E) - e);
        const y_AU = a * Math.sqrt(1 - e * e) * Math.sin(E);

        const sx = cx + x_AU * pxPerAU;
        const sy = cy + y_AU * pxPerAU;

        const r = diaToPx(Number(n.dia_km ?? 0.5));

        // base dot
        g.fillStyle = "#ff46ff";
        g.beginPath();
        g.arc(sx, sy, r, 0, Math.PI * 2);
        g.fill();

        // highlight if selected
        if (selectedId && n.id === selectedId) {
          g.lineWidth = 2;
          g.strokeStyle = "#ffffff";
          g.stroke();
          // label always on if selected
          g.fillStyle = "white";
          g.font = "11px sans-serif";
          g.fillText(n.name, sx + 8, sy - 6);
        }

        // highlight if hovered
        if (hover?.id === n.id) {
          g.lineWidth = 2;
          g.strokeStyle = "white";
          g.stroke();
        }

        markersRef.current.push({ id: n.id, x: sx, y: sy, r });
      }
    }
  }, [
    items,
    pxPerAU,
    offset,
    size.w,
    size.h,
    showEarthRing,
    hover?.id,
    selectedId,
  ]);

  // toolbar actions
  const zoomIn = () =>
    setPxPerAU((s) => clamp(s * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX));
  const zoomOut = () =>
    setPxPerAU((s) => clamp(s / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX));
  const resetView = () => fitToData();
  const downloadPNG = () => {
    const c = canvasRef.current;
    if (!c) return;
    const url = c.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "heliocentric_orbits.png";
    a.click();
  };

  // tooltip content for hover
  const hoverNeo = hover ? items.find((n) => n.id === hover.id) : undefined;

  return (
    <div
      ref={hostRef}
      className="relative w-full h-[calc(100vh-140px)] md:h-[calc(100vh-130px)]"
    >
      {/* Toolbar */}
      <div className="pointer-events-auto absolute left-2 top-2 z-10 flex flex-col gap-2">
        <div className="rounded-lg bg-neutral-800/80 backdrop-blur ring-1 ring-white/10 p-2 shadow">
          <div className="grid grid-cols-3 gap-2">
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
              title="Home / Fit to data (0)"
              onClick={resetView}
            >
              Home
            </button>
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
              title="Zoom In (+)"
              onClick={zoomIn}
            >
              +
            </button>
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
              title="Zoom Out (-)"
              onClick={zoomOut}
            >
              −
            </button>
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm col-span-3"
              title="Reset Pan"
              onClick={() => setOffset({ x: 0, y: 0 })}
            >
              Reset Pan
            </button>
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
              title={showLabels ? "Hide static labels" : "Show static labels"}
              onClick={() => setShowLabels((v) => !v)}
            >
              Labels: {showLabels ? "On" : "Hover"}
            </button>
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
              title={showEarthRing ? "Hide 1 AU ring" : "Show 1 AU ring"}
              onClick={() => setShowEarthRing((v) => !v)}
            >
              1 AU: {showEarthRing ? "On" : "Off"}
            </button>
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
              title="Download PNG"
              onClick={downloadPNG}
            >
              PNG
            </button>
          </div>
          <div className="mt-2 text-[11px] text-white/70">
            Drag to pan • Wheel/± to zoom • 0 = Home • Magenta = closest
            approach
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {hover && hoverNeo && (
        <div
          className="pointer-events-none absolute z-20 rounded-md bg-neutral-900/90 ring-1 ring-white/10 p-2 text-xs shadow"
          style={{
            left: Math.min(Math.max(8, hover.mx + 12), size.w - 220),
            top: Math.max(8, hover.my + 12),
          }}
        >
          <div className="font-medium">{hoverNeo.name}</div>
          <div>Closest: {hoverNeo.approach.date}</div>
          <div>
            Miss: {(hoverNeo.approach.miss_km / 1000).toFixed(2)} Mm (
            {hoverNeo.approach.miss_au.toFixed(3)} AU)
          </div>
          <div>Speed: {hoverNeo.approach.vel_kps.toFixed(2)} km/s</div>
          {isFinite(Number(hoverNeo.dia_km)) && (
            <div>Diameter: {Number(hoverNeo.dia_km).toFixed(2)} km</div>
          )}
          <div className="mt-1">
            <span
              className={`inline-block px-2 py-[1px] rounded-full text-[10px] ${
                hoverNeo.hazardous ? "bg-rose-600" : "bg-emerald-600"
              }`}
            >
              {hoverNeo.hazardous ? "Hazard" : "Normal"}
            </span>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full block rounded-xl ring-1 ring-white/10 bg-black/40"
      />
    </div>
  );
}
