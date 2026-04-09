# Fully functional KYC MVP — structure

This document turns your feature list into a **sequential, testable MVP** aligned with the existing Breath-KYC monorepo (`apps/web` + `apps/api`). It is **vendor-neutral**: you can implement OCR and face steps with **open-source** components or swap in a cloud API later without changing the overall shape.

---

## 1. MVP feature pillars (what “done” means)

| Pillar | User-facing behavior | Server must prove |
|--------|----------------------|-------------------|
| **A. Session** | One stable `sessionId` for the whole flow | Session exists, expires, belongs to client |
| **B. Geolocation** | Optional coarse location check | Country/region signal stored (you already have a step) |
| **C. Document + OCR** | Capture ID → show extracted fields for review | Text read from image + **validators** pass (formats, CPF checksum where applicable) |
| **D. Document portrait** | Same upload encodes a **face ROI** for matching | Face detected or safe fallback crop; **encrypted template** stored (no raw photo in DB) |
| **E. Live face + match** | Selfie with liveness hints → match to document | MediaPipe (or similar) liveness score + **similarity** to document template ≥ threshold |
| **F. Breath liveness** | Visible mouth motion + **mic** breathing in sync | Server receives **summarized** AV metrics; pass/fail + encrypted result |
| **G. Outcome** | Success / fail + optional webhook | `status`, timestamps, no unnecessary PII in API responses |

---

## 2. End-to-end flow (strict order)

```
START session
  → GEO (optional gate)
  → DOCUMENT: upload image
        ├─ OCR pipeline → structured fields + confidence
        ├─ Validators → block or flag low confidence
        ├─ Document face ROI → embedding/template (encrypted)
        └─ User confirms/edits fields → persist encrypted documentResult
  → FACE: live capture
        ├─ Client: face mesh + liveness proxy (e.g. MediaPipe)
        ├─ Upload selfie
        └─ Server: face ROI → embedding; compare to document template; threshold
  → BREATH: camera + microphone
        ├─ Client: mouth aperture stream + RMS / breath-related audio features
        ├─ Correlate over a time window (your sync score)
        └─ Server: gate on prior face pass; store breath metrics; finalize status
  → COMPLETE or FAILED
```

**Rule:** each step **depends on the previous** (you already gate breath on face). Keep that pattern for document → face → breath.

---

## 3. Repository layout (where code lives)

| Concern | Location (current repo) | Notes |
|---------|-------------------------|--------|
| Step UI + capture | `apps/web/app/verify/` | One component per step; shared `sessionId` |
| API client | `apps/web/lib/api.ts` | Add typed helpers per endpoint if you want |
| MediaPipe / breath | `apps/web/hooks/useFaceMesh.ts`, `useBreathEngine.ts` | Client-side signals only; **never** trust client for final pass |
| HTTP routes | `apps/api/src/routes/*.ts` | Thin handlers; call services |
| **OCR service** | `apps/api/src/services/ocr/` (new) | Interface + `Tesseract` (or Paddle) implementation |
| **Document validators** | `apps/api/src/services/document/validate.ts` (new) | CPF, dates, required fields |
| **Face template** | `apps/api/src/lib/faceMatch.ts` | Embeddings + compare; optional face-detector crop |
| **Vision adapter (optional)** | `apps/api/src/services/ocr/visionGoogle.ts` | Only if you choose Google later |
| Crypto / PII | `apps/api/src/lib/crypto.ts` | Encrypt before persist |
| Persistence | `apps/api/prisma/schema.prisma` | Already has `documentFaceTemplate`, encrypted blobs |

---

## 4. API surface (minimal, REST)

Design every step around **multipart or JSON** + `sessionId`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/verify/start` | Create session (existing) |
| `POST` | `/v1/verify/geo` | Geo result (existing pattern) |
| `POST` | `/v1/verify/document` | Multipart: `document`, `documentType`, `sessionId` → OCR + portrait template + suggested fields |
| `POST` | `/v1/verify/document/confirm` | JSON: confirmed fields + server re-validates → encrypt `documentResult` |
| `POST` | `/v1/verify/face` | Multipart: `face`, `livenessScore`, `sessionId` → match + encrypt `faceResult` |
| `POST` | `/v1/verify/breath` | JSON: `syncScore` + **audio/visual summary** (frame counts, means) → encrypt `breathResult` |
| `GET` | `/v1/verify/status/:sessionId` | Poll for B2B (existing) |

**MVP rule:** responses return **scores and booleans**, not raw OCR text or images, after the review step.

---

## 5. Data model (session state)

Keep **one row per verification** (you already do). Suggested **logical** payloads inside encrypted JSON (not necessarily new columns):

- **`documentResult`**: `{ extractedData, ocrConfidence, ocrEngine, validatorsPassed, validatedAt }`
- **`faceResult`**: `{ matchScore, livenessScore, passed, timestamp }`
- **`breathResult`**: `{ passed, syncScore, audioSummary, visualSummary, timestamp }`

`documentFaceTemplate` stays **separate encrypted blob** (embedding only).

Optional later: `documentOcrRawRef` → object storage key with TTL (avoid storing raw images in SQLite for production).

---

## 6. Building blocks without Google

| Need | OSS / self-hosted option | Role in MVP |
|------|---------------------------|-------------|
| OCR | **Tesseract** via `tesseract.js` in `apps/api/src/services/ocr/tesseractOcr.ts` (`por+eng`) | Full-page text → `brazilIdParse` heuristics; first run downloads traineddata (needs network) |
| Better OCR | **PaddleOCR** (Python sidecar or ONNX) | Phase 1.5 if Tesseract is too weak on IDs |
| Doc face ROI | **MediaPipe Face Detection** (server via WASM — heavier) or **OpenCV** + DNN face model | Crop before embedding |
| Live liveness (2D) | **MediaPipe Face Landmarker** (already in web) | Blink / movement / mouth metrics |
| Match | Normalized crop embeddings + cosine (your `faceMatch.ts` pattern) | MVP similarity; upgrade model later |
| Breath liveness | Your **useBreathEngine** correlation | Send aggregates to API; server checks thresholds |

---

## 7. Validators (your own, required for “functional”)

Implement **pure functions** after OCR returns a string (and optionally structured blocks):

1. **CPF** (Brazil): strip mask → 11 digits → **official check digits**; reject invalid.
2. **Date of birth**: parse `DD/MM/YYYY`; reasonable age range (e.g. 16–120).
3. **Document number**: pattern per `CNH` vs `RG` (MVP: length + charset; tighten with samples).
4. **Name**: non-empty after trim; max length; reject if equal to a field label line.
5. **Cross-check**: OCR confidence below floor → force re-capture or manual review flag.

**Policy:** `document/confirm` **re-runs validators** on user-edited text so the client cannot bypass.

---

## 8. Security & compliance (MVP checklist)

- Encrypt PII fields at rest (`documentResult`, templates, face/breath outcomes).
- Delete uploaded files from disk **after** processing (you already unlink).
- Short **session TTL** (`expiresAt`); reject stale steps.
- Do not log raw OCR text or base64 images in production.
- Document in privacy policy: purpose, retention, user rights (LGPD if Brazil).

---

## 9. Acceptance criteria (testable)

- [ ] Invalid CPF from OCR or user edit → **confirm** rejected with clear error.
- [ ] Document upload produces a portrait template; face step **fails** if template missing.
- [ ] Face pass requires liveness ≥ X and match ≥ Y (document your X/Y).
- [ ] Breath **cannot** complete if face did not pass.
- [ ] Successful path sets `status` to `COMPLETED` and webhook fires (if enabled).
- [ ] Full flow works on Chrome + Safari mobile (camera + mic permissions).

---

## 10. Suggested implementation order (2–3 sprints)

1. **OCR interface + Tesseract** + BR parsers + **validators** on `document` + `document/confirm`.
2. **Face ROI** on document image (detector or improved crop) → same embedding pipeline.
3. **Face live** crop (optional) + tune match threshold on real devices.
4. **Breath** payload: extend API with audio/visual summaries; fix client “progress to complete” so it matches real breathing duration.
5. Hardening: rate limits, session expiry, structured errors, minimal E2E test.

---

## 11. Map to your current app

| Your ask | Already in repo |
|----------|-----------------|
| Step order | `apps/web/app/verify/page.tsx` |
| Document upload + mock OCR | `DocumentStep` + `routes/document.ts` → replace mock with OCR service |
| Portrait / match | `documentFaceTemplate` + `faceMatch.ts` + `routes/face.ts` |
| Live mesh + breath UI | `FacialStep` + `BreathStep` + `useBreathEngine` |

This structure is the **backbone** for a fully functional MVP; individual engines (Tesseract vs Google, simple embedding vs vendor face) are **pluggable** behind the same routes and session model.
