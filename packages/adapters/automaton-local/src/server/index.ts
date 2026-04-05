import type { ServerAdapterModule, AdapterSessionManagement } from "@paperclipai/adapter-utils";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";
import { listSkills, syncSkills } from "./skills.js";
import { sessionCodec } from "./session-codec.js";
import { type as adapterType, models, agentConfigurationDoc } from "../index.js";

export const sessionManagement: AdapterSessionManagement = {
  supportsSessionResume: true,
  nativeContextManagement: "confirmed",
  defaultSessionCompaction: {
    enabled: false,
    maxSessionRuns: 0,
    maxRawInputTokens: 0,
    maxSessionAgeHours: 0,
  },
};

export const automatonLocalAdapter: ServerAdapterModule = {
  type: adapterType,
  execute,
  testEnvironment,
  listSkills,
  syncSkills,
  sessionCodec,
  sessionManagement,
  models,
  agentConfigurationDoc,
};

// Re-export pieces for registry
export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { listSkills, syncSkills } from "./skills.js";
export { sessionCodec } from "./session-codec.js";
export { parseAutomatonOutput } from "./parse.js";
export type { AutomatonTaskOutput } from "./parse.js";
