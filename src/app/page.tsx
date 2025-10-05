// app/page.tsx
import Link from "next/link";

export const dynamic = "force-static";

export default function Home() {
  return (
    <main className="min-h-[calc(100vh-80px)] flex items-center justify-center">
      <div className="w-full max-w-5xl mx-auto px-4 md:px-6 py-10">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-900/30 ring-1 ring-emerald-700/40 px-3 py-1 text-emerald-200 text-xs">
            NASA Space Apps • 2025
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold">
            Meteor Madness
          </h1>
          <p className="text-white/70 max-w-2xl mx-auto">
            Explore near-Earth objects with an interactive observatory, then
            simulate a hypothetical impact to visualize potential effects.
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/observatory"
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 ring-1 ring-emerald-500 text-sm font-medium"
            >
              Launch Observatory
            </Link>
            <Link
              href="/impact"
              className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 ring-1 ring-sky-500 text-sm font-medium"
            >
              Open Impact Simulator
            </Link>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid md:grid-cols-2 gap-4 mt-10">
          <div className="rounded-xl ring-1 ring-white/10 bg-neutral-900/60 p-4">
            <div className="text-lg font-semibold mb-1">Observatory</div>
            <p className="text-sm text-white/70">
              Query real NASA NEOs and view their orbits in 2D/3D heliocentric
              scenes. Filter by date range, size, and hazard flags, and inspect
              closest approaches.
            </p>
            <div className="pt-3">
              <Link
                href="/observatory"
                className="text-emerald-300 hover:text-emerald-200 text-sm underline underline-offset-4"
              >
                Go to Observatory →
              </Link>
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-white/10 bg-neutral-900/60 p-4">
            <div className="text-lg font-semibold mb-1">Impact Simulator</div>
            <p className="text-sm text-white/70">
              Configure a hypothetical “Impactor-2025”, run a 3D orbital
              approach, then jump to a 3D Earth to see an estimated crater
              overlay at the impact site.
            </p>
            <div className="pt-3">
              <Link
                href="/impact"
                className="text-sky-300 hover:text-sky-200 text-sm underline underline-offset-4"
              >
                Go to Impact Simulator →
              </Link>
            </div>
          </div>
        </div>

        {/* Footer-ish blurb */}
        <div className="text-center text-xs text-white/50 mt-8">
          Data sources: NASA NEO APIs • Optional overlays via USGS elevation
          (future work)
        </div>
      </div>
    </main>
  );
}
