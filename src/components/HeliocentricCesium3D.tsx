// src/components/HeliocentricCesium3D.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ApproachRow } from "./HeliocentricOrbits";

type Props = { neos: ApproachRow[] | unknown; selectedId?: string };

const AU_TO_SCENE = 1_000_000;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const JD_UNIX_EPOCH = 2440587.5;
const DEG = Math.PI / 180;
const msToJD = (ms: number) => JD_UNIX_EPOCH + ms / 86_400_000;
const wrapDeg = (d: number) => {
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
};
function solveE(M: number, e: number) {
  let E = M;
  for (let i = 0; i < 15; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const step = f / fp;
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return E;
}
function aphelionAU(od?: ApproachRow["orbital_data"]) {
  if (!od) return 1;
  const a = Number(od.semi_major_axis);
  const e = Number(od.eccentricity);
  if (!isFinite(a) || !isFinite(e)) return 1;
  return a * (1 + e);
}
function ellipsePositionsAU(
  a: number,
  e: number,
  steps = 360,
  Cesium: any
): any[] {
  const { Cartesian3 } = Cesium;
  const b = a * Math.sqrt(1 - e * e);
  const pts: any[] = [];
  for (let i = 0; i <= steps; i++) {
    const E = (i / steps) * 2 * Math.PI;
    const xAU = a * (Math.cos(E) - e);
    const yAU = b * Math.sin(E);
    pts.push(new Cartesian3(xAU * AU_TO_SCENE, yAU * AU_TO_SCENE, 0));
  }
  return pts;
}

export default function HeliocentricCesium3D({ neos, selectedId }: Props) {
  const items = useMemo<ApproachRow[]>(
    () => (Array.isArray(neos) ? (neos as ApproachRow[]) : []),
    [neos]
  );
  const holderRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  // Build scene / (re)draw
  useEffect(() => {
    let mounted = true;
    (async () => {
      const Cesium = await import("cesium");
      (window as any).CESIUM_BASE_URL = "/cesium";
      const {
        Viewer,
        Cartesian3,
        Color,
        Cartesian2,
        DistanceDisplayCondition,
        LabelStyle,
        BoundingSphere,
      } = Cesium;

      if (!mounted || !holderRef.current) return;
      holderRef.current.replaceChildren();

      const creditDiv = document.createElement("div");
      creditDiv.style.display = "none";
      const viewer = new Viewer(holderRef.current, {
        animation: false,
        timeline: false,
        homeButton: true,
        sceneModePicker: true,
        baseLayerPicker: false,
        navigationHelpButton: true,
        fullscreenButton: false,
        geocoder: false,
        creditContainer: creditDiv,
      } as any);

      viewer.scene.globe.show = false;
      (viewer.scene as any).skyAtmosphere = undefined;
      (viewer.scene as any).skyBox = undefined;
      viewer.scene.backgroundColor = Color.fromCssColorString("#0b0f19");
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display =
        "none";

      // Sun + 1 AU ring
      viewer.entities.add({
        name: "Sun",
        position: Cartesian3.ZERO,
        ellipsoid: {
          radii: new Cartesian3(1.2e5, 1.2e5, 1.2e5),
          material: Color.fromCssColorString("#ffdd66"),
        } as any,
        label: {
          text: "Sun",
          font: "13px sans-serif",
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          pixelOffset: new Cartesian2(0, -22),
          showBackground: true,
          backgroundColor: Color.fromAlpha(Color.BLACK, 0.55),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new DistanceDisplayCondition(
            0,
            Number.POSITIVE_INFINITY
          ),
        },
      });

      const ring: any[] = [];
      for (let k = 0; k <= 360; k++) {
        const a = (k / 360) * 2 * Math.PI;
        ring.push(
          new Cartesian3(
            Math.cos(a) * AU_TO_SCENE,
            Math.sin(a) * AU_TO_SCENE,
            0
          )
        );
      }
      viewer.entities.add({
        name: "Earth Orbit",
        polyline: {
          positions: ring,
          width: 1.6,
          material: Color.CYAN.withAlpha(0.9),
        },
      });

      // Draw NEOs
      let maxAU = 1.2;
      for (const n of items) {
        const od = n.orbital_data;
        if (!od) continue;

        const a = Number(od.semi_major_axis);
        const e = Number(od.eccentricity);
        if (!isFinite(a) || !isFinite(e) || a <= 0) continue;

        maxAU = Math.max(maxAU, a * (1 + e));

        // orbit ellipse
        const pts = ellipsePositionsAU(a, clamp(e, 0, 0.99), 720, Cesium);
        viewer.entities.add({
          id: `${n.id}-orbit`,
          polyline: {
            positions: pts,
            width: 1.5,
            material: (n.hazardous ? Color.RED : Color.LIME).withAlpha(0.9),
          },
        });

        // closest-approach marker if we can compute it
        const M0 = Number(od.mean_anomaly);
        const nDegPerDay = Number(od.mean_motion);
        const epochOscJD = Number(od.epoch_osculation);
        const approachEpoch = n?.approach?.epoch;

        let markX: number | null = null,
          markY: number | null = null;
        if (
          isFinite(M0) &&
          isFinite(nDegPerDay) &&
          isFinite(epochOscJD) &&
          typeof approachEpoch === "number"
        ) {
          const approachJD = msToJD(approachEpoch);
          const dDays = approachJD - epochOscJD;
          const M_at_CA = wrapDeg(M0 + nDegPerDay * dDays) * DEG;
          const E = solveE(M_at_CA, clamp(e, 0, 0.99));
          const b = a * Math.sqrt(1 - e * e);
          const xAU = a * (Math.cos(E) - e);
          const yAU = b * Math.sin(E);
          markX = xAU * AU_TO_SCENE;
          markY = yAU * AU_TO_SCENE;
        }

        viewer.entities.add({
          id: n.id, // <- use id so we can flyTo it later
          name: n.name,
          position:
            markX != null && markY != null
              ? new Cartesian3(markX, markY, 0)
              : new Cartesian3(aphelionAU(od) * AU_TO_SCENE, 0, 0),
          point: {
            pixelSize: 7,
            color: Color.MAGENTA,
            outlineColor: Color.BLACK,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: n.name,
            font: "11px sans-serif",
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            pixelOffset: new Cartesian2(0, -14),
            showBackground: true,
            backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }

      // Fit camera
      const R = maxAU * 1.15 * AU_TO_SCENE;
      const sphere = BoundingSphere.fromPoints([
        new Cartesian3(R, 0, 0),
        new Cartesian3(-R, 0, 0),
        new Cartesian3(0, R, 0),
        new Cartesian3(0, -R, 0),
      ]);
      viewer.camera.flyToBoundingSphere(sphere, { duration: 0 });

      viewerRef.current = { viewer, Cesium, sphere };
    })();

    return () => {
      mounted = false;
      const store = viewerRef.current;
      if (store?.viewer) {
        try {
          store.viewer.destroy();
        } catch {}
      }
      viewerRef.current = null;
    };
  }, [items]);

  // react to selection: fly to entity by id
  useEffect(() => {
    const store = viewerRef.current;
    if (!store || !selectedId) return;
    const ent = store.viewer.entities.getById(selectedId);
    if (ent?.position?.getValue) {
      const pos = ent.position.getValue(store.viewer.clock.currentTime);
      if (pos) {
        store.viewer.camera.flyTo({
          destination: new store.Cesium.Cartesian3(pos.x, pos.y, pos.z + 8e6),
          duration: 0.6,
        });
      }
    }
  }, [selectedId]);

  const fit = () => {
    const store = viewerRef.current;
    if (!store) return;
    store.viewer.camera.flyToBoundingSphere(store.sphere, { duration: 0.4 });
  };

  return (
    <div className="relative w-full h-[calc(100vh-140px)] md:h-[calc(100vh-130px)]">
      <div ref={holderRef} className="absolute inset-0" />
      <div className="absolute left-2 top-2 z-10">
        <button
          onClick={fit}
          className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm ring-1 ring-white/10"
        >
          Fit
        </button>
      </div>
    </div>
  );
}
