import { describe, expect, it } from "vitest"

import { effectiveSkills, parseAvailableSkillsBlock, recordUsage, sortSkills, usageTotal } from "./skills.ts"
import { buildTree, diffSkillSets, formatDiff } from "./tree.ts"
import type { SessionNode, SkillRef } from "./types.ts"

function ref(name: string, path: string, extra: Partial<SkillRef> = {}): SkillRef {
  return {
    name,
    path,
    scope: "global",
    source: "catalog",
    shadowed: [],
    ...extra,
  }
}

describe("effectiveSkills", () => {
  it("keeps the first occurrence as winner and records later paths as shadowed", () => {
    const merged = effectiveSkills([
      ref("go-testing", "/home/me/.config/opencode/skills/go-testing/SKILL.md"),
      ref("go-testing", "/home/me/.agents/skills/go-testing/SKILL.md"),
      ref("grilling", "/home/me/.agents/skills/grilling/SKILL.md"),
    ])

    expect(merged).toHaveLength(2)
    const goTesting = merged.find((skill) => skill.name === "go-testing")
    expect(goTesting?.path).toBe("/home/me/.config/opencode/skills/go-testing/SKILL.md")
    expect(goTesting?.shadowed).toEqual(["/home/me/.agents/skills/go-testing/SKILL.md"])
  })

  it("does not duplicate a shadowed path that repeats", () => {
    const merged = effectiveSkills([
      ref("a", "/p/a"),
      ref("a", "/p/a"),
      ref("a", "/p/a"),
    ])
    expect(merged[0]?.shadowed).toEqual([])
  })
})

describe("parseAvailableSkillsBlock", () => {
  const prompt = [
    "Skills provide specialized instructions for specific tasks.",
    "<available_skills>",
    "  <skill>",
    "    <id>branch-pr</id>",
    "    <name>branch-pr</name>",
    "    <description>Create PRs. Trigger: opening a PR.</description>",
    "  </skill>",
    "  <skill>",
    "    <name>grilling</name>",
    "    <description>Stress-test a plan &amp; decisions.</description>",
    "  </skill>",
    "</available_skills>",
  ].join("\n")

  it("reads id/name/description pairs", () => {
    const skills = parseAvailableSkillsBlock(prompt)
    expect(skills.map((skill) => skill.name)).toEqual(["branch-pr", "grilling"])
    expect(skills[0]?.description).toBe("Create PRs. Trigger: opening a PR.")
    expect(skills[0]?.source).toBe("prompt")
  })

  it("decodes entities and falls back to id when name is missing", () => {
    const skills = parseAvailableSkillsBlock(
      "<available_skills><skill><id>only-id</id><description>a &lt;b&gt;</description></skill></available_skills>",
    )
    expect(skills[0]?.name).toBe("only-id")
    expect(skills[0]?.description).toBe("a <b>")
  })

  it("returns an empty list when the block is absent or empty", () => {
    expect(parseAvailableSkillsBlock("no skills here")).toEqual([])
    expect(parseAvailableSkillsBlock("<available_skills></available_skills>")).toEqual([])
  })
})

describe("recordUsage", () => {
  it("aggregates per method and keeps failures", () => {
    let used = recordUsage([], "go-testing", "tool")
    used = recordUsage(used, "go-testing", "tool")
    used = recordUsage(used, "go-testing", "read", true)

    expect(used).toEqual([
      { name: "go-testing", methods: { tool: 2, read: 1 }, failed: 1 },
    ])
    expect(usageTotal(used)).toEqual({ loads: 3, failed: 1 })
  })

  it("does not mutate the input list", () => {
    const original = recordUsage([], "a", "tool")
    recordUsage(original, "a", "tool")
    expect(original[0]?.methods.tool).toBe(1)
  })
})

describe("sortSkills", () => {
  it("puts used rows first and appends used-but-missing skills", () => {
    const rows = sortSkills({
      available: [ref("alpha", "/p/alpha"), ref("beta", "/p/beta")],
      used: [
        { name: "beta", methods: { tool: 1 }, failed: 0 },
        { name: "ghost", methods: { command: 1 }, failed: 0 },
      ],
    })
    expect(rows.map((row) => row.ref.name)).toEqual(["beta", "ghost", "alpha"])
  })
})

describe("buildTree", () => {
  function node(id: string, parentID: string | undefined, state: SessionNode["state"]): SessionNode {
    return {
      id,
      parentID,
      state,
      title: id,
      skills: { available: [], used: [] },
      children: [],
    }
  }

  it("nests children and grandchildren under the root", () => {
    const tree = buildTree(
      [node("root", undefined, "running"), node("child", "root", "done"), node("grand", "child", "running")],
      "root",
    )
    expect(tree?.children.map((child) => child.id)).toEqual(["child"])
    expect(tree?.children[0]?.children.map((child) => child.id)).toEqual(["grand"])
  })

  it("orders running children before finished ones", () => {
    const tree = buildTree(
      [node("root", undefined, "running"), node("done", "root", "done"), node("live", "root", "running")],
      "root",
    )
    expect(tree?.children.map((child) => child.id)).toEqual(["live", "done"])
  })

  it("drops orphans and returns undefined for an unknown root", () => {
    const tree = buildTree([node("orphan", "missing", "running")], "missing")
    expect(tree).toBeUndefined()
  })
})

describe("diffSkillSets", () => {
  it("reports additions, removals and equality", () => {
    expect(diffSkillSets(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
      same: false,
    })
    expect(diffSkillSets(["a"], ["a"])).toEqual({ added: [], removed: [], same: true })
  })
})

describe("formatDiff", () => {
  it("prints = when identical", () => {
    expect(formatDiff({ added: [], removed: [], same: true })).toEqual({ label: "=", detail: "" })
  })

  it("caps names per side and counts the rest", () => {
    const result = formatDiff(
      { added: ["a", "b", "c", "d"], removed: ["z"], same: false },
      3,
    )
    expect(result.label).toBe("+4/-1")
    expect(result.detail).toBe("+a, b, c +1 more  -z")
  })
})
