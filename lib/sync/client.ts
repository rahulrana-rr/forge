/**
 * Typed fetch helpers for the API contract in lib/sync/types.ts.
 * Same-origin, cookie-authenticated (better-auth), JSON in and out, 10s timeout.
 */
import type {
  DeleteWorkoutResponse,
  HistoryResponse,
  MeResponse,
  PostWorkoutRequest,
  PostWorkoutResponse,
  ProgressResponse,
  PutMeRequest,
  SyncRequest,
  SyncResponse,
} from "./types"

export const DEFAULT_TIMEOUT_MS = 10_000

export class ApiClientError extends Error {
  readonly code: string
  /** HTTP status, or 0 for network/timeout failures. */
  readonly status: number

  constructor(code: string, message: string, status = 0) {
    super(message)
    this.name = "ApiClientError"
    this.code = code
    this.status = status
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /** Network-level failures that a retry may fix (timeouts, lost connection, 5xx, 429). */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

function parseErrorBody(text: string, status: number): ApiClientError {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const err = (parsed as { error?: { code?: unknown; message?: unknown } })
        .error
      const code = typeof err?.code === "string" ? err.code : `http_${status}`
      const message =
        typeof err?.message === "string"
          ? err.message
          : `Request failed (${status})`
      return new ApiClientError(code, message, status)
    }
  } catch {
    // Not JSON; fall through.
  }
  return new ApiClientError(
    `http_${status}`,
    text || `Request failed (${status})`,
    status
  )
}

/** Performs a JSON request against the app's own API. Throws {@link ApiClientError} on any failure. */
export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  if (typeof fetch !== "function")
    throw new ApiClientError("unavailable", "fetch is not available", 0)
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onOuterAbort = () => controller.abort()
  options.signal?.addEventListener("abort", onOuterAbort, { once: true })

  try {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (options.body !== undefined) headers["Content-Type"] = "application/json"
    const res = await fetch(path, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      credentials: "include",
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw parseErrorBody(text, res.status)
    }
    if (res.status === 204) return undefined as T
    try {
      return (await res.json()) as T
    } catch {
      throw new ApiClientError(
        "bad_response",
        "Response was not valid JSON",
        res.status
      )
    }
  } catch (error) {
    if (isApiClientError(error)) throw error
    if (controller.signal.aborted) {
      const code = options.signal?.aborted ? "aborted" : "timeout"
      throw new ApiClientError(
        code,
        code === "timeout"
          ? `Request timed out after ${timeoutMs}ms`
          : "Request aborted",
        0
      )
    }
    throw new ApiClientError(
      "network",
      error instanceof Error ? error.message : "Network error",
      0
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", onOuterAbort)
  }
}

export const api = {
  getMe: (signal?: AbortSignal) => apiFetch<MeResponse>("/api/me", { signal }),
  putMe: (body: PutMeRequest, signal?: AbortSignal) =>
    apiFetch<MeResponse>("/api/me", { method: "PUT", body, signal }),
  postWorkout: (body: PostWorkoutRequest, signal?: AbortSignal) =>
    apiFetch<PostWorkoutResponse>("/api/workouts", {
      method: "POST",
      body,
      signal,
    }),
  syncWorkouts: (body: SyncRequest, signal?: AbortSignal) =>
    apiFetch<SyncResponse>("/api/workouts/sync", {
      method: "POST",
      body,
      signal,
    }),
  deleteWorkout: (id: string, signal?: AbortSignal) =>
    apiFetch<DeleteWorkoutResponse>(
      `/api/workouts/${encodeURIComponent(id)}`,
      { method: "DELETE", signal }
    ),
  getHistory: (cursor?: string | null, limit = 50, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set("cursor", cursor)
    return apiFetch<HistoryResponse>(
      `/api/workouts/history?${params.toString()}`,
      { signal }
    )
  },
  getProgress: (signal?: AbortSignal) =>
    apiFetch<ProgressResponse>("/api/progress", { signal }),
}
