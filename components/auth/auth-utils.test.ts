import { describe, expect, it } from "vitest"

import { describeAuthError, describeAuthRedirectError } from "./auth-utils"

describe("describeAuthRedirectError", () => {
  it("maps known better-auth redirect codes to plain sentences", () => {
    expect(describeAuthRedirectError("INVALID_TOKEN")).toMatch(
      /expired or was already used/
    )
    expect(describeAuthRedirectError("access_denied")).toMatch(/cancelled/)
    expect(describeAuthRedirectError("EMAIL_NOT_VERIFIED")).toMatch(
      /verify your email/
    )
  })

  it("never echoes an unknown code from the URL", () => {
    const injected = "<script>alert(1)</script>"
    const text = describeAuthRedirectError(injected)
    expect(text).not.toContain(injected)
    expect(text).toBe("Sign-in didn't finish. Try again.")
  })
})

describe("describeAuthError", () => {
  it("prefers known codes, then status, then the message, then the fallback", () => {
    expect(
      describeAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" }, "x")
    ).toMatch(/don't match/)
    expect(describeAuthError({ status: 429 }, "x")).toMatch(/Too many attempts/)
    expect(describeAuthError({ message: "  Custom  " }, "x")).toBe("Custom")
    expect(describeAuthError(null, "fallback")).toBe("fallback")
  })
})
