import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

import { recordUsage, usageTotal } from "../core/src/index.ts"
import type { SkillRef, UsageEntry } from "../core/src/index.ts"
import {
  applyUsage,
  commandSkillName,
  runsForSession,
  skillsToRefs,
  widgetLines,
} from "./src/model.ts"
import type { PiSkill, SubagentRun } from "./src/model.ts"
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
    ctx.ui.setStatus(STATUS_KEY, `skills ${skills.length}/${usageTotal(used).loads}`)
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

  pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
    uiContext = ctx
    sessionId = ctx.sessionManager.getSessionId()
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
      used = recordUsage(used, name, "command")
      schedule()
    }
  })

  pi.registerCommand("skills", {
    description: "List available and loaded skills",
    handler: async (_args: string, ctx: any) => {
      const usedByName = new Map(used.map((entry) => [entry.name, entry]))
      const options = [...skills]
        .sort((left, right) => {
          const leftUsed = usedByName.has(left.name) ? 0 : 1
          const rightUsed = usedByName.has(right.name) ? 0 : 1
          return leftUsed - rightUsed || left.name.localeCompare(right.name)
        })
        .map((skill) => {
          const usage = usedByName.get(skill.name)
          const mark = usage ? "[x]" : "[ ]"
          const count = usage ? ` x${Object.values(usage.methods).reduce((sum, n) => sum + (n ?? 0), 0)}` : ""
          const badge = skill.shadowed.length > 0 ? ` x${skill.shadowed.length + 1}` : ""
          return `${mark} ${skill.name}${count}${badge} · ${skill.scope} · ${skill.path ?? "unknown path"}`
        })

      if (options.length === 0) {
        ctx.ui.notify("skill-lens: no skills loaded yet", "warning")
        return
      }

      const picked = await ctx.ui.select("skill-lens", options)
      const name = picked?.replace(/^\[[x ]\]\s*/, "").split(" ")[0]
      const skill = name ? skills.find((candidate) => candidate.name === name) : undefined
      if (!skill) return
      ctx.ui.notify(
        [`${skill.name} · ${skill.scope}`, skill.description ?? "(no description)", skill.path ?? "unknown path", ...skill.shadowed.map((path) => `shadowed: ${path}`)].join("\n"),
        "info",
      )
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
