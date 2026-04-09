import Link from "next/link";

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-breath-darker">
      <div className="max-w-4xl mx-auto px-4 py-16 space-y-12">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold gradient-text">BreathKYC Demo</h1>
          <p className="text-gray-400 max-w-xl mx-auto">
            Experience the only KYC platform that uses breath-based liveness detection.
            This demo walks through all 4 verification steps.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {[
            {
              step: 1,
              title: "Geolocation Check",
              desc: "Verify the user is physically in an authorized jurisdiction using GPS + IP cross-reference.",
            },
            {
              step: 2,
              title: "Document Capture",
              desc: "Photograph an ID document (CNH, RG, passport). OCR extracts name, CPF, and DOB.",
            },
            {
              step: 3,
              title: "Facial Biometric",
              desc: "Face capture with passive liveness detection — blink, micro-movement, and 3D depth checks.",
            },
            {
              step: 4,
              title: "Breath Liveness",
              desc: "The core innovation: synchronized audio + visual breath detection that AI cannot spoof.",
            },
          ].map(({ step, title, desc }) => (
            <div
              key={step}
              className="bg-breath-card border border-gray-800 rounded-2xl p-6 space-y-3"
            >
              <div className="text-breath-cyan font-bold text-sm">Step {step}</div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-sm text-gray-400">{desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/verify"
            className="inline-block px-8 py-3 rounded-xl bg-gradient-to-r from-breath-cyan to-breath-violet text-black font-semibold hover:opacity-90 transition-opacity"
          >
            Try the Full Flow
          </Link>
        </div>
      </div>
    </main>
  );
}
