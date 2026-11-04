import { afterEach, describe, expect, it, vi } from "vitest"

import skillLens from "../index.ts"

type Handler = (event: any, ctx: any) => void | Promise<void>

function fakeHost() {
  const handlers = new Map<string, Handler>()
  const commands = new Map<string, { description?: string; handler: Handler }>()
  const widgets: string[][] = []
  const statuses: string[] = []
  const notifications: string[] = []

  const session = { id: "ses_test", entries: [] as unknown[] }

  const ctx = {
    hasUI: true,
    ui: {
      setWidget: (_key: string, content: string[] | undefined) => {
        if (content) widgets.push(content)
      },
      setStatus: (_key: string, text: string | undefined) => {
        if (text) statuses.push(text)
      },
      notify: (message: string) => notifications.push(message),
      select: async () => undefined,
    },
    sessionManager: {
      getSessionId: () => session.id,
      getEntries: () => session.entries,
    },
  }

  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: (name: string, options: { description?: string; handler: Handler }) =>
      commands.set(name, options),
    registerShortcut: () => {},
  }

  return { handlers, commands, widgets, statuses, notifications, ctx, session, pi }
}

const SKILLS = [
  {
    name: "grilling",
    description: "Stress-test a plan",
    filePath: "/home/me/.agents/skills/grilling/SKILL.md",
    sourceInfo: { scope: "user" },
  },
  {
    name: "go-testing",
    description: "Go patterns",
    filePath: "/home/me/.agents/skills/go-testing/SKILL.md",
    sourceInfo: { scope: "user" },
  },
]

const last = <T,>(items: T[]): T | undefined => items.at(-1)

describe("pi extension wiring", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("registers the /skills command and the toggle shortcut", () => {
    const host = fakeHost()
    skillLens(host.pi as never)
    expect(host.commands.has("skills")).toBe(true)
    expect(host.commands.get("skills")?.description).toContain("skills")
  })

  it("renders available skills, then marks a read of SKILL.md as used", async () => {
    vi.useFakeTimers()
    const host = fakeHost()
    skillLens(host.pi as never)

    await host.handlers.get("session_start")?.({ reason: "startup" }, host.ctx)
    await host.handlers.get("before_agent_start")?.(
      { systemPromptOptions: { skills: SKILLS } },
      host.ctx,
    )
    vi.advanceTimersByTime(200)

    const before = last(host.widgets)
    expect(before?.[0]).toBe("skills 2/0 ▱▱▱▱▱▱▱▱▱▱")

    await host.handlers.get("tool_result")?.(
      { toolName: "read", input: { path: "/home/me/.agents/skills/grilling/SKILL.md" }, isError: false },
      host.ctx,
    )
    vi.advanceTimersByTime(200)

    const after = last(host.widgets)
    expect(after?.[0]).toBe("skills 2/1 ▰▰▰▰▰▱▱▱▱▱")
    expect(after?.[1]).toBe("● grilling x1 (read 1)")
    expect(last(host.statuses)).toBe("skills 2/1")

    await host.handlers.get("session_shutdown")?.({ reason: "quit" }, host.ctx)
  })

  it("counts /skill:name input as a command load", async () => {
    vi.useFakeTimers()
    const host = fakeHost()
    skillLens(host.pi as never)

    await host.handlers.get("session_start")?.({ reason: "startup" }, host.ctx)
    await host.handlers.get("before_agent_start")?.({ systemPromptOptions: { skills: SKILLS } }, host.ctx)
    await host.handlers.get("input")?.({ text: "/skill:go-testing run the suite" }, host.ctx)
    vi.advanceTimersByTime(200)

    expect(last(host.widgets)?.[1]).toBe("● go-testing x1 (command 1)")

    await host.handlers.get("session_shutdown")?.({ reason: "quit" }, host.ctx)
  })

  it("resets on a new session and restores usage from entries on resume", async () => {
    vi.useFakeTimers()
    const host = fakeHost()
    skillLens(host.pi as never)

    await host.handlers.get("session_start")?.({ reason: "new" }, host.ctx)
    await host.handlers.get("before_agent_start")?.({ systemPromptOptions: { skills: SKILLS } }, host.ctx)
    vi.advanceTimersByTime(200)
    expect(last(host.statuses)).toBe("skills 2/0")

    host.session.entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "c1",
              name: "read",
              input: { path: "/home/me/.agents/skills/grilling/SKILL.md" },
            },
          ],
        },
      },
      { type: "message", message: { role: "toolResult", toolCallId: "c1", toolName: "read", isError: false } },
    ]
    host.session.id = "ses_resumed"
    await host.handlers.get("session_start")?.({ reason: "resume" }, host.ctx)
    vi.advanceTimersByTime(200)

    expect(last(host.statuses)).toBe("skills 2/1")
    await host.handlers.get("session_shutdown")?.({ reason: "quit" }, host.ctx)
  })

  it("counts an unknown /skill:name as a failed load", async () => {
    vi.useFakeTimers()
    const host = fakeHost()
    skillLens(host.pi as never)

    await host.handlers.get("session_start")?.({ reason: "new" }, host.ctx)
    await host.handlers.get("before_agent_start")?.({ systemPromptOptions: { skills: SKILLS } }, host.ctx)
    await host.handlers.get("input")?.({ text: "/skill:missing do it" }, host.ctx)
    vi.advanceTimersByTime(200)

    expect(last(host.widgets)?.[1]).toBe("● missing x1 (command 1) !1")
    await host.handlers.get("session_shutdown")?.({ reason: "quit" }, host.ctx)
  })

  it("does not mark the first command as failed before the catalog loads", async () => {
    vi.useFakeTimers()
    const host = fakeHost()
    skillLens(host.pi as never)

    await host.handlers.get("session_start")?.({ reason: "new" }, host.ctx)
    await host.handlers.get("input")?.({ text: "/skill:grilling go" }, host.ctx)
    await host.handlers.get("before_agent_start")?.({ systemPromptOptions: { skills: SKILLS } }, host.ctx)
    vi.advanceTimersByTime(200)

    const rendered = (last(host.widgets) ?? []).join("\n")
    expect(rendered).not.toContain("!1")
    await host.handlers.get("session_shutdown")?.({ reason: "quit" }, host.ctx)
  })
})
