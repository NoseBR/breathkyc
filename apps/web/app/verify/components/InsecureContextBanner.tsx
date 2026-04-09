"use client";

import { useEffect, useState } from "react";
import { allowInsecureDevBypass, isInsecureContext } from "../../../lib/insecureContext";

/**
 * Explains why camera/mic/GPS fail on http:// + LAN IP and points to HTTPS / localhost.
 */
export default function InsecureContextBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isInsecureContext());
  }, []);

  if (!show) return null;

  return (
    <div className="w-full max-w-2xl mx-auto mb-3 px-2">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-amber-100/95 text-xs leading-relaxed">
        <p className="font-semibold text-amber-50 mb-1">Camera &amp; microphone on this URL</p>
        <p>
          You’re using <strong>http://</strong> with your Wi‑Fi IP. iOS and Android often{" "}
          <strong>block camera and mic</strong> here (same rule as GPS) — it’s not always a settings
          mistake.
        </p>
        <p className="mt-1.5">
          <strong>Fix:</strong> use <strong>HTTPS</strong> (e.g.{" "}
          <code className="text-amber-200/90">next dev --experimental-https</code>, ngrok, or Cloudflare
          Tunnel), or test on a PC with <strong>http://localhost</strong>.
        </p>
        {allowInsecureDevBypass() && (
          <p className="mt-1.5 text-amber-200/90">
            <strong>Dev:</strong> use gallery / upload options on this flow where shown.
          </p>
        )}
      </div>
    </div>
  );
}
