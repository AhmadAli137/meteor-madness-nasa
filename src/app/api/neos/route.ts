// src/app/api/neos/route.ts
import { NextRequest, NextResponse } from "next/server";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const NASA_BASE = "https://api.nasa.gov/neo/rest/v1";

// ---------- small in-memory cache (node process-level) ----------
type CacheKey = string;
const cache = new Map<CacheKey, { t: number; data: any }>();
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const cacheGet = (k: CacheKey) => {
  const v = cache.get(k);
  if (!v) return;
  if (Date.now() - v.t > CACHE_TTL_MS) {
    cache.delete(k);
    return;
  }
  return v.data;
};
const cacheSet = (k: CacheKey, data: any) =>
  cache.set(k, { t: Date.now(), data });

// ---------- helpers ----------
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clampInt(
  v: unknown,
  defVal: number,
  min: number,
  max: number
): number {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return defVal;
  return Math.max(min, Math.min(max, n));
}

async function fetchJSONWithRetry(url: string, tries = 3) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        cache: "no-store",
        next: { revalidate: 0 },
        // Optional: identify requests (some APIs like this)
        headers: { "User-Agent": "meteor-madness/1.0 (NEO browse)" },
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        // retry on rate limit or 5xx
        if (r.status === 429 || (r.status >= 500 && r.status <= 599)) {
          lastErr = new Error(`Fetch ${r.status}: ${text || r.statusText}`);
          await delay(600 * 2 ** i);
          continue;
        }
        throw new Error(`Fetch ${r.status}: ${text || r.statusText}`);
      }
      return r.json();
    } catch (e: any) {
      lastErr = e;
      await delay(600 * 2 ** i);
    }
  }
  throw lastErr;
}

function kmAvg(neo: any): number | undefined {
  const d = neo?.estimated_diameter?.kilometers;
  if (!d) return undefined;
  return (
    (Number(d.estimated_diameter_min) + Number(d.estimated_diameter_max)) / 2
  );
}

function earliestUpcomingEarth(neo: any, now: number, endEpoch: number) {
  const list = (neo.close_approach_data || []).filter((c: any) => {
    if (c.orbiting_body !== "Earth") return false;
    const t = Number(c.epoch_date_close_approach ?? 0);
    return t >= now && t <= endEpoch;
  });
  if (!list.length) return null;
  list.sort(
    (a: any, b: any) =>
      a.epoch_date_close_approach - b.epoch_date_close_approach
  );
  return list[0];
}

export type ApproachRow = {
  id: string;
  neo_reference_id: string;
  name: string;
  hm: number;
  dia_km?: number;
  hazardous: boolean;
  approach: {
    epoch: number;
    date: string; // displayable
    miss_km: number;
    miss_au: number;
    vel_kps: number;
  };
  orbital_data?: {
    eccentricity?: string;
    semi_major_axis?: string; // AU
    inclination?: string; // deg
    ascending_node_longitude?: string; // deg
    perihelion_argument?: string; // deg
    epoch_osculation?: string; // JD
    mean_anomaly?: string; // deg
    mean_motion?: string; // deg/day
    orbit_class?: any;
  };
};

// ---------- minimal sample so UI still draws something if NASA is down ----------
const SAMPLE_ITEMS: ApproachRow[] = [
  {
    id: "2000433",
    neo_reference_id: "2000433",
    name: "433 Eros",
    hm: 10.39,
    dia_km: 35.9,
    hazardous: false,
    approach: {
      date: "2025-11-30T02:18:00Z",
      epoch: Date.parse("2025-11-30T02:18:00Z"),
      miss_km: 5.9487e7,
      miss_au: 0.3976,
      vel_kps: 3.73,
    },
    orbital_data: {
      eccentricity: ".2228359407071628",
      semi_major_axis: "1.458120998474684",
      inclination: "10.82846651399785",
      ascending_node_longitude: "304.2701025753316",
      perihelion_argument: "178.9297536744151",
      epoch_osculation: "2461000.5",
      mean_anomaly: "310.5543277370992",
      mean_motion: ".5597752949285997",
      orbit_class: { orbit_class_type: "AMO" },
    },
  },
  {
    id: "2000887",
    neo_reference_id: "2000887",
    name: "887 Alinda",
    hm: 13.81,
    dia_km: 7.44,
    hazardous: false,
    approach: {
      date: "2027-01-25T21:50:00Z",
      epoch: Date.parse("2027-01-25T21:50:00Z"),
      miss_km: 2.488e7,
      miss_au: 0.1663,
      vel_kps: 11.27,
    },
    orbital_data: {
      eccentricity: ".5711699794580067",
      semi_major_axis: "2.473628777430923",
      inclination: "9.400059832996321",
      ascending_node_longitude: "110.4058757991049",
      perihelion_argument: "350.5345010543012",
      epoch_osculation: "2461000.5",
      mean_anomaly: "81.54059345329632",
      mean_motion: ".2533391370191288",
      orbit_class: { orbit_class_type: "AMO" },
    },
  },
];

function buildSample(limit: number): ApproachRow[] {
  const now = Date.now();
  return SAMPLE_ITEMS.filter((r) => r.approach.epoch >= now)
    .sort((a, b) => a.approach.epoch - b.approach.epoch)
    .slice(0, limit);
}

const mask = (k: string) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : "");

// ---------- main handler ----------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const apiKey = process.env.NASA_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        items: buildSample(10),
        meta: {
          error:
            "NASA_API_KEY is missing. Add it to .env.local at project root and restart the dev server.",
          api_key_source: "missing",
          returned: 2,
          fallback: true,
        },
      },
      { status: 500 }
    );
  }

  const limit = clampInt(searchParams.get("limit"), 20, 1, 20);
  const years = clampInt(searchParams.get("years"), 10, 1, 10);
  const hazardOnlyRequested =
    (searchParams.get("hazard") || "true").toLowerCase() === "true";

  const now = Date.now();
  const endEpoch = now + years * 365.25 * 24 * 3600 * 1000;

  const cacheKey = `browse:v2:${limit}:${years}:${hazardOnlyRequested}`;
  const cached = cacheGet(cacheKey);
  if (cached) return NextResponse.json(cached);

  const out: ApproachRow[] = [];
  let page = 0;
  const size = 200;
  const maxPagesToScan = 40;
  const interPageDelayMs = 100;
  let scanned_pages = 0;
  let relaxedHazard = false;
  let lastError: string | undefined;
  let total_pages_from_api: number | undefined;

  async function scan(hazardOnly: boolean) {
    page = 0;
    while (out.length < limit && scanned_pages < maxPagesToScan) {
      const params = new URLSearchParams({
        page: String(page),
        size: String(size),
        api_key: apiKey, // <— ALWAYS your env key
      });
      const url = `${NASA_BASE}/neo/browse?${params.toString()}`;

      let j: any;
      try {
        j = await fetchJSONWithRetry(url, 3);
      } catch (e: any) {
        lastError = e?.message || String(e);
        break;
      }

      scanned_pages++;
      total_pages_from_api = Number(
        j?.page?.total_pages ?? total_pages_from_api
      );

      const neos = j?.near_earth_objects || [];
      for (const neo of neos) {
        if (hazardOnly && !neo.is_potentially_hazardous_asteroid) continue;

        const ca = earliestUpcomingEarth(neo, now, endEpoch);
        if (!ca) continue;

        out.push({
          id: neo.id,
          neo_reference_id: neo.neo_reference_id,
          name: neo.name,
          hm: neo.absolute_magnitude_h,
          dia_km: kmAvg(neo),
          hazardous: neo.is_potentially_hazardous_asteroid,
          approach: {
            epoch: ca.epoch_date_close_approach,
            date: ca.close_approach_date_full || ca.close_approach_date,
            miss_km: Number(ca.miss_distance.kilometers),
            miss_au: Number(ca.miss_distance.astronomical),
            vel_kps: Number(ca.relative_velocity.kilometers_per_second),
          },
          orbital_data: neo.orbital_data
            ? {
                eccentricity: neo.orbital_data.eccentricity,
                semi_major_axis: neo.orbital_data.semi_major_axis,
                inclination: neo.orbital_data.inclination,
                ascending_node_longitude:
                  neo.orbital_data.ascending_node_longitude,
                perihelion_argument: neo.orbital_data.perihelion_argument,
                epoch_osculation: neo.orbital_data.epoch_osculation,
                mean_anomaly: neo.orbital_data.mean_anomaly,
                mean_motion: neo.orbital_data.mean_motion,
                orbit_class: neo.orbital_data.orbit_class,
              }
            : undefined,
        });

        if (out.length >= limit) break;
      }

      const hasNext = Boolean(j?.links?.next);
      const reachedEnd =
        total_pages_from_api !== undefined && page + 1 >= total_pages_from_api;
      if (!hasNext || reachedEnd) break;

      page++;
      if (out.length < limit) await delay(interPageDelayMs);
    }
  }

  // scan with requested hazard filter
  await scan(hazardOnlyRequested);

  // if still not enough, relax hazard once
  if (out.length < limit && hazardOnlyRequested) {
    relaxedHazard = true;
    await scan(false);
  }

  // sort & trim
  out.sort(
    (a, b) =>
      a.approach.epoch - b.approach.epoch ||
      a.approach.miss_km - b.approach.miss_km
  );
  let items = out.slice(0, limit);

  // final safety: if none or too few, pad with sample (so the UI has something)
  let usedFallback = false;
  if (items.length < Math.min(5, limit)) {
    const sample = buildSample(limit - items.length);
    if (sample.length) {
      items = [...items, ...sample].slice(0, limit);
      usedFallback = true;
    }
  }

  const payload = {
    items,
    meta: {
      horizon_years: years,
      hazard_only_requested: hazardOnlyRequested,
      hazard_only_effective: hazardOnlyRequested && !relaxedHazard,
      relaxed_hazard: relaxedHazard,
      using_demo_key: false, // forced to env key
      api_key_source: "env",
      masked_api_key: mask(apiKey),
      returned: items.length,
      scanned_pages,
      total_pages_from_api,
      fetched_at: new Date().toISOString(),
      source: "browse",
      error: lastError,
      fallback: usedFallback,
    },
  };

  cacheSet(cacheKey, payload);
  return NextResponse.json(payload);
}
