import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export default function Page() {
  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 h-20 w-20 bg-zinc-900 border border-zinc-800 rounded-[24px] shadow-xl flex items-center justify-center">
          <ShieldCheck className="w-10 h-10 text-primary" />
        </div>
        
        <h1 className="text-5xl font-extrabold bg-gradient-to-r from-[#00E5FF] to-[#B24BF3] bg-clip-text text-transparent mb-6 tracking-tight">
          BreathKYC
        </h1>
        
        <p className="text-zinc-400 mb-10 text-lg leading-relaxed px-4">
          Replace standard "rotate your head" liveness checks with a proprietary breath-based biological identity verification.
        </p>

        <Link 
          href="/verify" 
          className="inline-flex items-center justify-center bg-primary text-black font-bold text-lg rounded-2xl px-8 py-4 hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] hover:bg-[#00d6ef] transition-all transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Start Live Demo
        </Link>

        <div className="mt-12 text-zinc-600 text-sm">
          Platform version 1.0 (Development)
        </div>
      </div>
    </main>
  );
}
