import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Validates that the raw value looks like a serialized Automaton session.
 * The only hard requirement is that `turns` is an array.
 */
function isValidSessionRecord(record: Record<string, unknown>): boolean {
  return Array.isArray(record.turns);
}

/**
 * Session codec for the automaton_local adapter.
 *
 * Automaton stores session state in the `session` field of its TaskOutput:
 *   { turns: unknown[]; kvState: Record<string, string>; workdir: string | null }
 *
 * We persist exactly those three fields so they can be passed back on the next
 * run via --session-json (or equivalent) to continue a conversation.
 */
export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown): Record<string, unknown> | null {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!isValidSessionRecord(record)) return null;

    const turns = record.turns as unknown[];
    const kvState =
      typeof record.kvState === "object" && record.kvState !== null && !Array.isArray(record.kvState)
        ? (record.kvState as Record<string, string>)
        : {};
    const workdir = readNonEmptyString(record.workdir);

    return {
      turns,
      kvState,
      ...(workdir !== null ? { workdir } : {}),
    };
  },

  serialize(params: Record<string, unknown> | null): Record<string, unknown> | null {
    if (params === null || typeof params !== "object" || Array.isArray(params)) return null;
    if (!isValidSessionRecord(params)) return null;

    const turns = params.turns as unknown[];
    const kvState =
      typeof params.kvState === "object" && params.kvState !== null && !Array.isArray(params.kvState)
        ? (params.kvState as Record<string, string>)
        : {};
    const workdir = readNonEmptyString(params.workdir);

    return {
      turns,
      kvState,
      ...(workdir !== null ? { workdir } : {}),
    };
  },

  getDisplayId(params: Record<string, unknown> | null): string | null {
    if (params === null || typeof params !== "object" || Array.isArray(params)) return null;
    return readNonEmptyString(params.workdir);
  },
};
