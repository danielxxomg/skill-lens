import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { sessionIdForFile } from "./subagents.ts"

describe("sessionIdForFile", () => {
  it("reads the id from the session header", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-lens-"))
    try {
      const file = join(dir, "session.jsonl")
      writeFileSync(file, `${JSON.stringify({ type: "session", id: "grand-id" })}\n`, "utf8")
      expect(sessionIdForFile(file)).toBe("grand-id")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("returns undefined for missing or malformed files", () => {
    expect(sessionIdForFile("/nope/missing.jsonl")).toBeUndefined()
  })
})
