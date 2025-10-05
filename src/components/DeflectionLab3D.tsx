"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Deflection Lab 3D (Cesium) — linear visual model + mission result popup
 */

type ImpactCarryover = {
  lat: number;
  lon: number;
  craterKm: number;
  etaISO: string;
  name: string;
  velKps?: number;
  diameterKm?: number;
  massKg?: number;
};

type UI = {
  useImpactAsteroid: boolean;
  editAsteroid: boolean;
};

type ImpactorParams = {
  impactorMassKg: number;
  impactorRelSpeedKps: number;
  beta: number;
  phiDeg: number; // 0 = prograde, 180 = retrograde
  burnDays: number; // lead time before encounter
};

type AsteroidParams = {
  diameterKm: number;
  density: number; // kg/m^3
  speedKps: number; // heliocentric speed scale (used to infer e)
};

const AU_TO_SCENE = 1_000_000;
const DEG = Math.PI / 180;
const SUN_RADIUS_AU = 0.12;
const EARTH_RADIUS_AU = 0.03;
const EARTH_PERIOD_DAYS = 365.25;
const N_EARTH = (2 * Math.PI) / EARTH_PERIOD_DAYS;

// success threshold
const SAFE_MISS_KM = 15_000;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function toMillis(years: number, months: number, days: number) {
  const d = years * 365.25 + months * 30 + days;
  return d * 86_400_000;
}
function earthAngleAt(daysFromStart: number) {
  return N_EARTH * daysFromStart;
}
function eccFromVel(velKps: number) {
  return clamp(((velKps - 5) / (65 - 5)) * 0.6 + 0.1, 0.05, 0.75);
}
function massFromDiameter(diameterKm: number, density = 3000) {
  const r = (diameterKm * 1000) / 2;
  const vol = (4 / 3) * Math.PI * r * r * r;
  return vol * density;
}
function solveKepler(M: number, e: number) {
  let E = M;
  for (let k = 0; k < 15; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const step = f / fp;
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return E;
}
function posFromElements(
  aAU: number,
  e: number,
  iDeg: number,
  OmegaDeg: number,
  omegaDeg: number,
  Mdeg: number
) {
  const i = iDeg * DEG,
    O = OmegaDeg * DEG,
    w = omegaDeg * DEG;
  const cO = Math.cos(O),
    sO = Math.sin(O);
  const ci = Math.cos(i),
    si = Math.sin(i);
  const cw = Math.cos(w),
    sw = Math.sin(w);

  const R11 = cO * cw - sO * sw * ci;
  const R12 = -cO * sw - sO * cw * ci;
  const R13 = sO * si;
  const R21 = sO * cw + cO * sw * ci;
  const R22 = -sO * sw + cO * cw * ci;
  const R23 = -cO * si;
  const R31 = sw * si;
  const R32 = cw * si;

  const M = Mdeg * DEG;
  const E = solveKepler(M, e);
  const cosE = Math.cos(E),
    sinE = Math.sin(E);
  const rAU = aAU * (1 - e * cosE);
  const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
  const xpf = rAU * Math.cos(nu),
    ypf = rAU * Math.sin(nu);
  const x = R11 * xpf + R12 * ypf;
  const y = R21 * xpf + R22 * ypf;
  const z = R31 * xpf + R32 * ypf;
  return { x: x * AU_TO_SCENE, y: y * AU_TO_SCENE, z: z * AU_TO_SCENE, nu };
}
function orbitCurvePoints(
  aAU: number,
  e: number,
  iDeg: number,
  OmegaDeg: number,
  omegaDeg: number,
  samples: number,
  Cesium: any
) {
  const { Cartesian3 } = Cesium ?? {};
  if (!Cartesian3) return [];
  const i = iDeg * DEG,
    O = OmegaDeg * DEG,
    w = omegaDeg * DEG;
  const cO = Math.cos(O),
    sO = Math.sin(O);
  const ci = Math.cos(i),
    si = Math.sin(i);
  const cw = Math.cos(w),
    sw = Math.sin(w);

  const R11 = cO * cw - sO * sw * ci;
  const R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci;
  const R22 = -sO * sw + cO * cw * ci;
  const R23 = -cO * si;
  const R31 = sw * si;
  const R32 = cw * si;

  const pts: any[] = [];
  const N = Math.max(64, Math.min(2048, samples ?? 720));
  for (let k = 0; k <= N; k++) {
    const nu = (k / N) * 2 * Math.PI;
    const rAU = (aAU * (1 - e * e)) / (1 + e * Math.cos(nu));
    const xpf = rAU * Math.cos(nu),
      ypf = rAU * Math.sin(nu);
    const x = (R11 * xpf + R12 * ypf) * AU_TO_SCENE;
    const y = (R21 * xpf + R22 * ypf) * AU_TO_SCENE;
    const z = (R31 * xpf + R32 * ypf) * AU_TO_SCENE;
    pts.push(new Cartesian3(x, y, z));
  }
  return pts;
}

export default function DeflectionLab3D() {
  const carry = useMemo<ImpactCarryover | null>(() => {
    try {
      const raw = sessionStorage.getItem("mm-impact-detail");
      if (!raw) return null;
      return JSON.parse(raw) as ImpactCarryover;
    } catch {
      return null;
    }
  }, []);

  const [encounterTime, setEncounterTime] = useState({
    years: 1,
    months: 0,
    days: 0,
  });
  const msToEncounter = useMemo(
    () =>
      toMillis(encounterTime.years, encounterTime.months, encounterTime.days),
    [encounterTime]
  );

  const [asteroid, setAsteroid] = useState<AsteroidParams>(() => ({
    diameterKm: carry?.diameterKm ?? 800,
    density: 3000,
    speedKps: carry?.velKps ?? 22,
  }));

  const [ui, setUI] = useState<UI>({
    useImpactAsteroid: !!carry,
    editAsteroid: false,
  });

  const [I, setI] = useState<ImpactorParams>({
    impactorMassKg: 3.5e5,
    impactorRelSpeedKps: 7,
    beta: 2.0,
    phiDeg: 15,
    burnDays: 30,
  });

  const [visGain, setVisGain] = useState<number>(200);

  const massAstKg = useMemo(
    () =>
      carry?.massKg ?? massFromDiameter(asteroid.diameterKm, asteroid.density),
    [carry?.massKg, asteroid.diameterKm, asteroid.density]
  );

  const deltaV_true_kps = useMemo(
    () =>
      (I.beta * I.impactorMassKg * I.impactorRelSpeedKps) /
      Math.max(1, massAstKg),
    [I.beta, I.impactorMassKg, I.impactorRelSpeedKps, massAstKg]
  );

  const deltaV_tangent_kps = useMemo(
    () => deltaV_true_kps * Math.cos(I.phiDeg * DEG),
    [deltaV_true_kps, I.phiDeg]
  );

  const holderRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const ents = useRef<{
    sun?: any;
    earth?: any;
    earthOrbit?: any;
    rockOrig?: any;
    rockNew?: any;
    orbitOrig?: any;
    orbitNew?: any;
    earthAtT?: any;
    impulseVec?: any;
    impactor?: any;
    impactorPath?: any;
  }>({});

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const [missKm, setMissKm] = useState<number | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultSuccess, setResultSuccess] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const Cesium = await import("cesium");
      (window as any).CESIUM_BASE_URL = "/cesium";

      const {
        Viewer,
        Color,
        Cartesian3,
        Cartesian2,
        DistanceDisplayCondition,
        LabelStyle,
        JulianDate,
      } = Cesium;

      if (!holderRef.current || viewerRef.current) return;

      const creditDiv = document.createElement("div");
      creditDiv.style.display = "none";

      const viewer = new Viewer(holderRef.current, {
        animation: true,
        timeline: true,
        homeButton: true,
        sceneModePicker: true,
        baseLayerPicker: false,
        navigationHelpButton: true,
        fullscreenButton: false,
        geocoder: false,
        creditContainer: creditDiv,
      } as any);

      viewer.scene.requestRenderMode = true;
      viewer.scene.globe.show = false;
      (viewer.scene as any).skyAtmosphere = undefined;
      (viewer.scene as any).skyBox = undefined;
      viewer.scene.backgroundColor = Color.fromCssColorString("#0b0f19");
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display =
        "none";

      viewer.homeButton.viewModel.command.beforeExecute.addEventListener(
        (e: any) => {
          e.cancel = true;
          viewer.camera.flyTo({
            destination: new Cartesian3(0, 0, 3.4 * AU_TO_SCENE),
            duration: 0.6,
          });
        }
      );

      ents.current.sun = viewer.entities.add({
        name: "Sun",
        position: Cartesian3.ZERO,
        ellipsoid: {
          radii: new Cartesian3(
            SUN_RADIUS_AU * AU_TO_SCENE,
            SUN_RADIUS_AU * AU_TO_SCENE,
            SUN_RADIUS_AU * AU_TO_SCENE
          ),
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

      const circlePts = Array.from({ length: 360 }, (_, k) => {
        const a = (k / 360) * 2 * Math.PI;
        return new Cartesian3(
          Math.cos(a) * AU_TO_SCENE,
          Math.sin(a) * AU_TO_SCENE,
          0
        );
      });
      ents.current.earthOrbit = viewer.entities.add({
        name: "Earth Orbit",
        polyline: {
          positions: circlePts,
          width: 1.6,
          material: Color.CYAN.withAlpha(0.85),
        },
      });

      ents.current.earth = viewer.entities.add({
        name: "Earth",
        position: Cartesian3.fromElements(AU_TO_SCENE, 0, 0),
        ellipsoid: {
          radii: new Cartesian3(
            EARTH_RADIUS_AU * AU_TO_SCENE,
            EARTH_RADIUS_AU * AU_TO_SCENE,
            EARTH_RADIUS_AU * AU_TO_SCENE
          ),
          material: Color.fromCssColorString("#7ec8ff"),
        } as any,
        label: {
          text: "Earth",
          font: "12px sans-serif",
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          pixelOffset: new Cartesian2(0, -20),
          showBackground: true,
          backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new DistanceDisplayCondition(
            0,
            Number.POSITIVE_INFINITY
          ),
        },
      });

      viewer.camera.setView({
        destination: new Cartesian3(0, 0, 3.4 * AU_TO_SCENE),
      });
      viewer.clock.multiplier = 86400;
      viewer.clock.shouldAnimate = false;

      const keepRendering = () => viewer.scene.requestRender();
      viewer.clock.onTick.addEventListener(keepRendering);

      viewerRef.current = { viewer, Cesium, keepRendering };
    })();

    return () => {
      const store = viewerRef.current;
      if (!store) return;
      try {
        store.viewer.clock.onTick.removeEventListener(store.keepRendering);
        store.viewer.destroy();
      } catch {}
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const v = viewerRef.current?.viewer;
    if (!v) return;
    v.clock.multiplier = speed * 86400;
    v.clock.shouldAnimate = playing;
  }, [speed, playing]);

  useEffect(() => {
    const store = viewerRef.current;
    if (!store) return;
    const { viewer, Cesium } = store;
    const {
      Cartesian3,
      Cartesian2,
      Color,
      JulianDate,
      SampledPositionProperty,
      DistanceDisplayCondition,
      LabelStyle,
      Math: CMath,
      HeadingPitchRange,
      BoundingSphere,
      ClockRange,
    } = Cesium;

    const rm = (x: any) => {
      try {
        if (x) viewer.entities.remove(x);
      } catch {}
    };
    rm(ents.current.rockOrig);
    rm(ents.current.rockNew);
    rm(ents.current.orbitOrig);
    rm(ents.current.orbitNew);
    rm(ents.current.earthAtT);
    rm(ents.current.impulseVec);
    rm(ents.current.impactor);
    rm(ents.current.impactorPath);
    ents.current.rockOrig =
      ents.current.rockNew =
      ents.current.orbitOrig =
      ents.current.orbitNew =
      ents.current.earthAtT =
      ents.current.impulseVec =
      ents.current.impactor =
      ents.current.impactorPath =
        undefined;

    const start = JulianDate.now();
    const stop = JulianDate.addSeconds(
      start,
      msToEncounter / 1000,
      new JulianDate()
    );
    const totalDays = Math.max(
      1 / 24,
      JulianDate.secondsDifference(stop, start) / 86400
    );
    const burnDays = clamp(I.burnDays, 0, totalDays - 1e-3);
    const tBurn = JulianDate.addDays(
      start,
      totalDays - burnDays,
      new JulianDate()
    );

    viewer.clock.startTime = start.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.clockRange = ClockRange.CLAMPED;
    viewer.clock.shouldAnimate = false;

    const earthPos = new SampledPositionProperty();
    const earthN = 576;
    for (let i = 0; i <= earthN; i++) {
      const t = JulianDate.addSeconds(
        start,
        (i / earthN) * (msToEncounter / 1000),
        new JulianDate()
      );
      const d = JulianDate.secondsDifference(t, start) / 86400;
      const th = earthAngleAt(d);
      earthPos.addSample(
        t,
        new Cartesian3(
          Math.cos(th) * AU_TO_SCENE,
          Math.sin(th) * AU_TO_SCENE,
          0
        )
      );
    }
    if (ents.current.earth) ents.current.earth.position = earthPos;

    // original orbit sizing
    const thetaImpact = earthAngleAt(totalDays);
    const e0 = eccFromVel(asteroid.speedKps);
    const a0AU = (1 * (1 + e0 * Math.cos(thetaImpact))) / (1 - e0 * e0);
    const n0 = N_EARTH / Math.pow(a0AU, 1.5);

    const s = Math.sqrt((1 - e0) / (1 + e0));
    const tanE2 = Math.tan(thetaImpact / 2) * s;
    const Eimp = 2 * Math.atan(tanE2);
    const Mimp = Eimp - e0 * Math.sin(Eimp);
    const M0deg = ((Mimp - n0 * totalDays) * 180) / Math.PI;

    // Original path
    const posOrig = new SampledPositionProperty();
    const rockN = 900;
    for (let i = 0; i <= rockN; i++) {
      const t = JulianDate.addSeconds(
        start,
        (i / rockN) * (msToEncounter / 1000),
        new JulianDate()
      );
      const d = JulianDate.secondsDifference(t, start) / 86400;
      const Mdeg = M0deg + ((n0 * 180) / Math.PI) * d;
      const p0 = posFromElements(a0AU, e0, 0, 0, 0, Mdeg);
      posOrig.addSample(t, new Cartesian3(p0.x, p0.y, p0.z));
    }
    ents.current.rockOrig = viewer.entities.add({
      name: "Asteroid (orig)",
      position: posOrig,
      point: {
        pixelSize: 7,
        color: Color.MAGENTA,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: "orig",
        font: "12px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const orbit0Pts = orbitCurvePoints(a0AU, e0, 0, 0, 0, 1024, Cesium);
    ents.current.orbitOrig = viewer.entities.add({
      polyline: { positions: orbit0Pts, width: 1.4, material: Color.MAGENTA },
    });

    // deflection (linear visual)
    const frac_true = clamp(
      2 * (deltaV_tangent_kps / Math.max(0.1, asteroid.speedKps)),
      -0.5,
      0.5
    );
    const frac_vis = clamp(frac_true * clamp(visGain, 1, 1000), -0.5, 0.5);

    const a1AU = a0AU * (1 + frac_vis);
    const e1 = clamp(e0, 0.01, 0.95);
    const n1 = N_EARTH / Math.pow(a1AU, 1.5);

    const dBurn = JulianDate.secondsDifference(tBurn, start) / 86400;
    const Mdeg_burn = M0deg + ((n0 * 180) / Math.PI) * dBurn;
    const pBurn = posFromElements(a0AU, e0, 0, 0, 0, Mdeg_burn);
    const nuBurn = pBurn.nu;
    const E1 =
      2 * Math.atan(Math.tan(nuBurn / 2) * Math.sqrt((1 - e1) / (1 + e1)));
    const M1_burn = E1 - e1 * Math.sin(E1);
    const M0deg1 = (M1_burn * 180) / Math.PI - ((n1 * 180) / Math.PI) * dBurn;

    const posNew = new SampledPositionProperty();
    for (let i = 0; i <= rockN; i++) {
      const t = JulianDate.addSeconds(
        start,
        (i / rockN) * (msToEncounter / 1000),
        new JulianDate()
      );
      const d = JulianDate.secondsDifference(t, start) / 86400;
      if (Cesium.JulianDate.lessThanOrEquals(t, tBurn)) {
        const Mdeg = M0deg + ((n0 * 180) / Math.PI) * d;
        const pp = posFromElements(a0AU, e0, 0, 0, 0, Mdeg);
        posNew.addSample(t, new Cartesian3(pp.x, pp.y, pp.z));
      } else {
        const Mdeg = M0deg1 + ((n1 * 180) / Math.PI) * d;
        const pp = posFromElements(a1AU, e1, 0, 0, 0, Mdeg);
        posNew.addSample(t, new Cartesian3(pp.x, pp.y, pp.z));
      }
    }
    ents.current.rockNew = viewer.entities.add({
      name: "Asteroid (deflected)",
      position: posNew,
      point: {
        pixelSize: 7,
        color: Color.LIME,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: "new",
        font: "12px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const orbit1Pts = orbitCurvePoints(a1AU, e1, 0, 0, 0, 1024, Cesium);
    ents.current.orbitNew = viewer.entities.add({
      polyline: { positions: orbit1Pts, width: 1.6, material: Color.LIME },
    });

    // Earth marker at encounter — reuse existing thetaImpact (no redeclare!)
    ents.current.earthAtT = viewer.entities.add({
      position: new Cartesian3(
        Math.cos(thetaImpact) * AU_TO_SCENE,
        Math.sin(thetaImpact) * AU_TO_SCENE,
        0
      ),
      label: {
        text: "T",
        font: "bold 18px sans-serif",
        fillColor: Color.CYAN,
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, -12),
        showBackground: false,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // impulse vector & impactor line
    const burnPos = new Cartesian3(pBurn.x, pBurn.y, pBurn.z);
    const eps = 0.02 * AU_TO_SCENE;
    const tangent = new Cartesian3(-pBurn.y, pBurn.x, 0);
    const tlen = Math.hypot(tangent.x, tangent.y, tangent.z) || 1;
    const sign = Math.sign(Math.cos(I.phiDeg * DEG)) || 1;
    const tx = (tangent.x / tlen) * eps * sign;
    const ty = (tangent.y / tlen) * eps * sign;
    const tip = new Cartesian3(pBurn.x + tx, pBurn.y + ty, pBurn.z);
    ents.current.impulseVec = viewer.entities.add({
      polyline: {
        positions: [burnPos, tip],
        width: 3,
        material: Color.YELLOW.withAlpha(0.9),
      },
    });

    const startVec = new Cartesian3(
      pBurn.x - 1.2 * AU_TO_SCENE,
      pBurn.y - 0.6 * AU_TO_SCENE,
      0
    );
    const impactorPos = new SampledPositionProperty();
    impactorPos.addSample(start, startVec);
    impactorPos.addSample(tBurn, burnPos);
    ents.current.impactorPath = viewer.entities.add({
      polyline: {
        positions: [startVec, burnPos],
        width: 1.2,
        material: Color.WHITE.withAlpha(0.6),
      },
    });
    ents.current.impactor = viewer.entities.add({
      name: "Impactor",
      position: impactorPos,
      point: {
        pixelSize: 6,
        color: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: "impactor",
        font: "11px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cartesian2(0, -14),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(
          0,
          Number.POSITIVE_INFINITY
        ),
      },
    });

    // Frame camera
    const maxAU = Math.max(1, a0AU * (1 + e0), a1AU * (1 + e1));
    const sphere = BoundingSphere.fromPoints([
      new Cartesian3(maxAU * AU_TO_SCENE, 0, 0),
      new Cartesian3(-maxAU * AU_TO_SCENE, 0, 0),
      new Cartesian3(0, maxAU * AU_TO_SCENE, 0),
      new Cartesian3(0, -maxAU * AU_TO_SCENE, 0),
    ]);
    const offset = new HeadingPitchRange(
      CMath.toRadians(22),
      -CMath.toRadians(28),
      sphere.radius * 3.0
    );
    viewer.camera.flyToBoundingSphere(sphere, { offset, duration: 0 });

    // Miss distance at encounter
    const pEarthT = new Cartesian3(
      Math.cos(thetaImpact) * AU_TO_SCENE,
      Math.sin(thetaImpact) * AU_TO_SCENE,
      0
    );
    const dStop = totalDays;
    const Mdeg_stop = M0deg1 + ((n1 * 180) / Math.PI) * dStop;
    const pStop = posFromElements(a1AU, e1, 0, 0, 0, Mdeg_stop);
    const dx = pStop.x - pEarthT.x;
    const dy = pStop.y - pEarthT.y;
    const dz = pStop.z - pEarthT.z;
    const dScene = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dAU = dScene / AU_TO_SCENE;
    const dKm = dAU * 149_597_870.7;
    setMissKm(dKm);

    viewer.scene.requestRender();
  }, [
    asteroid.speedKps,
    asteroid.diameterKm,
    asteroid.density,
    I.impactorMassKg,
    I.impactorRelSpeedKps,
    I.beta,
    I.phiDeg,
    I.burnDays,
    msToEncounter,
    visGain,
  ]);

  function evaluateMission() {
    if (missKm == null || !Number.isFinite(missKm)) return;
    setResultSuccess(missKm >= SAFE_MISS_KM);
    setResultOpen(true);
  }

  const disableAsteroid = ui.useImpactAsteroid && !ui.editAsteroid && !!carry;

  return (
    <div className="mm-view cesium-show-widgets relative">
      <div ref={holderRef} className="absolute inset-0" />

      <div className="absolute top-3 left-3 w-[460px] max-w-[92vw] rounded-xl bg-black/60 ring-1 ring-white/10 p-3 space-y-3 backdrop-blur">
        <div className="text-sm font-semibold">
          Mission: Save Earth — Deflection Lab
        </div>

        {carry && (
          <div className="text-[11px] text-white/80">
            Using asteroid from Impact Lab:{" "}
            <span className="font-mono">{carry.name}</span> (d≈
            {carry.diameterKm ?? "?"} km, v≈{carry.velKps ?? "?"} km/s).
          </div>
        )}

        <div className="grid grid-cols-[170px_1fr] items-center gap-2 text-xs">
          <label>Use Impact Lab asteroid</label>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={ui.useImpactAsteroid}
              onChange={(e) =>
                setUI((s) => ({ ...s, useImpactAsteroid: e.target.checked }))
              }
            />
            <span className="opacity-70">
              {carry ? "available" : "none found"}
            </span>
          </div>

          <label>Allow edits</label>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={ui.editAsteroid}
              onChange={(e) =>
                setUI((s) => ({ ...s, editAsteroid: e.target.checked }))
              }
              disabled={!ui.useImpactAsteroid || !carry}
            />
            <span className="opacity-70">(override asteroid)</span>
          </div>

          <label className={disableAsteroid ? "opacity-50" : ""}>
            Asteroid diameter (km)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={50}
              max={3000}
              step={5}
              value={asteroid.diameterKm}
              onChange={(e) =>
                setAsteroid((s) => ({
                  ...s,
                  diameterKm: Number(e.target.value),
                }))
              }
              className="w-full"
              disabled={disableAsteroid}
            />
            <span className="w-14 text-right">{asteroid.diameterKm}</span>
          </div>

          <label className={disableAsteroid ? "opacity-50" : ""}>
            Density (kg/m³)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1000}
              max={8000}
              step={100}
              value={asteroid.density}
              onChange={(e) =>
                setAsteroid((s) => ({ ...s, density: Number(e.target.value) }))
              }
              className="w-full"
              disabled={disableAsteroid}
            />
            <span className="w-14 text-right">{asteroid.density}</span>
          </div>

          <label className={disableAsteroid ? "opacity-50" : ""}>
            Heliocentric speed (km/s)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={5}
              max={65}
              step={1}
              value={asteroid.speedKps}
              onChange={(e) =>
                setAsteroid((s) => ({ ...s, speedKps: Number(e.target.value) }))
              }
              className="w-full"
              disabled={disableAsteroid}
            />
            <span className="w-10 text-right">{asteroid.speedKps}</span>
          </div>

          <label>Time to encounter</label>
          <div className="flex gap-2">
            <input
              type="number"
              className="w-16 bg-neutral-800/60 rounded px-2 py-1"
              min={0}
              max={20}
              value={encounterTime.years}
              onChange={(e) =>
                setEncounterTime((s) => ({
                  ...s,
                  years: clamp(Number(e.target.value) || 0, 0, 20),
                }))
              }
            />
            <span className="self-center">y</span>
            <input
              type="number"
              className="w-16 bg-neutral-800/60 rounded px-2 py-1"
              min={0}
              max={11}
              value={encounterTime.months}
              onChange={(e) =>
                setEncounterTime((s) => ({
                  ...s,
                  months: clamp(Number(e.target.value) || 0, 0, 11),
                }))
              }
            />
            <span className="self-center">m</span>
            <input
              type="number"
              className="w-16 bg-neutral-800/60 rounded px-2 py-1"
              min={0}
              max={30}
              value={encounterTime.days}
              onChange={(e) =>
                setEncounterTime((s) => ({
                  ...s,
                  days: clamp(Number(e.target.value) || 0, 0, 30),
                }))
              }
            />
            <span className="self-center">d</span>
          </div>

          <label>Burn lead time (days)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={365}
              step={1}
              value={I.burnDays}
              onChange={(e) =>
                setI((s) => ({ ...s, burnDays: Number(e.target.value) }))
              }
              className="w-full"
            />
            <span className="w-12 text-right">{I.burnDays}</span>
          </div>

          <label>Impactor mass (kg)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1e3}
              max={1e7}
              step={1e3}
              value={I.impactorMassKg}
              onChange={(e) =>
                setI((s) => ({ ...s, impactorMassKg: Number(e.target.value) }))
              }
              className="w-full"
            />
            <span className="w-20 text-right">
              {I.impactorMassKg.toLocaleString()}
            </span>
          </div>

          <label>Relative speed (km/s)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={I.impactorRelSpeedKps}
              onChange={(e) =>
                setI((s) => ({
                  ...s,
                  impactorRelSpeedKps: Number(e.target.value),
                }))
              }
              className="w-full"
            />
            <span className="w-10 text-right">{I.impactorRelSpeedKps}</span>
          </div>

          <label>Momentum factor β</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={I.beta}
              onChange={(e) =>
                setI((s) => ({ ...s, beta: Number(e.target.value) }))
              }
              className="w-full"
            />
            <span className="w-10 text-right">{I.beta.toFixed(1)}</span>
          </div>

          <label>Burn angle φ (deg)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={180}
              step={5}
              value={I.phiDeg}
              onChange={(e) =>
                setI((s) => ({ ...s, phiDeg: Number(e.target.value) }))
              }
              className="w-full"
            />
            <span className="w-10 text-right">{I.phiDeg}</span>
          </div>

          <label>Visual Gain (×)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={1000}
              step={1}
              value={visGain}
              onChange={(e) => setVisGain(Number(e.target.value))}
              className="w-full"
            />
            <span className="w-12 text-right">{visGain}×</span>
          </div>

          <label>Sim speed</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.2}
              max={20}
              step={0.2}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full"
            />
            <span className="w-10 text-right">{speed.toFixed(1)}×</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            className="px-3 py-1 rounded bg-emerald-600 text-sm"
            onClick={evaluateMission}
            disabled={missKm == null}
          >
            Evaluate Mission
          </button>
          <button
            className="px-3 py-1 rounded bg-sky-700 text-sm"
            onClick={() => setPlaying((v) => !v)}
          >
            {playing ? "Pause" : "Play"}
          </button>

          <div className="text-[11px] opacity-80">
            Δv (true) ≈ {(deltaV_true_kps * 1000).toFixed(2)} m/s • Δvₜ ={" "}
            {(deltaV_tangent_kps * 1000).toFixed(2)} m/s • Δa/a (true) ≈{" "}
            {(
              (2 * deltaV_tangent_kps) /
              Math.max(0.1, asteroid.speedKps)
            ).toFixed(6)}
          </div>
        </div>

        <div className="text-[11px] opacity-80">
          Miss distance at encounter:{" "}
          {missKm != null ? (
            <>
              <span className="font-mono">{missKm.toFixed(0)}</span> km (
              <span className="font-mono">
                {(missKm / 149_597_870.7).toFixed(6)}
              </span>{" "}
              AU) • Success threshold: {SAFE_MISS_KM.toLocaleString()} km
            </>
          ) : (
            "—"
          )}
        </div>

        <div className="text-[11px] opacity-70">
          Magenta = original; Lime = deflected. Visual Gain exaggerates the
          orbit change for clarity; the Δv numbers reflect the true inputs.
        </div>
      </div>

      {resultOpen && resultSuccess !== null && (
        <div className="absolute inset-0 flex items-center justify-center z-50">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setResultOpen(false)}
          />
          <div className="relative z-10 w-[420px] max-w-[92vw] rounded-xl bg-neutral-900 ring-1 ring-white/10 p-5 space-y-3">
            <div
              className={`text-xl font-semibold ${
                resultSuccess ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {resultSuccess ? "Mission Successful 🎉" : "Mission Failure"}
            </div>
            <div className="text-sm text-white/80">
              Miss distance:{" "}
              <span className="font-mono">{missKm?.toFixed(0)} km</span>{" "}
              (threshold {SAFE_MISS_KM.toLocaleString()} km)
            </div>
            <div className="text-sm text-white/70">
              Δv true:{" "}
              <span className="font-mono">
                {(deltaV_true_kps * 1000).toFixed(2)} m/s
              </span>{" "}
              • Lead time: <span className="font-mono">{I.burnDays} days</span>{" "}
              • β: <span className="font-mono">{I.beta.toFixed(1)}</span>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                className="px-3 py-1 rounded bg-neutral-700 text-sm"
                onClick={() => setResultOpen(false)}
              >
                Close
              </button>
              {!resultSuccess && (
                <button
                  className="px-3 py-1 rounded bg-emerald-600 text-sm"
                  onClick={() => setResultOpen(false)}
                >
                  Tweak Inputs
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
