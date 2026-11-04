import { recordUsage } from "../../core/src/index.ts"
import type { UsageEntry } from "../../core/src/index.ts"

import { skillNameForTool, usageMethodForTool } from "./model.ts"

interface ToolCallRef {
  name: string
  input: Record<string, unknown>
}

function isToolBlock(type: string): boolean {
  return /tool/i.test(type) && !/toolresult|tool_result/i.test(type)
}

function pick(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const found = value[key]
    if (typeof found === "string" && found.length > 0) return found
  }
  return undefined
}

/**
 * Count skill loads from session entries.
 *
 * pi stores the call (with its input path) in the assistant message and the
 * outcome in a separate `toolResult` entry, so the two are joined by call id.
 * Without the assistant side a run can only report its loaded set, not counts.
 *
 * Works for both a `session.jsonl` file and `ctx.sessionManager.getEntries()`.
 */
export function usageFromEntries(entries: readonly unknown[]): UsageEntry[] {
  const calls = new Map<string, ToolCallRef>()
  const pending: Array<{ name: string; input: Record<string, unknown>; failed: boolean }> = []

  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue
    const entry = raw as { type?: string; message?: Record<string, unknown> }
    if (entry.type !== "message" || !entry.message) continue
    const message = entry.message
    const role = message.role
    const content = message.content

    if (role === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue
        const record = block as Record<string, unknown>
        const type = String(record.type ?? "")
        if (!isToolBlock(type)) continue
        const name = pick(record, ["name", "toolName"])
        const id = pick(record, ["id", "toolCallId", "tool_call_id"])
        if (!name || !id) continue
        const input = (record.input ?? record.arguments ?? record.args) as
          | Record<string, unknown>
          | undefined
        calls.set(id, { name, input: input ?? {} })
      }
      continue
    }

    if (role === "toolResult" || role === "tool_result") {
      const name = pick(message, ["toolName", "name"])
      const id = pick(message, ["toolCallId", "tool_call_id", "id"])
      const call = id ? calls.get(id) : undefined
      const resolvedName = name ?? call?.name
      if (!resolvedName) continue
      pending.push({
        name: resolvedName,
        input: call?.input ?? {},
        failed: message.isError === true,
      })
    }
  }

  let used: UsageEntry[] = []
  for (const call of pending) {
    const method = usageMethodForTool(call.name, call.input)
    if (!method) continue
    const skill = skillNameForTool(call.name, call.input, [])
    if (!skill) continue
    used = recordUsage(used, skill, method, call.failed)
  }
  return used
}

export function usageFromSessionText(text: string): UsageEntry[] {
  const entries: unknown[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // A truncated final line is normal in an append-only session file.
    }
  }
  return usageFromEntries(entries)
}
