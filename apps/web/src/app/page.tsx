import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-2xl text-center space-y-8">
        <h1 className="text-5xl font-bold tracking-tight">
          <span className="gradient-text">BreathKYC</span>
        </h1>
        <p className="text-xl text-gray-400 leading-relaxed">
          The only identity verification platform that uses breath-based liveness
          detection. Verify real humans with synchronized audio-visual biological
          signals.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/verify"
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-breath-cyan to-breath-violet text-black font-semibold hover:opacity-90 transition-opacity"
          >
            Start Verification
          </Link>
          <Link
            href="/demo"
            className="px-8 py-3 rounded-xl border border-gray-700 text-gray-300 font-semibold hover:border-breath-cyan hover:text-breath-cyan transition-colors"
          >
            View Demo
          </Link>
        </div>
        <div className="pt-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm text-gray-500">
          <div className="space-y-1">
            <div className="text-breath-cyan font-semibold text-lg">1</div>
            <div>Geolocation</div>
          </div>
          <div className="space-y-1">
            <div className="text-breath-cyan font-semibold text-lg">2</div>
            <div>Document</div>
          </div>
          <div className="space-y-1">
            <div className="text-breath-cyan font-semibold text-lg">3</div>
            <div>Face Match</div>
          </div>
          <div className="space-y-1">
            <div className="text-breath-cyan font-semibold text-lg">4</div>
            <div>Breath Liveness</div>
          </div>
        </div>
      </div>
    </main>
  );
}
