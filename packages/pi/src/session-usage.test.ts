import { describe, expect, it } from "vitest"

import { usageFromSessionText } from "./session-usage.ts"

const line = (value: unknown): string => JSON.stringify(value)

const call = (id: string, name: string, input: Record<string, unknown>): string =>
  line({
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id, name, input }],
    },
  })

const result = (id: string, name: string, isError = false): string =>
  line({
    type: "message",
    message: { role: "toolResult", toolCallId: id, toolName: name, isError, content: [] },
  })

describe("usageFromSessionText", () => {
  it("joins assistant calls with tool results by id", () => {
    const used = usageFromSessionText(
      [
        call("c1", "read", { path: "/x/grilling/SKILL.md" }),
        result("c1", "read"),
        call("c2", "read", { path: "/x/grilling/SKILL.md" }),
        result("c2", "read", true),
      ].join("\n"),
    )

    expect(used).toEqual([{ name: "grilling", methods: { read: 2 }, failed: 1 }])
  })

  it("counts a skill tool call and ignores unrelated reads", () => {
    const used = usageFromSessionText(
      [
        call("c1", "skill", { id: "opencode" }),
        result("c1", "skill"),
        call("c2", "read", { path: "/repo/README.md" }),
        result("c2", "read"),
        call("c3", "bash", { command: "ls" }),
        result("c3", "bash"),
      ].join("\n"),
    )

    expect(used).toEqual([{ name: "opencode", methods: { tool: 1 }, failed: 0 }])
  })

  it("ignores tool results without a matching call and malformed lines", () => {
    const used = usageFromSessionText(
      ["not json", result("missing", "read"), call("c1", "read", { path: "/x/a/SKILL.md" })].join("\n"),
    )
    expect(used).toEqual([])
  })
})
