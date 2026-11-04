import { For, Show, createEffect, createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"

import { buildTree } from "../core/src/index.ts"
import type { SessionNode, SkillRef, UsageEntry } from "../core/src/index.ts"
import {
  buildPanelModel,
  catalogToRefs,
  sessionNode,
  usageFromMessages,
} from "./src/model.ts"
import type { PanelModel } from "./src/model.ts"

interface SessionLike {
  id: string
  parentID?: string
  title?: string
  agent?: string
  time?: { busy?: number; idle?: number }
}

interface PanelInput {
  name: string
  sessionID: string
}

const PANEL_NAME = "skill-lens"
const DEBOUNCE_MS = 150

export default Plugin.define({
  id: "skill-lens",
  setup(context) {
    const location = context.location ?? context.data.location.default()
    const cwd: string = location?.directory ?? ""

    const [available, setAvailable] = createSignal<SkillRef[]>([])
    const [model, setModel] = createSignal<PanelModel | null>(null)
    const [detail, setDetail] = createSignal<PanelModel | null>(null)
    const [tracked, setTracked] = createSignal<string | undefined>(undefined)

    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    const pendingSessions = new Set<string>()

    const activeSessionID = (): string | undefined => {
      try {
        const tabs = context.ui.tabs.list() as Array<{ sessionID: string; active?: boolean }>
        return tabs.find((tab) => tab.active)?.sessionID ?? tracked()
      } catch {
        return tracked()
      }
    }

    const readFamily = (sessionID: string): SessionLike[] => {
      let family: unknown[] = []
      try {
        family = context.data.session.family(sessionID) ?? []
      } catch {
        family = []
      }

      const infos = family.map((entry) =>
        typeof entry === "string" ? ({ id: entry } as SessionLike) : (entry as SessionLike),
      )
      if (!infos.some((info) => info.id === sessionID)) infos.push({ id: sessionID })

      return infos.map((info) => {
        try {
          return ((context.data.session.get(info.id) as SessionLike | undefined) ?? info)
        } catch {
          return info
        }
      })
    }

    const readUsage = async (sessionID: string): Promise<UsageEntry[]> => {
      try {
        await context.data.session.message.sync?.(sessionID)
      } catch {
        // A failed sync must not hide the last known state.
      }
      try {
        const messages = context.data.session.message.list(sessionID) ?? []
        return usageFromMessages(messages as never[])
      } catch {
        return []
      }
    }

    const refresh = async (sessionID: string | undefined): Promise<void> => {
      if (inFlight) {
        if (sessionID) pendingSessions.add(sessionID)
        return
      }
      inFlight = true
      try {
        try {
          await context.data.location.skill.sync(location)
        } catch {
          // Keep using the cached catalog; a sync failure is not fatal.
        }

        const catalog = (context.data.location.skill.list(location) ?? []) as never[]
        const refs = catalogToRefs(catalog, cwd)
        setAvailable(refs)
        if (!sessionID) return

        setTracked(sessionID)
        const nodes: SessionNode[] = []
        for (const info of readFamily(sessionID)) {
          const used = await readUsage(info.id)
          nodes.push(sessionNode(info, refs, used))
        }

        const tree = buildTree(nodes, sessionID) ?? nodes.find((node) => node.id === sessionID)
        const base = {
          sessionID,
          available: refs,
          used: tree?.skills.used ?? [],
          tree,
        }
        setModel(buildPanelModel(base))
        setDetail(buildPanelModel(base, { detail: true }))
      } finally {
        inFlight = false
        const next = [...pendingSessions]
        pendingSessions.clear()
        for (const id of next) void refresh(id)
      }
    }

    const schedule = (sessionID?: string): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void refresh(sessionID ?? tracked() ?? activeSessionID())
      }, DEBOUNCE_MS)
    }

    const ensure = (sessionID: string | undefined): void => {
      if (sessionID && sessionID !== tracked()) schedule(sessionID)
    }

    const disposers: Array<() => void> = []
    const listen = (event: string): void => {
      try {
        disposers.push(context.data.on(event, () => schedule()))
      } catch {
        // A missing event name in another build must not break setup.
      }
    }
    for (const event of [
      "session.tool.success",
      "session.tool.failed",
      "session.skill.activated",
      "session.created",
    ]) {
      listen(event)
    }

    context.ui.slot({
      append: "session.panel",
      render: (panel: PanelInput) => {
        const Panel = () => {
          createEffect(() => ensure(panel.sessionID))
          const data = () => (tracked() === panel.sessionID ? detail() : null)
          return (
            <box flexDirection="column" padding={1}>
              <text fg={context.theme.text.base}>Skill Lens</text>
              <text fg={context.theme.text.faint}>
                {data()?.footnote ?? "loading..."}
              </text>
              <Show when={data()}>
                {(current: () => PanelModel) => (
                  <For each={current().rows}>
                    {(row) => (
                      <text
                        fg={
                          row.kind === "available"
                            ? context.theme.text.muted
                            : row.kind === "child"
                              ? context.theme.text.faint
                              : context.theme.text.base
                        }
                      >
                        {"  ".repeat(row.indent)}
                        {row.label}
                      </text>
                    )}
                  </For>
                )}
              </Show>
            </box>
          )
        }
        return (
          <Show when={panel.name === PANEL_NAME}>
            <Panel />
          </Show>
        )
      },
    })

    context.ui.slot({
      append: "sidebar.content",
      render: (input: { sessionID: string }) => {
        ensure(input.sessionID)
        const current = () => (tracked() === input.sessionID ? model() : null)
        const rows = () => (current()?.rows ?? []).slice(0, 7)
        return (
          <box flexDirection="column">
            <text fg={context.theme.text.base}>
              {current()?.statusline ?? "Skills"}
            </text>
            <For each={rows()}>
              {(row) => (
                <text
                  fg={
                    row.kind === "available"
                      ? context.theme.text.muted
                      : row.kind === "child"
                        ? context.theme.text.faint
                        : context.theme.text.base
                  }
                >
                  {" ".repeat(row.indent)}
                  {row.label.length > 38 ? `${row.label.slice(0, 37)}…` : row.label}
                </text>
              )}
            </For>
            <Show when={current()}>
              {(value: () => PanelModel) => <text fg={context.theme.text.faint}>{value().footnote}</text>}
            </Show>
          </box>
        )
      },
    })

    context.keymap.layer(() => ({
      commands: [
        {
          id: "skill-lens.open",
          title: "Skill Lens: open skills",
          group: "Skill Lens",
          palette: true,
          slash: { name: "skills", aliases: ["skill-lens"] },
          run: async () => {
            const sessionID = activeSessionID()
            await refresh(sessionID)
            if (!context.ui.panel.open(PANEL_NAME)) {
              context.ui.toast.show({ message: "Skill Lens needs an open session", variant: "warning" })
            }
          },
        },
      ],
      bindings: [],
    }))

    return () => {
      if (timer) clearTimeout(timer)
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // Cleanup is best effort.
        }
      }
    }
  },
})
