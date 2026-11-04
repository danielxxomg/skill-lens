import { describe, expect, it } from "vitest"

import {
  applyUsage,
  commandSkillName,
  runsForSession,
  skillNameForTool,
  skillNameFromPath,
  skillsToRefs,
  subagentNodes,
  usageMethodForTool,
  widgetLines,
} from "./model.ts"
import type { PiSkill, SubagentRun } from "./model.ts"

const PI_SKILLS: PiSkill[] = [
  // Shape from pi 1.5.0 `before_agent_start.systemPromptOptions.skills`.
  {
    name: "go-testing",
    description: "Go patterns",
    filePath: "/home/me/.agents/skills/go-testing/SKILL.md",
    sourceInfo: { scope: "user" },
  },
  {
    name: "grilling",
    description: "Stress-test",
    filePath: "/repo/.pi/skills/grilling/SKILL.md",
    sourceInfo: { scope: "project" },
  },
  {
    name: "go-testing",
    description: "duplicate",
    filePath: "/repo/.agents/skills/go-testing/SKILL.md",
    sourceInfo: { scope: "project" },
  },
]

const refs = skillsToRefs(PI_SKILLS)

describe("skillsToRefs", () => {
  it("maps pi scopes and collapses duplicates", () => {
    expect(refs.map((ref) => ref.name)).toEqual(["go-testing", "grilling"])
    expect(refs[0]?.scope).toBe("global")
    expect(refs[0]?.shadowed).toEqual(["/repo/.agents/skills/go-testing/SKILL.md"])
    expect(refs[1]?.scope).toBe("project")
    expect(refs[0]?.source).toBe("pi")
  })
})

describe("skillNameFromPath", () => {
  it("only accepts SKILL.md files", () => {
    expect(skillNameFromPath("/a/b/grilling/SKILL.md")).toBe("grilling")
    expect(skillNameFromPath("/a/b/README.md")).toBeUndefined()
    expect(skillNameFromPath("SKILL.md")).toBeUndefined()
  })
})

describe("usageMethodForTool", () => {
  it("treats read on any path as a read and skill as a tool call", () => {
    expect(usageMethodForTool("read", { path: "/a/SKILL.md" })).toBe("read")
    expect(usageMethodForTool("skill", { name: "x" })).toBe("tool")
    expect(usageMethodForTool("bash", { command: "ls" })).toBeUndefined()
  })
})

describe("skillNameForTool", () => {
  it("prefers the registered skill matching the exact file", () => {
    expect(skillNameForTool("read", { path: "/repo/.agents/skills/go-testing/SKILL.md" }, refs)).toBe("go-testing")
  })

  it("falls back to the directory name and ignores non-skill files", () => {
    expect(skillNameForTool("read", { path: "/unknown/grilling/SKILL.md" }, refs)).toBe("grilling")
    expect(skillNameForTool("read", { path: "/repo/README.md" }, refs)).toBeUndefined()
    expect(skillNameForTool("skill", { id: "opencode" }, refs)).toBe("opencode")
  })
})

describe("commandSkillName", () => {
  it("reads the raw /skill: expansion", () => {
    expect(commandSkillName("/skill:grilling stress test this")).toBe("grilling")
  })

  it("rejects names pi would not expand", () => {
    expect(commandSkillName("  /skill:grilling")).toBeUndefined()
    expect(commandSkillName("skill:grilling")).toBeUndefined()
    expect(commandSkillName("/skill:grilling/extra")).toBeUndefined()
    expect(commandSkillName("hello")).toBeUndefined()
  })
})

describe("applyUsage", () => {
  it("records read-based loads and failures", () => {
    const used = applyUsage([], refs, {
      toolName: "read",
      input: { path: "/repo/.pi/skills/grilling/SKILL.md" },
      isError: false,
    })
    const failed = applyUsage(used, refs, {
      toolName: "read",
      input: { path: "/repo/.pi/skills/grilling/SKILL.md" },
      isError: true,
    })
    expect(failed).toEqual([{ name: "grilling", methods: { read: 2 }, failed: 1 }])
  })

  it("ignores unrelated tools", () => {
    expect(applyUsage([], refs, { toolName: "bash", input: { command: "ls" } })).toEqual([])
  })
})

describe("runsForSession", () => {
  const runs: SubagentRun[] = [
    { runId: "a", state: "running", startedAt: 10, steps: [] },
    { runId: "b", state: "complete", startedAt: 20, steps: [] },
    { runId: "c", state: "complete", startedAt: 30, steps: [] },
  ]
  const parents = new Map<string, string | undefined>([
    ["a", "ses_me"],
    ["b", "ses_me"],
    ["c", "ses_other"],
  ])

  it("keeps only the current parent, running first then newest", () => {
    expect(runsForSession(runs, "ses_me", parents).map((run) => run.runId)).toEqual(["a", "b"])
  })

  it("returns nothing without a session id", () => {
    expect(runsForSession(runs, undefined, parents)).toEqual([])
  })
})

describe("widgetLines", () => {
  it("lists used skills, an available remainder and subagent diffs", () => {
    const lines = widgetLines({
      skills: refs,
      used: [{ name: "grilling", methods: { read: 2 }, failed: 0 }],
      runs: [
        {
          runId: "r1",
          state: "running",
          steps: [{ agent: "explore", status: "running", skills: ["grilling", "extra"] }],
        },
      ],
    })

    expect(lines[0]).toBe("skills 2/1 ▰▰▰▰▰▱▱▱▱▱")
    expect(lines[1]).toBe("● grilling x2 (read 2)")
    expect(lines[2]).toBe("○ 1 available without use")
    expect(lines[3]).toBe("-- subagents (1)")
    expect(lines[4]).toBe("  explore · running · 2 loaded · 0 used · #r1 +1/-1")
  })

  it("lists the sub-agent's used skills under its row", () => {
    const lines = widgetLines({
      skills: refs,
      used: [],
      runs: [
        {
          runId: "r1",
          state: "running",
          steps: [
            {
              agent: "explore",
              status: "running",
              skills: ["grilling"],
              used: [{ name: "grilling", methods: { read: 2 }, failed: 0 }],
            },
          ],
        },
      ],
    })

    expect(lines).toContain("  explore · running · 1 loaded · 2 used · #r1 -1")
    expect(lines).toContain("    ● grilling x2 (read 2)")
  })

  it("renders grandchild rows with their session id and usage", () => {
    const lines = widgetLines(
      {
        skills: refs,
        used: [],
        runs: [
          {
            runId: "r1",
            state: "running",
            steps: [
              {
                agent: "explore",
                status: "running",
                children: [
                  {
                    agent: "grand",
                    status: "done",
                    sessionId: "ses_grandchild",
                    used: [{ name: "grilling", methods: { read: 2 }, failed: 0 }],
                  },
                ],
              },
            ],
          },
        ],
      },
      20,
    )

    expect(lines.join("\n")).toContain("↳ grand · done")
    expect(lines.join("\n")).toContain("2 used")
  })

  it("never exceeds maxLines", () => {
    const lines = widgetLines(
      {
        skills: refs,
        used: [{ name: "a", methods: { tool: 1 }, failed: 0 }],
        runs: [{ runId: "x", state: "running", steps: [{ agent: "a" }, { agent: "b" }, { agent: "c" }] }],
      },
      3,
    )
    expect(lines).toHaveLength(3)
  })
})

describe("subagentNodes", () => {
  it("turns run steps into session nodes with their loaded set", () => {
    const nodes = subagentNodes(
      [{ runId: "r1", state: "running", steps: [{ agent: "explore", status: "running", skills: ["grilling"] }] }],
      "root",
      refs,
    )
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.agent).toBe("explore")
    expect(nodes[0]?.parentID).toBe("root")
    expect(nodes[0]?.skills.available.map((skill) => skill.name)).toEqual(["grilling"])
    expect(nodes[0]?.state).toBe("running")
  })
})
