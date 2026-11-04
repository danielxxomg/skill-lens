import type { SkillRef, SessionSkills, UsageEntry, UsageMethod } from "./types.ts"

/**
 * Collapse same-name skills into one effective entry.
 *
 * `refs` must arrive in the harness's own precedence order (first discovered wins,
 * which is what pi documents), so the first entry for a name is the winner and
 * every later one is recorded as shadowed.
 */
export function effectiveSkills(refs: readonly SkillRef[]): SkillRef[] {
  const byName = new Map<string, SkillRef>()

  for (const ref of refs) {
    const current = byName.get(ref.name)
    if (!current) {
      byName.set(ref.name, { ...ref, shadowed: [...ref.shadowed] })
      continue
    }
    if (ref.path && ref.path !== current.path && !current.shadowed.includes(ref.path)) {
      current.shadowed.push(ref.path)
    }
  }

  return [...byName.values()]
}

/**
 * Parse the `<available_skills>` block that OpenCode injects into a system prompt.
 *
 * Accepts both `<skill><id/><name/><description/></skill>` (OpenCode 2.x) and
 * `<skill><name/><description/></skill>`. Returns [] when the block is absent, so
 * callers can fall back to the location catalog and mark the provenance.
 */
export function parseAvailableSkillsBlock(prompt: string): SkillRef[] {
  const start = prompt.indexOf("<available_skills>")
  const end = prompt.indexOf("</available_skills>")
  if (start === -1 || end === -1 || end < start) return []

  const block = prompt.slice(start, end)
  const refs: SkillRef[] = []

  for (const match of block.matchAll(/<skill>([\s\S]*?)<\/skill>/g)) {
    const body = match[1] ?? ""
    const name = readTag(body, "name") ?? readTag(body, "id")
    if (!name) continue
    const description = readTag(body, "description")
    refs.push({
      name,
      ...(description ? { description } : {}),
      scope: "unknown",
      source: "prompt",
      shadowed: [],
    })
  }

  return effectiveSkills(refs)
}

function readTag(body: string, tag: string): string | undefined {
  const found = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  const value = found?.[1]?.trim()
  return value ? decodeEntities(value) : undefined
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
}

/** Record one observed load. Aggregates by skill name and method. */
export function recordUsage(
  used: readonly UsageEntry[],
  name: string,
  method: UsageMethod,
  failed = false,
): UsageEntry[] {
  const next = used.map((entry) => ({ ...entry, methods: { ...entry.methods } }))
  const existing = next.find((entry) => entry.name === name)

  if (!existing) {
    next.push({
      name,
      methods: { [method]: 1 },
      failed: failed ? 1 : 0,
    })
    return next
  }

  existing.methods[method] = (existing.methods[method] ?? 0) + 1
  if (failed) existing.failed += 1
  return next
}

/** Total observed loads, counting failures separately. */
export function usageTotal(used: readonly UsageEntry[]): { loads: number; failed: number } {
  let loads = 0
  let failed = 0
  for (const entry of used) {
    for (const count of Object.values(entry.methods)) loads += count ?? 0
    failed += entry.failed
  }
  return { loads, failed }
}

/** Sort helper: used first, then available; alphabetical inside each group. */
export function sortSkills(
  skills: SessionSkills,
): Array<{ ref: SkillRef; usage?: UsageEntry }> {
  const usedByName = new Map(skills.used.map((entry) => [entry.name, entry]))
  const rows = skills.available.map((ref) => ({
    ref,
    ...(usedByName.get(ref.name) ? { usage: usedByName.get(ref.name) } : {}),
  }))

  const known = new Set(rows.map((row) => row.ref.name))
  for (const entry of skills.used) {
    if (known.has(entry.name)) continue
    rows.push({
      ref: {
        name: entry.name,
        scope: "unknown",
        source: "prompt",
        shadowed: [],
      },
      usage: entry,
    })
  }

  return rows.sort((left, right) => {
    if (!!left.usage !== !!right.usage) return left.usage ? -1 : 1
    return left.ref.name.localeCompare(right.ref.name)
  })
}
