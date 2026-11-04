import { effectiveSkills, progressBar, recordUsage, sortSkills, usageTotal } from "../../core/src/index.ts"
import type { SessionNode, SkillRef, SkillScope, UsageEntry } from "../../core/src/index.ts"

export interface CatalogSkill {
  name: string
  description?: string
  path: string
}

export interface SessionInfoLike {
  id: string
  parentID?: string
  title?: string
  agent?: string
  time?: { created?: number; updated?: number; busy?: number; idle?: number }
}

interface ToolPart {
  type: "tool"
  name?: string
  state?: { status?: string; input?: Record<string, unknown> }
}

export interface MessageLike {
  type?: string
  role?: string
  content?: readonly unknown[]
}

export interface PanelRow {
  label: string
  kind: "used" | "available" | "child"
  indent: number
}

export interface PanelModel {
  statusline: string
  availableCount: number
  usedCount: number
  rows: PanelRow[]
  footnote: string
}

export function scopeFromPath(path: string, cwd: string): SkillScope {
  const root = cwd.replace(/\/+$/, "")
  if (root && (path === root || path.startsWith(`${root}/`))) return "project"
  if (path.includes("/node_modules/")) return "package"
  if (path.startsWith("/")) return "global"
  return "unknown"
}

export function catalogToRefs(catalog: readonly CatalogSkill[], cwd: string): SkillRef[] {
  return effectiveSkills(
    catalog.map((skill) => ({
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      path: skill.path,
      scope: scopeFromPath(skill.path, cwd),
      source: "catalog" as const,
      shadowed: [],
    })),
  )
}

/** `/x/y/go-testing/SKILL.md` -> `go-testing`; anything else -> undefined. */
export function skillNameFromPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/")
  if (!normalized.endsWith("SKILL.md")) return undefined
  const segments = normalized.split("/").filter(Boolean)
  if (segments.length < 2) return undefined
  return segments[segments.length - 2]
}

function pickString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

/**
 * Walk assistant tool parts and aggregate skill loads.
 *
 * OpenCode records the `skill` tool with `{ id }` as input and a `completed|error`
 * state; `read` calls carry `{ path }`. Anything else is ignored on purpose.
 */
export function usageFromMessages(messages: readonly MessageLike[]): UsageEntry[] {
  let used: UsageEntry[] = []

  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const raw of message.content ?? []) {
      const part = raw as ToolPart
      if (part?.type !== "tool" || !part.name) continue
      const input = part.state?.input ?? {}
      const failed = part.state?.status === "error"

      if (part.name === "skill") {
        const name = pickString(input, ["id", "name"])
        if (name) used = recordUsage(used, name, "tool", failed)
        continue
      }

      if (part.name === "read" || part.name === "Read") {
        const path = pickString(input, ["path", "filePath", "file_path"])
        const name = path ? skillNameFromPath(path) : undefined
        if (name) used = recordUsage(used, name, "read", failed)
      }
    }
  }

  return used
}

function sessionState(info: SessionInfoLike): SessionNode["state"] {
  if (info.time?.busy && !info.time?.idle) return "running"
  if (info.time?.idle) return "idle"
  return "unknown"
}

export function sessionNode(
  info: SessionInfoLike,
  available: readonly SkillRef[],
  used: readonly UsageEntry[],
): SessionNode {
  return {
    id: info.id,
    ...(info.parentID ? { parentID: info.parentID } : {}),
    ...(info.title ? { title: info.title } : {}),
    ...(info.agent ? { agent: info.agent } : {}),
    state: sessionState(info),
    skills: { available: [...available], used: [...used] },
    children: [],
  }
}

/** One compact line per used skill: `go-testing x2 (tool 2)`. */
export function usageLabel(entry: UsageEntry): string {
  const parts = Object.entries(entry.methods)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([method, count]) => `${method} ${count}`)
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : ""
  const failures = entry.failed > 0 ? ` !${entry.failed}` : ""
  const total = Object.values(entry.methods).reduce((sum, count) => sum + (count ?? 0), 0)
  return `${entry.name} x${total}${suffix}${failures}`
}

export function buildPanelModel(input: {
  sessionID: string
  available: readonly SkillRef[]
  used: readonly UsageEntry[]
  tree: SessionNode | undefined
}): PanelModel {
  const rows: PanelRow[] = []
  const { loads } = usageTotal(input.used)

  for (const row of sortSkills({ available: [...input.available], used: [...input.used] })) {
    if (row.usage) {
      rows.push({ label: `● ${usageLabel(row.usage)}`, kind: "used", indent: 0 })
    } else {
      const badge = row.ref.shadowed.length > 0 ? ` x${row.ref.shadowed.length + 1}` : ""
      rows.push({
        label: `○ ${row.ref.name}${badge} · ${row.ref.scope}`,
        kind: "available",
        indent: 0,
      })
    }
  }

  const walk = (node: SessionNode, depth: number): void => {
    for (const child of node.children) {
      const shortId = child.id.length > 8 ? child.id.slice(-6) : child.id
      const label = child.title ?? child.agent ?? child.id
      rows.push({
        label: `${label} · ${child.state} · ${child.skills.used.length} used · #${shortId}`,
        kind: "child",
        indent: depth,
      })
      for (const entry of child.skills.used.slice(0, 3)) {
        rows.push({ label: `● ${usageLabel(entry)}`, kind: "child", indent: depth + 1 })
      }
      walk(child, depth + 1)
    }
  }
  if (input.tree) walk(input.tree, 1)

  const children = input.tree ? countDescendants(input.tree) : 0
  return {
    statusline: `skills ${input.available.length}/${loads} ${progressBar(loads, input.available.length)}`,
    availableCount: input.available.length,
    usedCount: loads,
    rows,
    footnote: `${children} sub-agent(s) · source catalog`,
  }
}

export function countDescendants(node: SessionNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}
