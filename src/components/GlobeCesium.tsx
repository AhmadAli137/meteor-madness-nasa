"use client";

import { useEffect, useRef } from "react";

export type ImpactOverlay = {
  lat: number;
  lon: number;
  craterKm: number;
  etaISO: string;
  name: string;
  velKps?: number;
  diameterKm?: number;
  massKg?: number;
};

export default function GlobeCesium({
  className,
  showBuildings = true,
  impact,
}: {
  className?: string;
  showBuildings?: boolean;
  impact?: ImpactOverlay | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const craterRef = useRef<{
    polygon?: any;
    outline?: any;
    label?: any;
    pin?: any;
  } | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // Build viewer once
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const Cesium = await import("cesium");
        const {
          Viewer,
          UrlTemplateImageryProvider,
          EllipsoidTerrainProvider,
          Ion,
          createWorldTerrainAsync,
          createWorldImageryAsync,
          IonWorldImageryStyle,
          createOsmBuildingsAsync,
          Cartesian3,
        } = Cesium;

        (window as any).CESIUM_BASE_URL = "/cesium";

        // Terrain + imagery
        let terrain: any = new EllipsoidTerrainProvider();
        let imagery: any = new UrlTemplateImageryProvider({
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          minimumLevel: 0,
          maximumLevel: 19,
          credit: "© OpenStreetMap contributors",
        });

        const host = containerRef.current;
        if (!host || disposed) return;

        // Clear stale canvases (HMR/StrictMode)
        host.replaceChildren();

        const creditDiv = document.createElement("div");
        creditDiv.style.display = "none";

        const viewer = new Viewer(host, {
          animation: false,
          timeline: false,
          homeButton: true,
          geocoder: false,
          baseLayerPicker: false,
          navigationHelpButton: true,
          fullscreenButton: false,
          sceneModePicker: true,
          terrainProvider: terrain,
          creditContainer: creditDiv,
        } as any);

        // Add imagery AFTER construction
        try {
          viewer.imageryLayers.removeAll();
          viewer.imageryLayers.addImageryProvider(imagery);
        } catch {}

        // Scene tuning
        viewer.scene.globe.depthTestAgainstTerrain = false; // keep overlays visible
        viewer.scene.requestRenderMode = true;
        viewer.scene.maximumRenderTimeChange = Infinity;

        // Start view
        viewer.camera.setView({
          destination: Cartesian3.fromDegrees(-95, 20, 2.2e7),
        });

        if (showBuildings) {
          try {
            const buildings = await createOsmBuildingsAsync();
            viewer.scene.primitives.add(buildings);
          } catch {}
        }

        const doResize = () => {
          try {
            viewer.resize();
            viewer.scene.requestRender();
          } catch {}
        };
        requestAnimationFrame(doResize);

        roRef.current?.disconnect();
        roRef.current = new ResizeObserver(doResize);
        roRef.current.observe(host);

        viewerRef.current = { viewer, Cesium, doResize };
      } catch (e) {
        console.error("GlobeCesium init failed:", e);
      }
    })();

    return () => {
      disposed = true;
      roRef.current?.disconnect();
      roRef.current = null;
      const ref = viewerRef.current;
      if (ref?.viewer) {
        try {
          ref.viewer.destroy();
        } catch {}
      }
      viewerRef.current = null;
    };
  }, [showBuildings]);

  // Draw/update crater overlay when `impact` changes
  useEffect(() => {
    const store = viewerRef.current;
    if (!store) return;
    const { viewer, Cesium } = store;
    const {
      Cartesian3,
      Color,
      LabelStyle,
      VerticalOrigin,
      ClassificationType,
      Math: CMath,
      HeadingPitchRange,
      BoundingSphere,
      Cartesian2,
    } = Cesium;

    // Remove old overlays
    if (craterRef.current) {
      const { polygon, outline, label, pin } = craterRef.current;
      try {
        polygon && viewer.entities.remove(polygon);
      } catch {}
      try {
        outline && viewer.entities.remove(outline);
      } catch {}
      try {
        label && viewer.entities.remove(label);
      } catch {}
      try {
        pin && viewer.entities.remove(pin);
      } catch {}
      craterRef.current = null;
    }

    if (!impact) {
      viewer.scene.requestRender();
      return;
    }

    const { lat, lon, craterKm, name } = impact;
    // Safety checks
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(craterKm)
    ) {
      console.warn("[GlobeCesium] Impact payload missing numbers:", impact);
      return;
    }

    // Build a ground polygon + ground polyline for the crater
    const radiusMeters = Math.max(2500, (craterKm * 1000) / 2);
    const R = 6378137; // Earth radius (m)
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const latRad = toRad(lat);
    const dOverR = radiusMeters / R;

    const positions: any[] = [];
    const steps = 180;
    for (let i = 0; i < steps; i++) {
      const th = (i / steps) * 2 * Math.PI;
      const dLat = dOverR * Math.sin(th);
      const dLon = (dOverR * Math.cos(th)) / Math.cos(latRad);
      positions.push(
        Cartesian3.fromDegrees(lon + toDeg(dLon), lat + toDeg(dLat), 0)
      );
    }

    // Close ring for polygon
    const polygonHierarchy = positions.concat(positions[0]);

    // Filled ground polygon (reliable across Cesium versions)
    const polygon = viewer.entities.add({
      name: `Crater • ${name}`,
      polygon: {
        hierarchy: polygonHierarchy,
        material: Color.RED.withAlpha(0.25),
        classificationType: ClassificationType.TERRAIN,
      },
    });

    // Ground clamped outline for crisp edge
    const outline = viewer.entities.add({
      polyline: {
        positions: polygonHierarchy,
        clampToGround: true,
        width: 2,
        material: Color.RED.withAlpha(0.95),
      },
    });

    // X marker
    const center = Cartesian3.fromDegrees(lon, lat, 0);
    const label = viewer.entities.add({
      position: center,
      label: {
        text: "X",
        font: "bold 24px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.RED,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // Pin + name
    const pin = viewer.entities.add({
      position: center,
      billboard: {
        image: Cesium.buildModuleUrl("Widgets/Images/Icons/marker.png"),
        scale: 0.6,
        verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: name,
        font: "12px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cartesian2(0, -28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    craterRef.current = { polygon, outline, label, pin };

    // Camera frame
    const sphere = BoundingSphere.fromPoints(positions);
    const offset = new HeadingPitchRange(
      CMath.toRadians(15),
      -CMath.toRadians(25),
      Math.max(radiusMeters * 3.5, 250000)
    );
    viewer.camera.flyToBoundingSphere(sphere, { offset, duration: 0.9 });

    viewer.scene.requestRender();
  }, [impact]);

  return (
    <div
      className={className ?? "h-[calc(100vh-140px)] w-full overflow-hidden"}
    >
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ position: "relative", overflow: "hidden" }}
      />
    </div>
  );
}
