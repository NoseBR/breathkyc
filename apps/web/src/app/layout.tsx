import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BreathKYC — Breath-Based Identity Verification",
  description:
    "The only KYC platform that uses breath-based liveness detection. Verify identity with synchronized audio-visual biological signals.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
