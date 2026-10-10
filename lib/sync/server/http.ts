/**
 * Small route-handler plumbing shared by every /api route: size-capped JSON body parsing, JSON
 * responses (always `no-store`, the data is per-user) and uniform error handling.
 */
import { ApiHttpError, errorToResponse } from "./errors"

export type RouteHandler = (req: Request) => Promise<Response>

/** Wraps a handler so thrown ApiHttpError / ZodError / unknown errors become ApiError responses. */
export function withApiHandler(handler: RouteHandler): RouteHandler {
  return async (req) => {
    try {
      return await handler(req)
    } catch (error) {
      return errorToResponse(error)
    }
  }
}

/**
 * Default cap for JSON request bodies. Next.js route handlers enforce no body limit of their own
 * (only server actions and proxy do), so every handler reads through {@link readJsonBody}.
 */
export const MAX_JSON_BODY_BYTES = 1024 * 1024

function payloadTooLarge(maxBytes: number): ApiHttpError {
  return new ApiHttpError(
    "payload_too_large",
    `Request body is larger than ${Math.floor(maxBytes / 1024)} KB.`,
    413
  )
}

/**
 * Reads the body as UTF-8 text, refusing (413) anything over `maxBytes` before it is buffered:
 * a declared Content-Length is checked up front and the stream is counted as it arrives, so a
 * chunked upload without a length cannot slip past the cap.
 */
async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes)
    throw payloadTooLarge(maxBytes)
  if (!req.body) return ""

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw payloadTooLarge(maxBytes)
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** Parses a JSON body of at most `maxBytes`; 413 when larger, 400 when it is not valid JSON. */
export async function readJsonBody(
  req: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES
): Promise<unknown> {
  const text = await readBodyText(req, maxBytes)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiHttpError(
      "invalid_json",
      "Request body must be valid JSON.",
      400
    )
  }
}

export function json<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set("cache-control", "no-store")
  return Response.json(body, { ...init, headers })
}
