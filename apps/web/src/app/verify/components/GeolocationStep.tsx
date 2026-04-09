"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useVerificationStore } from "@/hooks/useVerificationStore";
import { api } from "@/lib/api";

type GeoState = "idle" | "requesting" | "checking" | "success" | "error";

export function GeolocationStep() {
  const [state, setState] = useState<GeoState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const { sessionId, setSessionId, setGeoResult, advanceStep, failStep } =
    useVerificationStore();

  const startCheck = useCallback(async () => {
    setState("requesting");
    setError(null);

    // Start session if not already started
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      const sessionRes = await api.startVerification();
      if (!sessionRes.success || !sessionRes.data) {
        setError("Failed to start verification session. Please try again.");
        setState("error");
        return;
      }
      currentSessionId = sessionRes.data.sessionId;
      setSessionId(currentSessionId);
    }

    // Request browser geolocation
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      setState("error");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({ lat: latitude, lng: longitude });
        setState("checking");

        const res = await api.submitGeolocation(currentSessionId!, latitude, longitude);

        if (!res.success || !res.data) {
          setError(res.error ?? "Geolocation check failed.");
          setState("error");
          failStep();
          return;
        }

        if (!res.data.allowed) {
          setError(
            res.data.vpnDetected
              ? "VPN detected. Please disable your VPN and try again."
              : `Verification is not available in your location (${res.data.country}).`
          );
          setState("error");
          failStep();
          return;
        }

        setGeoResult({
          latitude,
          longitude,
          country: res.data.country,
          region: res.data.region,
          vpnDetected: res.data.vpnDetected,
          allowed: res.data.allowed,
        });
        setState("success");
      },
      (geoError) => {
        const messages: Record<number, string> = {
          1: "Location permission denied. Please allow location access in your browser settings.",
          2: "Unable to determine your location. Please try again.",
          3: "Location request timed out. Please try again.",
        };
        setError(messages[geoError.code] ?? "An unknown error occurred.");
        setState("error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [sessionId, setSessionId, setGeoResult, advanceStep, failStep]);

  return (
    <Card glow className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 mx-auto rounded-full bg-breath-cyan/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-breath-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Location Verification</h2>
        <p className="text-sm text-gray-400">
          We need to verify your location to ensure you are in an authorized jurisdiction.
        </p>
      </div>

      {error && (
        <div className="bg-breath-rose/10 border border-breath-rose/30 rounded-xl p-4 text-sm text-breath-rose">
          {error}
        </div>
      )}

      {state === "success" && location && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-sm text-green-400">
          Location verified successfully. You are in an authorized jurisdiction.
        </div>
      )}

      <div className="flex justify-center">
        {state === "success" ? (
          <Button onClick={advanceStep}>Continue</Button>
        ) : (
          <Button
            onClick={startCheck}
            isLoading={state === "requesting" || state === "checking"}
          >
            {state === "error" ? "Retry" : "Verify Location"}
          </Button>
        )}
      </div>
    </Card>
  );
}
