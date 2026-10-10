import { describe, expect, it } from "vitest"

import { ApiHttpError } from "./errors"
import { MAX_JSON_BODY_BYTES, readJsonBody } from "./http"

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    body,
    headers,
    // Required by undici for stream bodies.
    duplex: "half",
  } as RequestInit)
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]))
      else controller.close()
    },
  })
}

async function statusOf(promise: Promise<unknown>): Promise<number | "ok"> {
  try {
    await promise
    return "ok"
  } catch (error) {
    if (error instanceof ApiHttpError) return error.status
    throw error
  }
}

describe("readJsonBody", () => {
  it("parses a small JSON body", async () => {
    await expect(readJsonBody(post('{"a":[1,2,"é"]}'))).resolves.toEqual({
      a: [1, 2, "é"],
    })
  })

  it("rejects invalid or empty JSON with 400", async () => {
    expect(await statusOf(readJsonBody(post("{nope")))).toBe(400)
    expect(await statusOf(readJsonBody(post("")))).toBe(400)
  })

  it("rejects a declared Content-Length over the cap with 413 before reading", async () => {
    const req = post("{}", {
      "content-length": String(MAX_JSON_BODY_BYTES + 1),
    })
    expect(await statusOf(readJsonBody(req))).toBe(413)
  })

  it("rejects a streamed body without Content-Length once it passes the cap", async () => {
    const chunk = "x".repeat(64 * 1024)
    const req = post(streamOf(['{"pad":"', ...Array(20).fill(chunk), '"}']))
    expect(req.headers.get("content-length")).toBeNull()
    expect(await statusOf(readJsonBody(req, 512 * 1024))).toBe(413)
  })

  it("honours a per-route cap", async () => {
    const body = JSON.stringify({ pad: "x".repeat(2048) })
    expect(await statusOf(readJsonBody(post(body), 1024))).toBe(413)
    expect(await statusOf(readJsonBody(post(body), 4096))).toBe("ok")
  })
})
