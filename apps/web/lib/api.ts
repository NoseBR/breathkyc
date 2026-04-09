const DEMO_HEADERS: Record<string, string> = {
  "x-breath-demo": "true",
};

/**
 * Production: points to Render API.
 * Dev: uses same hostname + port 3001 so LAN testing works.
 */
const PRODUCTION_API = "https://breathkyc.onrender.com";

export function getApiBase(): string {
  // Check env var first (works in dev with .env.local)
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // In the browser on production, use the hardcoded Render URL
  if (typeof window !== "undefined") {
    const { hostname } = window.location;
    if (hostname === "localhost" || hostname.startsWith("192.168") || hostname.startsWith("10.")) {
      return `${window.location.protocol}//${hostname}:3001`;
    }
    return PRODUCTION_API;
  }
  return PRODUCTION_API;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  
  // Inject demo bypass header for frontend flow
  Object.entries(DEMO_HEADERS).forEach(([k, v]) => headers.set(k, v));

  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
  });
}

export async function apiPost(path: string, body?: object) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...DEMO_HEADERS,
  };

  return fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPostForm(path: string, formData: FormData) {
  const headers: Record<string, string> = {
    ...DEMO_HEADERS,
  };

  return fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });
}
