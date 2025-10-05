"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import ImpactorLab3D from "@/components/ImpactorLab3D";

export default function ImpactPage() {
  const router = useRouter();

  useEffect(() => {
    const onReady = () => {
      // detail is already stored in sessionStorage by the lab
      router.push("/impact/globe");
    };
    window.addEventListener("mm-open-globe-impact", onReady as EventListener);
    return () => {
      window.removeEventListener("mm-open-globe-impact", onReady as EventListener);
    };
  }, [router]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-xl font-semibold mb-3">Impact Simulator</h1>
      <ImpactorLab3D />
    </main>
  );
}
