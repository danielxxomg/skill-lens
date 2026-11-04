import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { UsageEntry } from "../../core/src/index.ts"
import type { SubagentChild, SubagentRun, SubagentStep } from "./model.ts"
import { usageFromSessionText } from "./session-usage.ts"

interface RawChild {
  agent?: string
  state?: string
  status?: string
  sessionId?: string
  sessionFile?: string
}

interface RawStatus {
  runId?: string
  sessionId?: string
  state?: string
  startedAt?: number
  steps?: Array<{
    agent?: string
    label?: string
    status?: string
    skills?: string[]
    sessionFile?: string
    sessionId?: string
    children?: RawChild[]
  }>
}

export interface LoadedRuns {
  runs: SubagentRun[]
  /** parent pi session id declared by each run's status.json */
  parentByRun: Map<string, string | undefined>
}

const usageCache = new Map<string, { stamp: string; used: UsageEntry[] }>()
const idCache = new Map<string, { stamp: string; id: string | undefined }>()

function roots(): string[] {
  const base = tmpdir()
  const found: string[] = []
  try {
    for (const entry of readdirSync(base)) {
      if (entry.startsWith("pi-subagents-")) found.push(join(base, entry, "async-subagent-runs"))
    }
  } catch {
    return []
  }
  return found.filter((dir) => existsSync(dir))
}

function parseStatus(path: string): RawStatus | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RawStatus
  } catch {
    return undefined
  }
}

/** Per-run usage, cached until the session file changes on disk. */
export function usageForSessionFile(path: string): UsageEntry[] | undefined {
  try {
    const stats = statSync(path)
    const stamp = `${stats.mtimeMs}:${stats.size}`
    const cached = usageCache.get(path)
    if (cached?.stamp === stamp) return cached.used
    const used = usageFromSessionText(readFileSync(path, "utf8"))
    usageCache.set(path, { stamp, used })
    return used
  } catch {
    return undefined
  }
}

/** Session id from the first line of a pi session file, cached by mtime+size. */
export function sessionIdForFile(path: string): string | undefined {
  try {
    const stats = statSync(path)
    const stamp = `${stats.mtimeMs}:${stats.size}`
    const cached = idCache.get(path)
    if (cached?.stamp === stamp) return cached.id
    const firstLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? ""
    const parsed = JSON.parse(firstLine) as { id?: string }
    const id = typeof parsed.id === "string" ? parsed.id : undefined
    idCache.set(path, { stamp, id })
    return id
  } catch {
    return undefined
  }
}

function toChildren(raw: RawChild[] | undefined): SubagentChild[] | undefined {
  if (!raw?.length) return undefined
  return raw.map((child) => {
    const sessionId = child.sessionId ?? (child.sessionFile ? sessionIdForFile(child.sessionFile) : undefined)
    return {
      ...(child.agent ? { agent: child.agent } : {}),
      ...(child.status ?? child.state ? { status: child.status ?? child.state } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(child.sessionFile ? { used: usageForSessionFile(child.sessionFile) ?? [] } : {}),
    }
  })
}

function toSteps(raw: NonNullable<RawStatus["steps"]>): SubagentStep[] {
  return raw.map((step) => {
    const sessionId = step.sessionId ?? (step.sessionFile ? sessionIdForFile(step.sessionFile) : undefined)
    const children = toChildren(step.children)
    return {
      ...(step.agent ? { agent: step.agent } : {}),
      ...(step.label ? { label: step.label } : {}),
      ...(step.status ? { status: step.status } : {}),
      ...(step.skills ? { skills: step.skills } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(children ? { children } : {}),
      ...(step.sessionFile
        ? { sessionFile: step.sessionFile, used: usageForSessionFile(step.sessionFile) ?? [] }
        : {}),
    }
  })
}

/**
 * pi-subagents keeps every run in a per-user temp root, not per session; the
 * parent session id inside status.json is the only attribution we trust.
 */
export function loadRuns(): LoadedRuns {
  const runs: SubagentRun[] = []
  const parentByRun = new Map<string, string | undefined>()

  for (const root of roots()) {
    let entries: string[] = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const status = parseStatus(join(root, entry, "status.json"))
      if (!status?.runId) continue
      runs.push({
        runId: status.runId,
        state: status.state ?? "unknown",
        ...(typeof status.startedAt === "number" ? { startedAt: status.startedAt } : {}),
        steps: toSteps(status.steps ?? []),
      })
      parentByRun.set(status.runId, status.sessionId)
    }
  }

  return { runs, parentByRun }
}
