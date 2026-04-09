import type { ApiResponse } from "@/types/verification";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    return {
      success: false,
      error: errorBody?.error ?? `Request failed with status ${response.status}`,
    };
  }

  const data = await response.json();
  return { success: true, data };
}

export const api = {
  startVerification: () =>
    request<{ sessionId: string; expiresAt: string }>("/verify/start", {
      method: "POST",
    }),

  submitGeolocation: (sessionId: string, latitude: number, longitude: number) =>
    request<{ allowed: boolean; country: string; region: string; vpnDetected: boolean }>(
      "/verify/geolocation",
      {
        method: "POST",
        body: JSON.stringify({ sessionId, latitude, longitude }),
      }
    ),

  uploadDocument: (sessionId: string, documentType: string, image: File) => {
    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("documentType", documentType);
    formData.append("document", image);

    return fetch(`${API_BASE_URL}/verify/document`, {
      method: "POST",
      body: formData,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) return { success: false as const, error: data.error ?? "Upload failed" };
      return { success: true as const, data };
    });
  },

  confirmDocument: (
    sessionId: string,
    fields: { name: string; cpf: string; dateOfBirth: string; documentNumber: string }
  ) =>
    request("/verify/document/confirm", {
      method: "POST",
      body: JSON.stringify({ sessionId, ...fields }),
    }),

  submitFace: (sessionId: string, image: File, livenessScore: number) => {
    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("livenessScore", String(livenessScore));
    formData.append("face", image);

    return fetch(`${API_BASE_URL}/verify/face`, {
      method: "POST",
      body: formData,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) return { success: false as const, error: data.error ?? "Upload failed" };
      return { success: true as const, data };
    });
  },

  submitBreath: (
    sessionId: string,
    payload: {
      audioFeatures: Record<string, unknown>;
      visualFeatures: Record<string, unknown>;
      correlationScore: number;
      totalScore: number;
    }
  ) =>
    request("/verify/breath", {
      method: "POST",
      body: JSON.stringify({ sessionId, ...payload }),
    }),

  getResult: (sessionId: string) =>
    request(`/verify/${sessionId}`),
};
