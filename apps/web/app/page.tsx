"use client";

import { useEffect } from "react";
import { DASHBOARD_URL } from "../lib/auth";

export default function Page() {
  useEffect(() => {
    window.location.href = DASHBOARD_URL;
  }, []);

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <p className="text-zinc-500">Redirecting to Breath Protocol...</p>
    </main>
  );
}
