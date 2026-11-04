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
    const [tracked, setTracked] = createSignal<string | undefined>(undefined)

    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false

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
      if (inFlight) return
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
        setModel(
          buildPanelModel({
            sessionID,
            available: refs,
            used: tree?.skills.used ?? [],
            tree,
          }),
        )
      } finally {
        inFlight = false
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
          const data = () => (tracked() === panel.sessionID ? model() : null)
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
      append: "prompt.footer.status",
      render: (input: { sessionID?: string }) => {
        ensure(input.sessionID)
        const current = model()
        const matches = !!input.sessionID && tracked() === input.sessionID
        const loaded = matches && current ? current.usedCount : undefined
        const count = available().length
        return (
          <text fg={context.theme.text.faint}>
            skills {count}/{loaded ?? "-"}
          </text>
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
