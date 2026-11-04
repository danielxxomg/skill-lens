/** Test-only stand-in for the module the OpenCode host injects at runtime. */
export const Plugin = {
  define: <T>(definition: T): T => definition,
}

export function usePlugin(): never {
  throw new Error("usePlugin is only available inside a host render")
}
