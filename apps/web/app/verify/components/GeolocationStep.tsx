"use client";

import { useState, useEffect } from "react";
import { MapPin, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { apiPost } from "../../../lib/api";
import { allowInsecureDevBypass, isInsecureContext } from "../../../lib/insecureContext";

interface GeolocationStepProps {
  sessionId: string;
  onSuccess: () => void;
  onFail: (reason: string) => void;
}

export default function GeolocationStep({
  sessionId,
  onSuccess,
  onFail,
}: GeolocationStepProps) {
  const [loading, setLoading] = useState(false);
  const [errorMSG, setErrorMSG] = useState<string | null>(null);
  const [successMSG, setSuccessMSG] = useState<string | null>(null);
  const [secureContext, setSecureContext] = useState(true);

  useEffect(() => {
    setSecureContext(!isInsecureContext());
  }, []);

  const submitCoordsToApi = async (latitude: number, longitude: number) => {
    setLoading(true);
    setErrorMSG(null);
    try {
      const res = await apiPost("/v1/verify/geolocation", {
        sessionId,
        latitude,
        longitude,
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMSG(data.error || "Verification failed");
        setLoading(false);
        return;
      }

      if (data.allowed) {
        setSuccessMSG(
          `Location verified: ${data.ipCountry || "Brazil"} ${data.ipRegion ? `(${data.ipRegion})` : ""}`
        );
        setTimeout(() => {
          onSuccess();
        }, 1500);
      } else {
        if (data.vpnDetected) {
          setLoading(false);
          const err = "Suspicious network detected. Please disable any VPNs and try again.";
          setErrorMSG(err);
          onFail(err);
        } else {
          setLoading(false);
          const err = "You are outside our approved jurisdiction. Verification blocked.";
          setErrorMSG(err);
          onFail(err);
        }
      }
    } catch {
      setLoading(false);
      setErrorMSG("Network error checking location");
    }
  };

  /** Dev-only: São Paulo coords when GPS is blocked on http:// + LAN IP. */
  const bypassWithDevCoordinates = () => {
    void submitCoordsToApi(-23.5505, -46.6333);
  };

  const requestGeolocation = () => {
    setLoading(true);
    setErrorMSG(null);

    if (!navigator.geolocation) {
      setLoading(false);
      setErrorMSG("Geolocation is not supported by your browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        void submitCoordsToApi(latitude, longitude);
      },
      () => {
        setLoading(false);
        if (isInsecureContext()) {
          setErrorMSG(
            "Your phone’s Location is fine — browsers block GPS on http:// pages opened by Wi‑Fi IP (not a secure context). Use “Dev bypass” below, or use HTTPS / localhost."
          );
        } else {
          setErrorMSG(
            "Location access denied for this site. Allow Location in browser/site settings, then tap Verify again."
          );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl flex flex-col items-center">
      <div className="mb-6 h-20 w-20 bg-zinc-800 rounded-full flex items-center justify-center">
        {successMSG ? (
          <ShieldCheck className="w-10 h-10 text-primary" />
        ) : errorMSG ? (
          <ShieldAlert className="w-10 h-10 text-error" />
        ) : (
          <MapPin className="w-10 h-10 text-accent animate-pulse" />
        )}
      </div>

      <h2 className="text-2xl font-bold mb-2 text-center text-white">Location Check</h2>
      
      <p className="text-zinc-400 text-center mb-4 text-sm px-4">
        We need to verify you are currently located in an approved jurisdiction.
      </p>

      {!secureContext && allowInsecureDevBypass() && (
        <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-amber-200/90 text-xs text-center leading-relaxed">
          You’re on <strong className="text-amber-100">http://</strong> via a network IP. Most mobile
          browsers <strong>will not run GPS</strong> here (security rule), even with Location enabled.
        </div>
      )}

      {errorMSG && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} 
          animate={{ opacity: 1, y: 0 }}
          className="w-full bg-error/10 border border-error/20 rounded-lg p-4 mb-6 text-error text-sm text-center"
        >
          {errorMSG}
        </motion.div>
      )}

      {successMSG && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} 
          animate={{ opacity: 1, y: 0 }}
          className="w-full bg-primary/10 border border-primary/20 rounded-lg p-4 mb-6 text-primary text-sm text-center"
        >
          {successMSG}
        </motion.div>
      )}

      {!successMSG && (
        <div className="w-full space-y-3">
          <button
            type="button"
            onClick={requestGeolocation}
            disabled={loading}
            className="w-full h-12 flex items-center justify-center bg-primary text-black font-semibold rounded-xl hover:bg-primary/90 transition-all font-sans disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Verifying...
              </>
            ) : (
              "Verify My Location (GPS)"
            )}
          </button>
          {!secureContext && allowInsecureDevBypass() && (
            <button
              type="button"
              onClick={bypassWithDevCoordinates}
              disabled={loading}
              className="w-full h-11 flex items-center justify-center bg-zinc-800 text-zinc-200 text-sm font-medium rounded-xl hover:bg-zinc-700 transition border border-zinc-600 disabled:opacity-50"
            >
              Dev bypass — use test coordinates (Brazil)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
