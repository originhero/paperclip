import type { AdapterModel } from "@paperclipai/adapter-utils";

export const type = "automaton_local";
export const label = "Automaton (Local)";

export const models: AdapterModel[] = [
  { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "ollama/llama3", label: "Ollama Llama 3" },
];

export const agentConfigurationDoc = `# automaton_local agent configuration

Adapter: automaton_local

Core fields:
- cwd (string, optional): absolute working directory for the Automaton agent process (created if missing when possible)
- model (string, optional): model id to use for the agent (e.g. "claude-sonnet-4", "gpt-4o", "ollama/llama3")
- instructionsFilePath (string, optional): absolute path to a markdown instructions file injected at runtime
- promptTemplate (string, optional): run prompt template
- maxTurnsPerRun (number, optional): max turns for one run
- command (string, optional): defaults to "automaton"
- extraArgs (string[], optional): additional CLI args passed to the automaton command
- env (object, optional): KEY=VALUE environment variables injected into the agent process
- workspaceStrategy (object, optional): execution workspace strategy; currently supports { type: "git_worktree", baseRef?, branchTemplate?, worktreeParentDir? }

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- When Paperclip realizes a workspace/runtime for a run, it injects PAPERCLIP_WORKSPACE_* and PAPERCLIP_RUNTIME_* env vars for agent-side tooling.
- The automaton_local adapter runs the Automaton agent executor as a local subprocess.
`;
