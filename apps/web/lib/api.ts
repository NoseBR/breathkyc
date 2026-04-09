const DEMO_HEADERS: Record<string, string> = {
  "x-breath-demo": "true",
};

/**
 * - Set NEXT_PUBLIC_API_URL (e.g. http://192.168.1.10:3001) when the API is not on localhost.
 * - If unset in the browser, uses the same hostname as the page + port 3001 so phone → http://YOUR_LAN_IP:3000 works with API on :3001.
 */
export function getApiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3001`;
  }
  return "http://localhost:3001";
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
