import { join } from "node:path";
import {
  type AgentScreenRuleIssue,
  type AgentScreenRuleSet,
  type AgentScreenRulesResponse,
  DEFAULT_AGENT_SCREEN_RULES,
  formatAgentScreenRuleSet,
  parseAgentScreenRuleSet,
} from "../../core/agent-screen";
import { formatErrorDetail } from "../../core/error-detail";
import { createJsonFileStore } from "../json-store";

export const MAX_AGENT_SCREEN_RULES_BYTES = 200_000;
const RULES_FILE_NAME = "agent-screen-rules.json";

type LoadedRules = Omit<AgentScreenRulesResponse, "generation">;

let activeRules = DEFAULT_AGENT_SCREEN_RULES;
let activeErrors: AgentScreenRuleIssue[] = [];
let activeGeneration = 0;

function errorIssue(code: string, error: unknown): AgentScreenRuleIssue {
  return {
    path: "$",
    code,
    message: formatErrorDetail(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  };
}

function defaultResponse(errors: AgentScreenRuleIssue[] = []): LoadedRules {
  return { rules: DEFAULT_AGENT_SCREEN_RULES, source: "default", errors };
}

export function agentScreenRulesFilePath(root: string): string {
  return join(root, ".code-viewer", RULES_FILE_NAME);
}

function parseStoredRules(raw: unknown): AgentScreenRuleSet {
  const parsed = parseAgentScreenRuleSet(raw);
  if ("errors" in parsed) {
    throw Object.assign(new Error("saved terminal rules are invalid"), {
      issues: parsed.errors,
    });
  }
  return parsed.value;
}

const rulesStore = createJsonFileStore<AgentScreenRuleSet | null>({
  filePath: agentScreenRulesFilePath,
  empty: () => null,
  sanitize: (raw) => parseStoredRules(raw),
  maxBytes: MAX_AGENT_SCREEN_RULES_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: `terminal rules must not exceed ${MAX_AGENT_SCREEN_RULES_BYTES} bytes`,
  serialize: (rules) => {
    if (rules === null) throw new Error("terminal rules must not be null");
    return formatAgentScreenRuleSet(rules);
  },
  invalidFileBehavior: "throw",
});

export function getActiveAgentScreenRules(): AgentScreenRuleSet {
  return activeRules;
}

export function getAgentScreenRuleErrors(): AgentScreenRuleIssue[] {
  return activeErrors.map((error) => ({ ...error }));
}

function issuesFromLoadError(error: unknown): AgentScreenRuleIssue[] {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const issues = (current as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      return issues.filter(
        (issue): issue is AgentScreenRuleIssue =>
          !!issue &&
          typeof issue === "object" &&
          typeof (issue as AgentScreenRuleIssue).path === "string" &&
          typeof (issue as AgentScreenRuleIssue).code === "string" &&
          typeof (issue as AgentScreenRuleIssue).message === "string",
      );
    }
    if (current instanceof SyntaxError)
      return [errorIssue("invalid_json", current)];
    current = (current as { cause?: unknown }).cause;
  }
  return [errorIssue("load_failed", error)];
}

function activate(response: LoadedRules): AgentScreenRulesResponse {
  activeRules = response.rules;
  activeErrors = response.errors.map((error) => ({ ...error }));
  activeGeneration += 1;
  return { ...response, generation: activeGeneration };
}

export async function reloadAgentScreenRules(
  root: string,
): Promise<AgentScreenRulesResponse> {
  try {
    const rules = await rulesStore.load(root);
    return activate(
      rules === null
        ? defaultResponse()
        : { rules, source: "saved", errors: [] },
    );
  } catch (error) {
    console.error("[code-viewer] terminal rule load failed", error);
    return activate(defaultResponse(issuesFromLoadError(error)));
  }
}

export async function saveAgentScreenRules(
  root: string,
  raw: unknown,
): Promise<AgentScreenRulesResponse | { errors: AgentScreenRuleIssue[] }> {
  const parsed = parseAgentScreenRuleSet(raw);
  if ("errors" in parsed) return { errors: parsed.errors };
  await rulesStore.save(root, parsed.value);
  return activate({ rules: parsed.value, source: "saved", errors: [] });
}

export async function resetAgentScreenRules(
  root: string,
): Promise<AgentScreenRulesResponse> {
  await rulesStore.remove(root);
  return activate(defaultResponse());
}

export function resetAgentScreenRulesForTest(): void {
  activeRules = DEFAULT_AGENT_SCREEN_RULES;
  activeErrors = [];
  activeGeneration = 0;
}
