import { describe, expect, it } from "vitest"

import {
  buildPanelModel,
  catalogToRefs,
  countDescendants,
  sessionNode,
  sessionState,
  skillNameFromPath,
  usageFromMessages,
  usageLabel,
} from "./model.ts"
import { buildTree } from "../../core/src/index.ts"

// Shapes below mirror a live OpenCode 2.2.5 capture: assistant content holds
// `{ type: "tool", name, state: { status, input } }`, with `{ id }` for `skill`
// and `{ path }` for `read` (verified against /api/session/<id>/context).

const CATALOG = [
  { name: "go-testing", description: "Go test patterns", path: "/home/me/.config/opencode/skills/go-testing/SKILL.md" },
  { name: "go-testing", description: "dup", path: "/home/me/.agents/skills/go-testing/SKILL.md" },
  { name: "grilling", description: "Stress-test a plan", path: "/home/me/.agents/skills/grilling/SKILL.md" },
  { name: "local-only", path: "/repo/.opencode/skills/local-only/SKILL.md" },
]

function assistant(content: unknown[]): { type: string; content: unknown[] } {
  return { type: "assistant", content }
}

describe("catalogToRefs", () => {
  it("collapses duplicates and derives scope from the path", () => {
    const refs = catalogToRefs(CATALOG, "/repo")
    expect(refs.map((ref) => ref.name)).toEqual(["go-testing", "grilling", "local-only"])
    expect(refs[0]?.shadowed).toEqual(["/home/me/.agents/skills/go-testing/SKILL.md"])
    expect(refs[0]?.scope).toBe("global")
    expect(refs[2]?.scope).toBe("project")
    expect(refs[0]?.source).toBe("catalog")
  })
})

describe("skillNameFromPath", () => {
  it("reads the directory name of a SKILL.md", () => {
    expect(skillNameFromPath("/a/b/go-testing/SKILL.md")).toBe("go-testing")
    expect(skillNameFromPath("C:\\skills\\grilling\\SKILL.md")).toBe("grilling")
    expect(skillNameFromPath("/a/b/README.md")).toBeUndefined()
    expect(skillNameFromPath("SKILL.md")).toBeUndefined()
  })
})

describe("usageFromMessages", () => {
  it("counts the skill tool by id and read calls by SKILL.md path", () => {
    const used = usageFromMessages([
      assistant([
        { type: "text", text: "hi" },
        { type: "tool", name: "skill", state: { status: "completed", input: { id: "opencode" } } },
        { type: "tool", name: "read", state: { status: "completed", input: { path: "/a/b/grilling/SKILL.md" } } },
        { type: "tool", name: "shell", state: { status: "completed", input: { command: "ls" } } },
        { type: "tool", name: "read", state: { status: "completed", input: { path: "/repo/README.md" } } },
      ]),
      { type: "user", content: [{ type: "text", text: "skill:grilling" }] },
    ])

    expect(used).toEqual([
      { name: "opencode", methods: { tool: 1 }, failed: 0 },
      { name: "grilling", methods: { read: 1 }, failed: 0 },
    ])
  })

  it("marks failed skill loads instead of hiding them", () => {
    const used = usageFromMessages([
      assistant([{ type: "tool", name: "skill", state: { status: "error", input: { id: "missing" } } }]),
    ])
    expect(used).toEqual([{ name: "missing", methods: { tool: 1 }, failed: 1 }])
  })
})

describe("usageLabel", () => {
  it("summarizes methods and failures", () => {
    expect(usageLabel({ name: "go-testing", methods: { tool: 2, read: 1 }, failed: 1 })).toBe(
      "go-testing x3 (tool 2, read 1) !1",
    )
  })
})

describe("panel model", () => {
  const available = catalogToRefs(CATALOG, "/repo")
  const root = sessionNode(
    { id: "root", title: "main", time: { busy: 1 } },
    available,
    [{ name: "grilling", methods: { read: 2 }, failed: 0 }],
  )
  const child = sessionNode(
    { id: "child", parentID: "root", title: "explore", agent: "explore", time: { idle: 1 } },
    available,
    [{ name: "go-testing", methods: { tool: 1 }, failed: 0 }],
  )
  const tree = buildTree([root, child], "root")

  it("puts used rows first, then available, then children", () => {
    const model = buildPanelModel({
      sessionID: "root",
      available,
      used: root.skills.used,
      tree,
    })
    expect(model.rows[0]).toEqual({ label: "● grilling x2 (read 2)", kind: "used", indent: 0 })
    expect(model.rows[1]?.kind).toBe("available")
    expect(model.rows.at(-1)?.kind).toBe("child")
    expect(model.rows.at(-1)?.label).toBe("● go-testing x1 (tool 1)")
    expect(model.rows.at(-1)?.indent).toBe(2)
    expect(model.statusline.startsWith("skills 3/1")).toBe(true)
    expect(model.usedCount).toBe(1)
    expect(model.footnote).toContain("1 sub-agent(s)")
  })

  it("counts nested descendants", () => {
    expect(countDescendants(tree!)).toBe(1)
  })

  it("labels children with diff, state and short id", () => {
    const model = buildPanelModel({ sessionID: "root", available, used: [], tree })
    const child = model.rows.find((row) => row.kind === "child")
    expect(child?.label).toContain("#child")
    expect(child?.label).toContain("=")
  })

  it("badges used rows whose name is shadowed", () => {
    const model = buildPanelModel({
      sessionID: "root",
      available,
      used: [{ name: "go-testing", methods: { tool: 1 }, failed: 0 }],
      tree: undefined,
    })
    expect(model.rows[0]?.label).toBe("● go-testing x1 (tool 1) x2")
  })

  it("detail model adds sections and every path", () => {
    const model = buildPanelModel(
      {
        sessionID: "root",
        available,
        used: [{ name: "go-testing", methods: { tool: 1 }, failed: 0 }],
        tree: undefined,
      },
      { detail: true },
    )
    const text = JSON.stringify(model.rows)
    expect(text).toContain("Used (1)")
    expect(text).toContain("Available (2)")
    expect(text).toContain("/home/me/.config/opencode/skills/go-testing/SKILL.md")
    expect(text).toContain("/home/me/.agents/skills/go-testing/SKILL.md")
  })
})

describe("sessionState", () => {
  it("uses busy > idle instead of presence", () => {
    expect(sessionState({ id: "x", time: { busy: 20, idle: 10 } })).toBe("running")
    expect(sessionState({ id: "x", time: { busy: 10, idle: 20 } })).toBe("idle")
    expect(sessionState({ id: "x", time: {} })).toBe("unknown")
  })
})
