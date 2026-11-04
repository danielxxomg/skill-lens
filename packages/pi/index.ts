import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

import { recordUsage } from "../core/src/index.ts"
import type { SkillRef, UsageEntry } from "../core/src/index.ts"
import {
  applyUsage,
  commandSkillName,
  runsForSession,
  skillsToRefs,
  usageLabel,
  widgetLines,
} from "./src/model.ts"
import type { PiSkill, SubagentRun } from "./src/model.ts"
import { usageFromEntries } from "./src/session-usage.ts"
import { loadRuns } from "./src/subagents.ts"

const WIDGET_KEY = "skill-lens"
const STATUS_KEY = "skill-lens"
const POLL_MS = 1500
const DEBOUNCE_MS = 150

export default function skillLens(pi: ExtensionAPI) {
  let skills: SkillRef[] = []
  let used: UsageEntry[] = []
  let runs: SubagentRun[] = []
  let parentByRun: ReadonlyMap<string, string | undefined> = new Map()
  let sessionId: string | undefined
  let uiContext: ExtensionContext | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let lastWidget = ""

  const visibleRuns = (): SubagentRun[] => runsForSession(runs, sessionId, parentByRun)

  const render = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return
    const lines = widgetLines({ skills, used, runs: visibleRuns() })
    const signature = lines.join("\n")
    if (signature !== lastWidget) {
      lastWidget = signature
      ctx.ui.setWidget(WIDGET_KEY, lines)
    }
    ctx.ui.setStatus(STATUS_KEY, `skills ${skills.length}/${used.length}`)
  }

  const schedule = (): void => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      if (uiContext) render(uiContext)
    }, DEBOUNCE_MS)
  }

  const refreshRuns = (): void => {
    const loaded = loadRuns()
    runs = loaded.runs
    parentByRun = loaded.parentByRun
    schedule()
  }

  pi.on("session_start", async (event: any, ctx: ExtensionContext) => {
    uiContext = ctx
    sessionId = ctx.sessionManager.getSessionId()
    // A replaced session must not inherit the previous one's counters; a resumed
    // session recovers usage from its own stored entries and keeps the catalog.
    if (event?.reason === "new") {
      skills = []
      used = []
    } else {
      used = usageFromEntries(ctx.sessionManager.getEntries?.() ?? [])
    }
    refreshRuns()
    if (poll) clearInterval(poll)
    poll = setInterval(refreshRuns, POLL_MS)
  })

  pi.on("session_shutdown", async () => {
    if (poll) clearInterval(poll)
    if (debounce) clearTimeout(debounce)
    poll = undefined
    debounce = undefined
  })

  pi.on("before_agent_start", async (event: any, ctx: ExtensionContext) => {
    uiContext = ctx
    const available = (event?.systemPromptOptions?.skills ?? []) as PiSkill[]
    skills = skillsToRefs(available)
    schedule()
  })

  pi.on("tool_result", async (event: any, ctx: ExtensionContext) => {
    uiContext = ctx
    used = applyUsage(used, skills, {
      toolName: String(event?.toolName ?? ""),
      input: (event?.input ?? {}) as Record<string, unknown>,
      isError: event?.isError === true,
    })
    schedule()
  })

  pi.on("input", async (event: any, ctx: ExtensionContext) => {
    uiContext = ctx
    const name = commandSkillName(String(event?.text ?? ""))
    if (name) {
      // Before the first prompt the catalog is empty, so "unknown" is not a failure.
      const known = skills.length === 0 || skills.some((skill) => skill.name === name)
      used = recordUsage(used, name, "command", !known)
      schedule()
    }
  })

  pi.registerCommand("skills", {
    description: "List available and loaded skills",
    handler: async (_args: string, ctx: any) => {
      const fresh = (ctx.getSystemPromptOptions?.().skills ?? []) as PiSkill[]
      if (fresh.length > 0) skills = skillsToRefs(fresh)

      const usedByName = new Map(used.map((entry) => [entry.name, entry]))
      const entries: Array<{ label: string; detail: string }> = []

      for (const skill of [...skills].sort((left, right) => {
        const leftUsed = usedByName.has(left.name) ? 0 : 1
        const rightUsed = usedByName.has(right.name) ? 0 : 1
        return leftUsed - rightUsed || left.name.localeCompare(right.name)
      })) {
        const usage = usedByName.get(skill.name)
        const mark = usage ? "●" : "○"
        const count = usage ? ` x${Object.values(usage.methods).reduce((sum, n) => sum + (n ?? 0), 0)}` : ""
        const badge = skill.shadowed.length > 0 ? ` x${skill.shadowed.length + 1}` : ""
        entries.push({
          label: `${mark} ${skill.name}${count}${badge} · ${skill.scope} · ${skill.path ?? "unknown path"}`,
          detail: [
            `${skill.name} · ${skill.scope}`,
            skill.description ?? "(no description)",
            skill.path ?? "unknown path",
            ...skill.shadowed.map((path) => `shadowed: ${path}`),
          ].join("\n"),
        })
      }

      for (const usage of used) {
        if (skills.some((skill) => skill.name === usage.name)) continue
        entries.push({
          label: `! ${usageLabel(usage)} · unknown to this session`,
          detail: [`${usage.name} was loaded but is not in the current catalog`, `methods: ${JSON.stringify(usage.methods)}`, `failed: ${usage.failed}`].join("\n"),
        })
      }

      for (const run of visibleRuns()) {
        const short = run.runId.length > 4 ? run.runId.slice(-4) : run.runId
        for (const step of run.steps) {
          entries.push({
            label: `↳ ${step.agent ?? "subagent"} · ${step.status ?? run.state} · #${short}`,
            detail: [
              `agent: ${step.agent ?? "?"} · ${step.status ?? run.state} · #${short}`,
              `loaded: ${(step.skills ?? []).join(", ") || "(none)"}`,
              `used: ${(step.used ?? []).map(usageLabel).join(", ") || "(no loads)"}`,
              ...(step.sessionFile ? [`session: ${step.sessionFile}`] : []),
            ].join("\n"),
          })
        }
      }

      if (entries.length === 0) {
        ctx.ui.notify("skill-lens: no skills loaded yet", "warning")
        return
      }

      const picked = await ctx.ui.select(
        "skill-lens",
        entries.map((entry) => entry.label),
      )
      const hit = picked ? entries.find((entry) => entry.label === picked) : undefined
      if (hit) ctx.ui.notify(hit.detail, "info")
    },
  })

  pi.registerShortcut("ctrl+shift+s", {
    description: "Toggle the skill-lens widget",
    handler: (ctx: ExtensionContext) => {
      if (!ctx.hasUI) return
      lastWidget = ""
      render(ctx)
    },
  })
}
