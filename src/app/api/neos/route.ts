// src/app/api/neos/route.ts
import { NextResponse } from "next/server";

// --- Types for the slimmed response your UI expects ---
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
    inclination?: string; // deg
    ascending_node_longitude?: string;
    perihelion_argument?: string;
    epoch_osculation?: string; // JD
    mean_anomaly?: string; // deg
    mean_motion?: string; // deg/day
    orbit_class?: any;
  };
};

type NeowsBrowseResponse = {
  near_earth_objects: any[];
  page: {
    number: number;
    size: number;
    total_pages: number;
    total_elements: number;
  };
};

const NASA_BASE = "https://api.nasa.gov/neo/rest/v1";

/**
 * Map a NEOWS NEO object into our compact ApproachRow.
 * We use the *first* close_approach_data item if present.
 */
function mapNeo(neo: any): ApproachRow | null {
  try {
    const cad = Array.isArray(neo.close_approach_data)
      ? neo.close_approach_data[0]
      : undefined;

    const diameterKm =
      neo.estimated_diameter?.kilometers?.estimated_diameter_max ??
      neo.estimated_diameter?.kilometers?.estimated_diameter_min ??
      undefined;

    const velocityKps = cad?.relative_velocity?.kilometers_per_second
      ? Number(cad.relative_velocity.kilometers_per_second)
      : NaN;

    const missKm = cad?.miss_distance?.kilometers
      ? Number(cad.miss_distance.kilometers)
      : NaN;
    const missAu = cad?.miss_distance?.astronomical
      ? Number(cad.miss_distance.astronomical)
      : NaN;

    const approachDate =
      cad?.close_approach_date_full ??
      cad?.close_approach_date ??
      neo?.orbital_data?.first_observation_date;
    const epochMs = approachDate ? Date.parse(approachDate) : NaN;

    const hm = Number(neo.absolute_magnitude_h);

    return {
      id: String(neo.id),
      neo_reference_id: String(neo.neo_reference_id ?? neo.id),
      name: String(neo.name || "Unknown NEO"),
      hm: Number.isFinite(hm) ? hm : 0,
      dia_km: Number.isFinite(diameterKm) ? diameterKm : undefined,
      hazardous: !!neo.is_potentially_hazardous_asteroid,
      approach: {
        epoch: Number.isFinite(epochMs) ? epochMs : Date.now(),
        date: approachDate
          ? new Date(approachDate).toISOString().slice(0, 10)
          : "—",
        miss_km: Number.isFinite(missKm) ? missKm : Number.NaN,
        miss_au: Number.isFinite(missAu) ? missAu : Number.NaN,
        vel_kps: Number.isFinite(velocityKps) ? velocityKps : Number.NaN,
      },
      orbital_data: neo.orbital_data ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a few pages of NEOWS browse and return a trimmed list.
 */
async function fetchNEOs(
  limit = 200,
  maxPagesToScan = 5,
  size = 20
): Promise<ApproachRow[]> {
  const out: ApproachRow[] = [];
  const apiKey = process.env.NASA_API_KEY;

  let page = 0;
  let scannedPages = 0;

  while (out.length < limit && scannedPages < maxPagesToScan) {
    // ✅ Build URLSearchParams safely; only add api_key if it exists
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("size", String(size));
    if (apiKey) params.set("api_key", apiKey);

    const url = `${NASA_BASE}/neo/browse?${params.toString()}`;

    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      // Break to avoid infinite loop on repeated failures
      break;
    }
    const json = (await res.json()) as NeowsBrowseResponse;

    for (const neo of json.near_earth_objects || []) {
      const m = mapNeo(neo);
      if (m) out.push(m);
      if (out.length >= limit) break;
    }

    scannedPages++;
    page++;
    if (json.page && page >= json.page.total_pages) break;
  }

  // Simple sort: nearest approach first (smallest miss distance in AU)
  out.sort((a, b) => {
    const aa = a.approach.miss_au;
    const bb = b.approach.miss_au;
    if (Number.isNaN(aa) && Number.isNaN(bb)) return 0;
    if (Number.isNaN(aa)) return 1;
    if (Number.isNaN(bb)) return -1;
    return aa - bb;
  });

  return out;
}

// GET /api/neos
export async function GET() {
  try {
    const items = await fetchNEOs(250, 6, 30);
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to fetch NEOs", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
