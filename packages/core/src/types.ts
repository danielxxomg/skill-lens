export type SkillScope = "global" | "project" | "package" | "unknown"

/** Where the availability list came from: the session prompt, the location catalog, or pi. */
export type SkillSource = "prompt" | "catalog" | "pi"

export interface SkillRef {
  /** Effective skill name: the one the harness would load. */
  name: string
  description?: string
  /** Winning path, when the harness exposes one. */
  path?: string
  scope: SkillScope
  source: SkillSource
  /** Paths of same-name skills that lost the collision. */
  shadowed: string[]
}

export type UsageMethod = "tool" | "command" | "read"

export interface UsageEntry {
  name: string
  methods: Partial<Record<UsageMethod, number>>
  /** Failed loads for this skill. Never hidden. */
  failed: number
}

export interface SessionSkills {
  available: SkillRef[]
  used: UsageEntry[]
}

export type SessionRunState = "running" | "idle" | "done" | "failed" | "unknown"

export interface SessionNode {
  id: string
  title?: string
  agent?: string
  parentID?: string
  state: SessionRunState
  skills: SessionSkills
  children: SessionNode[]
}

export interface SkillSetDiff {
  added: string[]
  removed: string[]
  same: boolean
}
