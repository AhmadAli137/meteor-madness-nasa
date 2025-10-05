"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TopNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  const linkClass = (active: boolean) =>
    [
      "px-3 py-1.5 rounded-md text-sm ring-1 transition-colors",
      active
        ? "bg-emerald-700 ring-emerald-500 text-white"
        : "bg-neutral-800/70 ring-white/10 hover:bg-neutral-700 text-white/90",
    ].join(" ");

  return (
    <header className="w-full">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between py-3">
          <Link href="/" className="text-lg font-semibold">
            Meteor Madness
          </Link>

          <nav className="flex items-center gap-2">
            <Link
              href="/observatory"
              className={linkClass(isActive("/observatory"))}
            >
              Observatory
            </Link>
            <Link href="/impact" className={linkClass(isActive("/impact"))}>
              Impactor Lab
            </Link>
            <Link
              href="/deflection"
              className={linkClass(isActive("/deflection"))}
            >
              Mission: Save Earth
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
