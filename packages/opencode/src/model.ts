import { diffSkillSets, effectiveSkills, formatDiff, progressBar, recordUsage, sortSkills, usageTotal } from "../../core/src/index.ts"
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

export type PanelRowKind = "used" | "available" | "child" | "section" | "path"

export interface PanelRow {
  label: string
  kind: PanelRowKind
  indent: number
}

export interface PanelModel {
  statusline: string
  availableCount: number
  /** distinct skills that were loaded at least once */
  usedCount: number
  /** total load events, failures included */
  loads: number
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

/**
 * `busy` and `idle` are timestamps that persist across runs: a session that
 * started a new run after finishing one has both set, and `busy > idle` is the
 * only reliable running signal.
 */
export function sessionState(info: SessionInfoLike): SessionNode["state"] {
  const busy = info.time?.busy ?? 0
  const idle = info.time?.idle ?? 0
  if (busy > idle) return "running"
  if (idle > 0) return "idle"
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

function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6) : id
}

export function buildPanelModel(
  input: {
    sessionID: string
    available: readonly SkillRef[]
    used: readonly UsageEntry[]
    tree: SessionNode | undefined
  },
  options: { detail?: boolean } = {},
): PanelModel {
  const detail = options.detail === true
  const rows: PanelRow[] = []
  const byName = new Map(input.available.map((ref) => [ref.name, ref]))
  const { loads } = usageTotal(input.used)

  const sorted = sortSkills({ available: [...input.available], used: [...input.used] })
  const usedRows = sorted.filter((row) => row.usage)
  const availableRows = sorted.filter((row) => !row.usage)

  if (detail) rows.push({ label: `Used (${usedRows.length})`, kind: "section", indent: 0 })
  for (const row of usedRows) {
    const ref = byName.get(row.ref.name)
    const badge = ref && ref.shadowed.length > 0 ? ` x${ref.shadowed.length + 1}` : ""
    rows.push({ label: `● ${usageLabel(row.usage!)}${badge}`, kind: "used", indent: 0 })
    if (detail) {
      if (ref?.path) rows.push({ label: ref.path, kind: "path", indent: 1 })
      for (const path of ref?.shadowed ?? []) rows.push({ label: path, kind: "path", indent: 1 })
    }
  }

  if (detail) rows.push({ label: `Available (${availableRows.length})`, kind: "section", indent: 0 })
  for (const row of availableRows) {
    const badge = row.ref.shadowed.length > 0 ? ` x${row.ref.shadowed.length + 1}` : ""
    rows.push({ label: `○ ${row.ref.name}${badge} · ${row.ref.scope}`, kind: "available", indent: 0 })
    if (detail) {
      if (row.ref.path) rows.push({ label: row.ref.path, kind: "path", indent: 1 })
      for (const path of row.ref.shadowed) rows.push({ label: path, kind: "path", indent: 1 })
    }
  }

  const walk = (node: SessionNode, depth: number, parentAvailable: readonly SkillRef[]): void => {
    for (const child of node.children) {
      const diff = formatDiff(
        diffSkillSets(
          parentAvailable.map((skill) => skill.name),
          child.skills.available.map((skill) => skill.name),
        ),
      )
      const label = child.title ?? child.agent ?? child.id
      rows.push({
        label: `${label} · ${child.state} · ${child.skills.used.length} used · #${shortId(child.id)} ${diff.label}`,
        kind: "child",
        indent: depth,
      })
      if (detail && diff.detail) {
        rows.push({ label: diff.detail, kind: "path", indent: depth + 1 })
      }
      for (const entry of child.skills.used.slice(0, detail ? 50 : 3)) {
        rows.push({ label: `● ${usageLabel(entry)}`, kind: "child", indent: depth + 1 })
      }
      walk(child, depth + 1, child.skills.available)
    }
  }
  if (input.tree) walk(input.tree, 1, input.tree.skills.available)

  const children = input.tree ? countDescendants(input.tree) : 0
  return {
    statusline: `skills ${input.available.length}/${usedRows.length} ${progressBar(usedRows.length, input.available.length)}`,
    availableCount: input.available.length,
    usedCount: usedRows.length,
    loads,
    rows,
    footnote: `${children} sub-agent(s) · source catalog`,
  }
}

export function countDescendants(node: SessionNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}
