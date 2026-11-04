import type { SessionNode, SkillSetDiff } from "./types.ts"

/**
 * Attach flat session nodes into a tree rooted at `rootID`.
 *
 * Nodes whose parent is missing from the input are dropped: a lone child with no
 * parent in the current family cannot be attributed, and guessing would lie.
 */
export function buildTree(nodes: readonly SessionNode[], rootID: string): SessionNode | undefined {
  const copies = new Map<string, SessionNode>()
  for (const node of nodes) {
    copies.set(node.id, { ...node, children: [] })
  }

  for (const node of nodes) {
    if (!node.parentID) continue
    const parent = copies.get(node.parentID)
    const child = copies.get(node.id)
    if (parent && child) parent.children.push(child)
  }

  const root = copies.get(rootID)
  if (!root) return undefined

  const order = (a: SessionNode, b: SessionNode): number => {
    const rank = (state: SessionNode["state"]): number =>
      state === "running" ? 0 : state === "idle" ? 1 : 2
    return rank(a.state) - rank(b.state) || (a.title ?? a.id).localeCompare(b.title ?? b.id)
  }
  const sortRecursive = (node: SessionNode): void => {
    node.children.sort(order)
    for (const child of node.children) sortRecursive(child)
  }
  sortRecursive(root)

  return root
}

/** Names available in the child but not the parent, and vice versa. */
export function diffSkillSets(parent: readonly string[], child: readonly string[]): SkillSetDiff {
  const parentSet = new Set(parent)
  const childSet = new Set(child)
  const added = [...childSet].filter((name) => !parentSet.has(name)).sort()
  const removed = [...parentSet].filter((name) => !childSet.has(name)).sort()
  return { added, removed, same: added.length === 0 && removed.length === 0 }
}

/**
 * Compact diff label: `=`, `+2/-1`, with up to `max` names per side.
 * Returns the label plus the full name lists so a detail view never loses data.
 */
export function formatDiff(diff: SkillSetDiff, max = 3): { label: string; detail: string } {
  if (diff.same) return { label: "=", detail: "" }

  const parts: string[] = []
  if (diff.added.length > 0) parts.push(`+${diff.added.length}`)
  if (diff.removed.length > 0) parts.push(`-${diff.removed.length}`)

  const names: string[] = []
  if (diff.added.length > 0) {
    const shown = diff.added.slice(0, max)
    names.push(`+${shown.join(", ")}${diff.added.length > shown.length ? ` +${diff.added.length - shown.length} more` : ""}`)
  }
  if (diff.removed.length > 0) {
    const shown = diff.removed.slice(0, max)
    names.push(`-${shown.join(", ")}${diff.removed.length > shown.length ? ` +${diff.removed.length - shown.length} more` : ""}`)
  }

  return { label: parts.join("/"), detail: names.join("  ") }
}
