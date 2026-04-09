/** True when the page is not a secure context (e.g. http://192.168.x.x). Camera, mic, and GPS are often blocked. */
export function isInsecureContext(): boolean {
  return typeof window !== "undefined" && !window.isSecureContext;
}

/** Dev / explicit opt-in: show LAN-friendly bypasses (mock geo, upload selfie, etc.). */
export function allowInsecureDevBypass(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_ALLOW_MEDIA_BYPASS === "true" ||
    process.env.NEXT_PUBLIC_ALLOW_GEO_BYPASS === "true"
  );
}
