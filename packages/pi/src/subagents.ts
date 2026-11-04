import { existsSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SubagentRun, SubagentStep } from "./model.ts"

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
  }>
}

export interface LoadedRuns {
  runs: SubagentRun[]
  /** parent pi session id declared by each run's status.json */
  parentByRun: Map<string, string | undefined>
}

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

function toSteps(raw: NonNullable<RawStatus["steps"]>): SubagentStep[] {
  return raw.map((step) => ({
    ...(step.agent ? { agent: step.agent } : {}),
    ...(step.label ? { label: step.label } : {}),
    ...(step.status ? { status: step.status } : {}),
    ...(step.skills ? { skills: step.skills } : {}),
    ...(step.sessionFile ? { sessionFile: step.sessionFile } : {}),
  }))
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
