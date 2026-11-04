/**
 * Ambient types for the modules the OpenCode host injects at runtime.
 *
 * OpenCode 2.2.5 resolves `@opencode/plugin/tui` from inside its own binary, so
 * there is nothing to import at typecheck time. The host deliberately rejects a
 * plugin that bundles its own copy, so these declarations stay intentionally
 * loose: the real contract is checked by loading the plugin in a live TUI.
 */
declare module "@opencode/plugin/tui" {
  export interface PluginDefinition {
    id: string
    setup: (context: any) => void | (() => void) | Promise<void | (() => void)>
  }

  export const Plugin: {
    define<T extends PluginDefinition>(definition: T): T
  }

  export function usePlugin(): any
}
