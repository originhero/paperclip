import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterBillingType,
} from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  parseObject,
  buildPaperclipEnv,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  resolveCommandForLogs,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { parseAutomatonOutput } from "./parse.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function buildPromptFromContext(context: Record<string, unknown>): string {
  const parts: string[] = [];

  const issueTitle = asString(context.issueTitle, "").trim();
  const issueBody = asString(context.issueBody, "").trim();
  const prompt = asString(context.prompt, "").trim();
  const approval = asString(context.approval, "").trim();

  if (issueTitle) parts.push(`Issue: ${issueTitle}`);
  if (issueBody) parts.push(issueBody);
  if (approval) parts.push(`Approval: ${approval}`);
  if (prompt) parts.push(prompt);

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;

  // Extract config values
  // config.command is the documented key (agentConfigurationDoc says "command");
  // fall back to config.automatonPath for backward compat.
  const automatonPath = asString(config.command, asString(config.automatonPath, "automaton"));
  const configuredCwd = asString(config.workdir, asString(config.cwd, ""));
  const model = asString(config.model, "").trim();
  // config.maxTurnsPerRun is the documented key (agentConfigurationDoc says "maxTurnsPerRun");
  // fall back to config.maxTurns for backward compat.
  const maxTurns = asNumber(config.maxTurnsPerRun, asNumber(config.maxTurns, 25));
  const timeoutSec = asNumber(config.timeoutSec, 300);
  const billingType = asString(config.billingType, "subscription_included") as AdapterBillingType;

  // Resolve working directory
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  // Build environment
  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;
  env.ORIGINHERO_MODE = "local";

  // Paperclip context env vars
  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (effectiveWorkspaceCwd) env.PAPERCLIP_WORKSPACE_CWD = effectiveWorkspaceCwd;
  if (workspaceSource) env.PAPERCLIP_WORKSPACE_SOURCE = workspaceSource;

  // Pass through API keys from adapter config
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"]) {
    const configVal = asString(envConfig[key] as unknown, "");
    if (configVal) {
      env[key] = configVal;
    }
  }

  // Pass through all other config env vars
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }

  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  const resolvedCommand = await resolveCommandForLogs(automatonPath, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  // Build task input from ctx
  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const prompt = buildPromptFromContext(context);

  const taskInput = {
    runId,
    agentId: agent.id,
    companyId: agent.companyId,
    prompt,
    session: Object.keys(runtimeSessionParams).length > 0 ? runtimeSessionParams : null,
    // maxTurns is passed via CLI --max-turns flag, not in the stdin JSON, to avoid duplication.
    ...(model ? { model } : {}),
    // Send config in stdin JSON so Automaton can pick up inferenceModel and other overrides.
    config: {
      ...(model ? { inferenceModel: model } : {}),
    },
  };

  const taskInputJson = JSON.stringify(taskInput);

  // Build automaton CLI args: automaton task --max-turns N --timeout N --json
  const args: string[] = ["task"];
  if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
  if (timeoutSec > 0) args.push("--timeout", String(timeoutSec));
  args.push("--json");

  if (onMeta) {
    await onMeta({
      adapterType: "automaton_local",
      command: resolvedCommand,
      cwd,
      commandArgs: args,
      env: loggedEnv,
      prompt,
      context,
    });
  }

  const graceSec = asNumber(config.graceSec, 5);

  const proc = await runChildProcess(runId, automatonPath, args, {
    cwd,
    env,
    stdin: taskInputJson,
    timeoutSec,
    graceSec,
    onSpawn,
    onLog: async (stream, chunk) => {
      if (stream === "stderr") {
        await onLog("stderr", chunk);
      }
      // stdout is not streamed — we collect it for parsing
    },
  });

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
      errorCode: "timeout",
    };
  }

  const parsed = parseAutomatonOutput(proc.stdout);

  if (!parsed) {
    const stderrLine =
      proc.stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? "";
    const errorMessage =
      (proc.exitCode ?? 0) === 0
        ? "Failed to parse automaton JSON output"
        : stderrLine
          ? `automaton exited with code ${proc.exitCode ?? -1}: ${stderrLine}`
          : `automaton exited with code ${proc.exitCode ?? -1}`;
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage,
      resultJson: {
        stdout: proc.stdout,
        stderr: proc.stderr,
      },
    };
  }

  // Map parsed output to AdapterExecutionResult
  const usage = {
    inputTokens: parsed.totalUsage.inputTokens,
    outputTokens: parsed.totalUsage.outputTokens,
    cachedInputTokens: parsed.totalUsage.cachedInputTokens,
  };

  // Allow negative costs (credits/refunds) — only default to 0 for non-numeric values.
  const costUsd =
    typeof parsed.totalCostCents === "number"
      ? parsed.totalCostCents / 100
      : 0;

  // Build session params from parsed session
  const resolvedSessionParams: Record<string, unknown> | null =
    parsed.session && Array.isArray(parsed.session.turns)
      ? {
          turns: parsed.session.turns,
          kvState: parsed.session.kvState ?? {},
          ...(parsed.session.workdir ? { workdir: parsed.session.workdir } : {}),
        }
      : null;

  const errorMessage =
    (proc.exitCode ?? 0) === 0
      ? null
      : parsed.summary
        ? `automaton exited with code ${proc.exitCode ?? -1}: ${parsed.summary}`
        : `automaton exited with code ${proc.exitCode ?? -1}`;

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    errorMessage,
    usage,
    sessionParams: resolvedSessionParams,
    provider: parsed.provider || null,
    model: parsed.model || model || null,
    billingType,
    costUsd,
    summary: parsed.summary || null,
    resultJson: parsed as unknown as Record<string, unknown>,
  };
}
