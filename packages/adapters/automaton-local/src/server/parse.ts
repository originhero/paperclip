// Interface matching Automaton's TaskOutput JSON shape
export interface AutomatonTaskOutput {
  success: boolean;
  exitReason: "completed" | "max_turns" | "timeout" | "error" | "sleeping";
  summary: string;
  turns: {
    id: string;
    thinking: string;
    toolCalls: { name: string; args: unknown; result: string }[];
    tokenUsage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
    costCents: number;
  }[];
  totalUsage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  totalCostCents: number;
  model: string;
  provider: string;
  session: { turns: unknown[]; kvState: Record<string, string>; workdir: string | null };
  survivalTier: string;
  creditBalance: number;
}

function isValidAutomatonOutput(parsed: unknown): parsed is AutomatonTaskOutput {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    typeof obj.success === "boolean" &&
    typeof obj.exitReason === "string" &&
    typeof obj.model === "string" &&
    typeof obj.provider === "string" &&
    Array.isArray(obj.turns)
  );
}

/**
 * Parse Automaton's stdout into a typed TaskOutput.
 *
 * Handles two cases:
 *   1. Clean JSON — the entire stdout is a single valid JSON object.
 *   2. Embedded JSON — stdout contains log lines followed by a JSON object on
 *      the last line (or as the last {...} block in the output). We scan from
 *      the end so that any preamble log lines are ignored.
 *
 * Returns null if no valid TaskOutput can be found.
 */
export function parseAutomatonOutput(stdout: string): AutomatonTaskOutput | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  // Fast path: whole stdout is clean JSON.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isValidAutomatonOutput(parsed)) return parsed;
  } catch {
    // Not clean JSON — fall through to embedded search.
  }

  // Slow path: find the last JSON object in the output.
  // Walk backwards through lines looking for a line that starts a JSON object,
  // then try to parse from that line to the end of the output.
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    // Only attempt lines that look like the start (or entirety) of a JSON object.
    if (!line.startsWith("{")) continue;

    const candidate = lines.slice(i).join("\n");
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isValidAutomatonOutput(parsed)) return parsed;
    } catch {
      // This slice isn't valid JSON — keep searching earlier lines.
    }
  }

  return null;
}
