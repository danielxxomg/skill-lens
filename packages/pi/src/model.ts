import { diffSkillSets, effectiveSkills, formatDiff, progressBar, recordUsage, usageTotal } from "../../core/src/index.ts"
import type { SessionNode, SkillRef, SkillScope, UsageEntry, UsageMethod } from "../../core/src/index.ts"

export interface PiSkill {
  name: string
  description?: string
  filePath?: string
  baseDir?: string
  sourceInfo?: { scope?: string }
}

export interface PiToolResult {
  toolName: string
  input?: Record<string, unknown>
  isError?: boolean
}

export interface SubagentChild {
  agent?: string
  status?: string
  sessionId?: string
  used?: UsageEntry[]
}

export interface SubagentStep {
  agent?: string
  label?: string
  status?: string
  skills?: string[]
  used?: UsageEntry[]
  sessionFile?: string
  sessionId?: string
  children?: SubagentChild[]
}

export interface SubagentRun {
  runId: string
  state: string
  startedAt?: number
  steps: SubagentStep[]
}

const SCOPE_MAP: Record<string, SkillScope> = {
  user: "global",
  project: "project",
  temporary: "unknown",
}

export function skillsToRefs(skills: readonly PiSkill[]): SkillRef[] {
  return effectiveSkills(
    skills.map((skill) => ({
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.filePath ? { path: skill.filePath } : {}),
      scope: SCOPE_MAP[skill.sourceInfo?.scope ?? ""] ?? "unknown",
      source: "pi" as const,
      shadowed: [],
    })),
  )
}

/** `/x/go-testing/SKILL.md` -> `go-testing`; any other file -> undefined. */
export function skillNameFromPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/")
  if (!normalized.endsWith("SKILL.md")) return undefined
  const segments = normalized.split("/").filter(Boolean)
  if (segments.length < 2) return undefined
  return segments[segments.length - 2]
}

/** pi 1.5.0 has no `skill` tool: model-initiated loads are `read` calls on SKILL.md. */
export function usageMethodForTool(toolName: string, input: Record<string, unknown>): UsageMethod | undefined {
  if (toolName === "skill") return "tool"
  if (toolName === "read" || toolName === "Read") {
    const path = input.path ?? input.filePath ?? input.file_path
    if (typeof path === "string") return "read"
  }
  return undefined
}

export function skillNameForTool(
  toolName: string,
  input: Record<string, unknown>,
  skills: readonly SkillRef[],
): string | undefined {
  if (toolName === "skill") {
    const name = input.name ?? input.id
    return typeof name === "string" ? name : undefined
  }
  const path = input.path ?? input.filePath ?? input.file_path
  if (typeof path !== "string") return undefined
  const fromPath = skillNameFromPath(path)
  if (!fromPath) return undefined
  // Prefer the registered skill whose file matches, so renamed dirs do not lie.
  const exact = skills.find((skill) => skill.path === path)
  return exact?.name ?? fromPath
}

/** Raw `/skill:name` input, observed before pi expands it. */
export function commandSkillName(text: string): string | undefined {
  const match = text.match(/^\/skill:([A-Za-z0-9._-]+)(?=\s|$)/)
  return match?.[1]
}

export function applyUsage(
  used: readonly UsageEntry[],
  skills: readonly SkillRef[],
  event: PiToolResult,
): UsageEntry[] {
  const input = event.input ?? {}
  const method = usageMethodForTool(event.toolName, input)
  if (!method) return [...used]
  const name = skillNameForTool(event.toolName, input, skills)
  if (!name) return [...used]
  return recordUsage(used, name, method, event.isError === true)
}

export function runsForSession(runs: readonly SubagentRun[], sessionId: string | undefined, parentIDByRun: ReadonlyMap<string, string | undefined>): SubagentRun[] {
  if (!sessionId) return []
  const rank = (run: SubagentRun): number => (run.state === "running" ? 0 : 1)
  return runs
    .filter((run) => parentIDByRun.get(run.runId) === sessionId)
    .sort((left, right) => rank(left) - rank(right) || (right.startedAt ?? 0) - (left.startedAt ?? 0))
}

export interface WidgetInput {
  skills: readonly SkillRef[]
  used: readonly UsageEntry[]
  runs: readonly SubagentRun[]
}

export function usageLabel(entry: UsageEntry): string {
  const total = Object.values(entry.methods).reduce((sum, count) => sum + (count ?? 0), 0)
  const methods = Object.entries(entry.methods)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([method, count]) => `${method} ${count}`)
    .join(", ")
  const failed = entry.failed > 0 ? ` !${entry.failed}` : ""
  return `${entry.name} x${total}${methods ? ` (${methods})` : ""}${failed}`
}

export function widgetLines(input: WidgetInput, maxLines = 9): string[] {
  const { loads } = usageTotal(input.used)
  const lines: string[] = [    `skills ${input.skills.length}/${input.used.length} ${progressBar(input.used.length, input.skills.length)}`,
  ]

  const usedNames = new Set(input.used.map((entry) => entry.name))
  for (const entry of [...input.used].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`● ${usageLabel(entry)}`)
  }

  const unused = input.skills.length - [...usedNames].filter((name) => input.skills.some((s) => s.name === name)).length
  if (unused > 0) lines.push(`○ ${unused} available without use`)

  const parentNames = input.skills.map((skill) => skill.name)
  const runs = input.runs.slice(0, 3)
  if (runs.length > 0) lines.push(`-- subagents (${input.runs.length})`)
  for (const run of runs) {
    for (const step of run.steps.slice(0, 2)) {
      const name = step.agent ?? step.label ?? "subagent"
      const diff = formatDiff(diffSkillSets(parentNames, step.skills ?? []))
      const usedCount = step.used ? usageTotal(step.used).loads : 0
      const identity = step.sessionId ?? run.runId
      const short = identity.length > 6 ? identity.slice(-6) : identity
      lines.push(
        `  ${name} · ${step.status ?? run.state} · ${step.skills?.length ?? 0} loaded · ${usedCount} used · #${short} ${diff.label}`,
      )
      if (diff.detail) lines.push(`    ${diff.detail}`)
      for (const entry of (step.used ?? []).slice(0, 2)) {
        lines.push(`    ● ${usageLabel(entry)}`)
      }
      for (const child of (step.children ?? []).slice(0, 2)) {
        const childId = child.sessionId ?? ""
        const childShort = childId.length > 6 ? childId.slice(-6) : childId
        const idPart = childShort ? ` · #${childShort}` : ""
        const usedPart = child.used ? ` · ${usageTotal(child.used).loads} used` : ""
        lines.push(`    ↳ ${child.agent ?? "subagent"} · ${child.status ?? "?"}${idPart}${usedPart}`)
      }
    }
  }

  if (input.runs.length > runs.length) lines.push(`  +${input.runs.length - runs.length} more runs`)
  return lines.slice(0, Math.max(1, maxLines))
}

export function subagentNodes(runs: readonly SubagentRun[], rootID: string, skills: readonly SkillRef[]): SessionNode[] {
  const nodes: SessionNode[] = []
  for (const run of runs) {
    run.steps.forEach((step, index) => {
      const id = `${run.runId}:${index}`
      const stepSkills = step.skills ?? []
      const available = skills.filter((skill) => stepSkills.includes(skill.name))
      nodes.push({
        id,
        parentID: rootID,
        ...(step.agent ? { agent: step.agent } : {}),
        ...(step.label ? { title: step.label } : {}),
        state: step.status === "running" ? "running" : step.status === "failed" ? "failed" : "done",
        skills: { available, used: [...(step.used ?? [])] },
        children: [],
      })
    })
  }
  return nodes
}
