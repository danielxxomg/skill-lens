/**
 * Test-only JSX runtime: the real one needs an OpenTUI renderer, which a unit
 * test does not have. Returning plain objects is enough to exercise the wiring.
 */
export function jsx(type: unknown, props: unknown): unknown {
  return { type, props }
}

export const jsxs = jsx
export const jsxDEV = jsx
export const Fragment = Symbol("Fragment")
