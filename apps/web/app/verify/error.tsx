"use client";

import { ShieldAlert } from "lucide-react";

export default function VerifyError({ reset }: { reset: () => void }) {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto p-8 bg-zinc-900 border border-zinc-700 text-center rounded-2xl">
        <ShieldAlert className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-white mb-3">Something went wrong</h2>
        <p className="text-zinc-400 mb-6 text-sm">
          An unexpected error occurred during verification. Please try again.
        </p>
        <button
          onClick={() => reset()}
          className="w-full h-12 flex items-center justify-center bg-primary text-black font-bold rounded-xl hover:bg-[#00d6ef] transition"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
