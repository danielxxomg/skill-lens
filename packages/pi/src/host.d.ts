/**
 * Ambient types for pi 1.5.0's extension host.
 *
 * The installed build ships no `.d.ts` (only the compiled binary and docs), and
 * the local checkout is ahead of the installed version, so this declares the
 * subset skill-lens uses. Runtime behavior is validated live with `/reload`.
 */
declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionContext {
    hasUI: boolean
    ui: {
      setWidget: (key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }) => void
      setStatus: (key: string, text: string | undefined) => void
      notify: (message: string, level?: "info" | "warning" | "error") => void
      select: (title: string, options: string[]) => Promise<string | undefined>
    }
    sessionManager: { getSessionId: () => string; getEntries?: () => unknown[] }
  }

  export interface ExtensionAPI {
    on: (event: string, handler: (event: any, ctx: ExtensionContext) => void | Promise<void>) => void
    registerCommand: (
      name: string,
      options: { description?: string; handler: (args: string, ctx: any) => void | Promise<void> },
    ) => void
    registerShortcut: (
      shortcut: string,
      options: { description?: string; handler: (ctx: ExtensionContext) => void | Promise<void> },
    ) => void
  }
}
