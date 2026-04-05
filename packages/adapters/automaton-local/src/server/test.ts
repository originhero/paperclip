import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

// ---------------------------------------------------------------------------
// testEnvironment
// ---------------------------------------------------------------------------

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const envConfig = parseObject(config.env);

  const automatonPath = asString(config.automatonPath, "automaton");

  // ------------------------------------------------------------------
  // Check 1: automaton binary availability
  // ------------------------------------------------------------------
  try {
    const result = await execFile(automatonPath, ["--version"], { timeout: 10_000 });
    const versionLine = firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr);
    checks.push({
      code: "automaton_binary_found",
      level: "info",
      message: `automaton binary is available: ${automatonPath}`,
      ...(versionLine ? { detail: versionLine } : {}),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push({
      code: "automaton_binary_missing",
      level: "error",
      message: `automaton binary not found: ${automatonPath}`,
      detail,
      hint: "Install automaton and ensure it is on your PATH, or set automatonPath in adapter config.",
    });
  }

  // ------------------------------------------------------------------
  // Check 2: At least one inference API key is present
  // ------------------------------------------------------------------
  const apiKeyEntries: Array<{ key: string; source: string }> = [];

  for (const keyName of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"]) {
    const configVal = asString(envConfig[keyName] as unknown, "").trim();
    if (configVal) {
      apiKeyEntries.push({ key: keyName, source: "adapter config" });
      continue;
    }
    const envVal = process.env[keyName];
    if (isNonEmpty(envVal)) {
      apiKeyEntries.push({ key: keyName, source: "server environment" });
    }
  }

  if (apiKeyEntries.length > 0) {
    const keyList = apiKeyEntries.map((e) => `${e.key} (${e.source})`).join(", ");
    checks.push({
      code: "automaton_api_key_present",
      level: "info",
      message: "At least one inference API key is configured.",
      detail: keyList,
    });
  } else {
    checks.push({
      code: "automaton_api_key_missing",
      level: "warn",
      message:
        "No inference API key detected (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY). automaton runs may fail.",
      hint:
        "Set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY in adapter env or server environment.",
    });
  }

  // ------------------------------------------------------------------
  // Check 3: Docker availability
  // ------------------------------------------------------------------
  try {
    await execFile("docker", ["info"], { timeout: 15_000 });
    checks.push({
      code: "automaton_docker_available",
      level: "info",
      message: "Docker is available and the daemon is running.",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const isNotFound =
      (err as NodeJS.ErrnoException).code === "ENOENT" ||
      /not found|no such file/i.test(detail);

    if (isNotFound) {
      checks.push({
        code: "automaton_docker_not_found",
        level: "warn",
        message: "Docker binary not found on PATH.",
        hint: "Install Docker Desktop or Docker Engine if automaton tasks require sandboxed execution.",
      });
    } else {
      checks.push({
        code: "automaton_docker_unavailable",
        level: "warn",
        message: "Docker is installed but the daemon is not running or not accessible.",
        detail: firstNonEmptyLine(detail),
        hint: "Start Docker Desktop or the Docker daemon before running automaton tasks that require containers.",
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
