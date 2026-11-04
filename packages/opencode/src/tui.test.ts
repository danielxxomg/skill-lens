import { describe, expect, it, vi } from "vitest"

import plugin from "../tui.tsx"

const CATALOG = [
  { name: "grilling", description: "Stress-test", path: "/home/me/.agents/skills/grilling/SKILL.md" },
  { name: "go-testing", description: "Go patterns", path: "/home/me/.agents/skills/go-testing/SKILL.md" },
]

interface FakeState {
  opened: string[]
  toasts: string[]
  syncedSkills: number
  queriedSessions: string[]
  disposed: number
  slots: string[]
  renderers: Record<string, (input: any) => unknown>
  handlers: Record<string, () => void>
  commands: Array<{ id: string; slash?: { name: string }; run: () => Promise<void> }>
}

function fakeContext(messages: unknown[]) {
  const state: FakeState = {
    opened: [],
    toasts: [],
    syncedSkills: 0,
    queriedSessions: [],
    disposed: 0,
    slots: [],
    renderers: {},
    handlers: {},
    commands: [],
  }

  const location = { directory: "/repo" }

  const context = {
    location,
    theme: { text: { base: "#fff", muted: "#888", faint: "#555" } },
    data: {
      location: {
        default: () => location,
        skill: {
          sync: async () => {
            state.syncedSkills += 1
          },
          list: () => CATALOG,
        },
      },
      session: {
        family: (id: string) => [
          { id, title: "main", time: { busy: 1 } },
          { id: "child", parentID: id, title: "explore", time: { idle: 1 } },
        ],
        get: (id: string) => ({ id, title: id, time: { idle: 1 } }),
        message: {
          sync: async () => {},
          list: (id: string) => {
            state.queriedSessions.push(id)
            return messages
          },
        },
      },
      on: (name: string, handler: () => void) => {
        state.handlers[name] = handler
        return () => {
          state.disposed += 1
        }
      },
    },
    ui: {
      slot: ({ append, render }: { append: string; render: (input: any) => unknown }) => {
        state.slots.push(append)
        state.renderers[append] = render
        return () => {}
      },
      panel: {
        open: (name: string) => {
          state.opened.push(name)
          return true
        },
      },
      toast: { show: ({ message }: { message: string }) => state.toasts.push(message) },
      tabs: { list: () => [{ sessionID: "ses_1", active: true }] },
    },
    keymap: {
      layer: (factory: () => { commands: FakeState["commands"] }) => {
        const layer = factory()
        state.commands = layer.commands
      },
    },
  }

  return { context, state }
}

const MESSAGES = [
  {
    type: "assistant",
    content: [
      { type: "tool", name: "skill", state: { status: "completed", input: { id: "grilling" } } },
    ],
  },
]

describe("opencode tui plugin wiring", () => {
  it("registers a /skills command that syncs the catalog and opens the panel", async () => {
    const { context, state } = fakeContext(MESSAGES)
    plugin.setup(context)

    const command = state.commands.find((entry) => entry.slash?.name === "skills")
    expect(command).toBeDefined()

    await command!.run()

    expect(state.syncedSkills).toBe(1)
    expect(state.opened).toEqual(["skill-lens"])
    expect(state.queriedSessions).toContain("ses_1")
  })

  it("opens a warning toast when no session is active", async () => {
    const { context, state } = fakeContext(MESSAGES)
    context.ui.panel.open = () => false
    context.ui.tabs.list = () => []
    plugin.setup(context)

    const command = state.commands.find((entry) => entry.slash?.name === "skills")
    await command!.run()

    expect(state.toasts[0]).toContain("session")
  })

  it("contributes to the sidebar, not the prompt footer", () => {
    const { context, state } = fakeContext(MESSAGES)
    plugin.setup(context)

    expect(state.slots).toContain("sidebar.content")
    expect(state.slots).toContain("session.panel")
    expect(state.slots).not.toContain("prompt.footer.status")
  })

  it("refreshes the session shown in the sidebar, not the active tab", async () => {
    vi.useFakeTimers()
    const { context, state } = fakeContext(MESSAGES)
    plugin.setup(context)

    state.renderers["sidebar.content"]?.({ sessionID: "child" })
    await vi.advanceTimersByTimeAsync(200)
    expect(state.queriedSessions).toContain("child")

    state.queriedSessions.length = 0
    state.handlers["session.tool.success"]?.()
    await vi.advanceTimersByTimeAsync(200)

    expect(state.queriedSessions).toContain("child")
    expect(state.queriedSessions).not.toContain("ses_1")
    vi.useRealTimers()
  })

  it("disposes event subscriptions on cleanup", () => {
    const { context, state } = fakeContext(MESSAGES)
    const cleanup = plugin.setup(context) as (() => void) | undefined
    expect(cleanup).toBeTypeOf("function")
    expect(state.disposed).toBe(0)
    cleanup?.()
    expect(state.disposed).toBeGreaterThan(0)
  })
})
