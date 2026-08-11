import type { AgentState } from "./agent-state";
import { stripAnsi } from "./terminal-images";

type ScreenState = Extract<AgentState, "working" | "waiting" | "idle">;

export const AGENT_SCREEN_RULE_SET_VERSION = 1 as const;

export const AGENT_SCREEN_REGIONS = [
  "osc_title",
  "whole_recent",
  "bottom_non_empty",
  "last_non_empty",
] as const;

export type AgentScreenRegion = (typeof AGENT_SCREEN_REGIONS)[number];
export type AgentScreenRuleState = ScreenState | "skip";

export type AgentScreenMatcher = {
  contains?: string[];
  regex?: string[];
  lineRegex?: string[];
  all?: AgentScreenMatcher[];
  any?: AgentScreenMatcher[];
  not?: AgentScreenMatcher[];
};

export type AgentScreenRule = AgentScreenMatcher & {
  id: string;
  state: AgentScreenRuleState;
  priority: number;
  region: AgentScreenRegion;
  /** bottom_non_empty で下端から読む非空行数。 */
  lines?: number;
};

export type AgentScreenRuleSet = {
  version: typeof AGENT_SCREEN_RULE_SET_VERSION;
  rules: AgentScreenRule[];
};

export type AgentScreenRuleIssue = {
  path: string;
  code: string;
  message: string;
  stack?: string;
};

export type AgentScreenRuleParseResult =
  | { ok: true; value: AgentScreenRuleSet }
  | { ok: false; errors: AgentScreenRuleIssue[] };

export type AgentScreenRulesResponse = {
  rules: AgentScreenRuleSet;
  source: "default" | "saved";
  errors: AgentScreenRuleIssue[];
  generation: number;
};

export type AgentScreenDetection =
  | {
      kind: "state";
      state: ScreenState;
      ruleId: string;
      priority: number;
    }
  | { kind: "skip"; ruleId: string; priority: number }
  | { kind: "none" };

const MAX_RAW_SCREEN_CHARS = 64_000;
const MAX_RECENT_LINES = 120;
const MAX_RULES = 100;
const MAX_MATCHERS_PER_LIST = 20;
const MAX_MATCHER_DEPTH = 4;
const MAX_PATTERN_LENGTH = 1000;
const MAX_CONTAINS_LENGTH = 200;
const MAX_REGION_LINES = 120;
const MAX_PRIORITY = 100_000;
const RULE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC_TITLE_RE = new RegExp(
  `${ESC}\\](?:0|2);([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`,
  "g",
);

const BLOCKING_HINTS: AgentScreenMatcher[] = [
  { contains: ["enter to confirm"] },
  { contains: ["enter to select"] },
  { contains: ["enter to submit"] },
  { contains: ["allow command?"] },
  { contains: ["[y/n]"] },
  { contains: ["yes (y)"] },
  { contains: ["do you want to proceed?"] },
];

export const DEFAULT_AGENT_SCREEN_RULES: AgentScreenRuleSet = {
  version: AGENT_SCREEN_RULE_SET_VERSION,
  rules: [
    {
      id: "title_requires_input",
      state: "waiting",
      priority: 1100,
      region: "osc_title",
      contains: ["action required"],
    },
    {
      id: "title_spinner",
      state: "working",
      priority: 1050,
      region: "osc_title",
      regex: ["^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]"],
    },
    {
      id: "transcript_view",
      state: "skip",
      priority: 1000,
      region: "bottom_non_empty",
      lines: 8,
      any: [
        { contains: ["showing detailed transcript"] },
        { contains: ["pgup/pgdn", "home/end to jump", "q to quit"] },
      ],
    },
    {
      id: "interactive_form",
      state: "waiting",
      priority: 980,
      region: "bottom_non_empty",
      lines: 14,
      contains: ["esc to cancel"],
      any: [
        { contains: ["enter to confirm"] },
        { contains: ["enter to select"] },
        { contains: ["enter to submit"] },
      ],
    },
    {
      id: "live_reasoning",
      state: "working",
      priority: 970,
      region: "bottom_non_empty",
      lines: 8,
      contains: ["tokens", "thinking"],
      any: [{ lineRegex: ["^\\s*[✢✻✽✶✳]"] }, { lineRegex: ["(?i)^\\s*·"] }],
    },
    {
      id: "prompt_box",
      state: "idle",
      priority: 950,
      region: "bottom_non_empty",
      lines: 8,
      lineRegex: ["^\\s*❯"],
      not: [
        ...BLOCKING_HINTS,
        { contains: ["esc to cancel"] },
        { contains: ["arrow keys"] },
        { contains: ["↑/↓ to navigate"] },
      ],
    },
    {
      id: "strong_input_request",
      state: "waiting",
      priority: 900,
      region: "bottom_non_empty",
      lines: 12,
      any: [
        { contains: ["press enter to confirm or esc to cancel"] },
        { contains: ["enter to submit answer"] },
        { contains: ["enter to submit all"] },
        { contains: ["allow command?"] },
      ],
    },
    {
      id: "permission_request",
      state: "waiting",
      priority: 850,
      region: "bottom_non_empty",
      lines: 14,
      contains: ["do you want to proceed?"],
      any: [
        { lineRegex: ["(?i)^\\P{L}*yes\\b"] },
        { lineRegex: ["(?i)^\\P{L}*no\\b"] },
      ],
    },
    {
      id: "weak_input_request",
      state: "waiting",
      priority: 600,
      region: "bottom_non_empty",
      lines: 8,
      any: [
        { contains: ["[y/n]"] },
        { contains: ["yes (y)"] },
        {
          any: [
            { contains: ["do you want to"] },
            { contains: ["would you like to"] },
          ],
          all: [{ any: [{ contains: ["yes"] }, { contains: ["❯"] }] }],
        },
      ],
    },
    {
      id: "live_working_status",
      state: "working",
      priority: 500,
      region: "bottom_non_empty",
      lines: 3,
      lineRegex: ["^[•◦]\\s+Working"],
      not: [{ contains: ["conversation interrupted"] }],
    },
    {
      id: "last_prompt",
      state: "idle",
      priority: 400,
      region: "last_non_empty",
      lineRegex: ["^\\s*[›❯]"],
      not: BLOCKING_HINTS,
    },
  ],
};

const MATCHER_KEYS = new Set([
  "contains",
  "regex",
  "lineRegex",
  "all",
  "any",
  "not",
]);
const RULE_KEYS = new Set([
  ...MATCHER_KEYS,
  "id",
  "state",
  "priority",
  "region",
  "lines",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function issue(
  errors: AgentScreenRuleIssue[],
  path: string,
  code: string,
  message: string,
): void {
  errors.push({ path, code, message });
}

function stringList(
  value: unknown,
  path: string,
  maxLength: number,
  errors: AgentScreenRuleIssue[],
  validate?: (item: string, itemPath: string) => void,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issue(errors, path, "invalid_type", "must be an array of strings");
    return undefined;
  }
  if (value.length === 0 || value.length > MAX_MATCHERS_PER_LIST) {
    issue(
      errors,
      path,
      "invalid_length",
      `must contain 1-${MAX_MATCHERS_PER_LIST} items`,
    );
  }
  const out: string[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "string") {
      issue(errors, itemPath, "invalid_type", "must be a string");
      return;
    }
    if (item.length === 0 || item.length > maxLength) {
      issue(
        errors,
        itemPath,
        "invalid_length",
        `must contain 1-${maxLength} characters`,
      );
      return;
    }
    validate?.(item, itemPath);
    out.push(item);
  });
  return out;
}

function validateRegex(
  pattern: string,
  path: string,
  errors: AgentScreenRuleIssue[],
): void {
  try {
    compileNativeRegex(pattern);
  } catch (error) {
    issue(
      errors,
      path,
      "invalid_regex",
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  const unsafeReason = unsafeRegexReason(pattern);
  if (unsafeReason) {
    issue(errors, path, "unsafe_regex", unsafeReason);
    return;
  }
}

const MAX_REGEX_QUANTIFIERS = 8;
const MAX_REGEX_BOUNDED_REPEAT = 100;
const MAX_REGEX_VARIABLE_REPETITIONS = 1;

/**
 * JavaScript の正規表現は実行時間を止められないため、設定から受け付けるのは
 * 後戻りが指数的に増えない小さな部分集合だけにする。OR は matcher.any、
 * 複数条件の AND は matcher.all で表現できるので、正規表現内の選択とグループ
 * は不要。入力に応じて長さが変わる繰返しも 1 個までに絞る。
 */
function unsafeRegexReason(pattern: string): string | null {
  const source = pattern.startsWith("(?i)") ? pattern.slice(4) : pattern;
  let inCharacterClass = false;
  let quantifiers = 0;
  let variableRepetitions = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined) break;
      if (/^[1-9]$/.test(escaped) || escaped === "k") {
        return "backreferences are not supported";
      }
      if ((escaped === "p" || escaped === "P") && source[index + 2] === "{") {
        const end = source.indexOf("}", index + 3);
        if (end < 0) break;
        index = end;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === "[") {
      inCharacterClass = true;
      continue;
    }
    if (char === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) continue;
    if (char === "(" || char === ")" || char === "|") {
      return "groups and alternation are not supported; use all or any matchers";
    }
    if (char === "*" || char === "+" || char === "?") {
      quantifiers += 1;
      variableRepetitions += 1;
      continue;
    }
    if (char !== "{") continue;
    const match = source.slice(index).match(/^\{(\d+)(?:,(\d*))?\}/);
    if (!match) continue;
    quantifiers += 1;
    const lower = Number(match[1]);
    const hasComma = match[2] !== undefined;
    const upper = hasComma && match[2] !== "" ? Number(match[2]) : lower;
    if (hasComma && (match[2] === "" || upper !== lower)) {
      variableRepetitions += 1;
    }
    if (lower > MAX_REGEX_BOUNDED_REPEAT || upper > MAX_REGEX_BOUNDED_REPEAT) {
      return `bounded repetitions must not exceed ${MAX_REGEX_BOUNDED_REPEAT}`;
    }
    index += match[0].length - 1;
  }

  if (quantifiers > MAX_REGEX_QUANTIFIERS) {
    return `must not contain more than ${MAX_REGEX_QUANTIFIERS} quantifiers`;
  }
  if (variableRepetitions > MAX_REGEX_VARIABLE_REPETITIONS) {
    return "must not contain more than one variable-length repetition";
  }
  return null;
}

function parseMatcher(
  raw: unknown,
  path: string,
  depth: number,
  errors: AgentScreenRuleIssue[],
): AgentScreenMatcher | null {
  if (!isRecord(raw)) {
    issue(errors, path, "invalid_type", "must be an object");
    return null;
  }
  if (depth > MAX_MATCHER_DEPTH) {
    issue(
      errors,
      path,
      "too_deep",
      `matcher nesting must not exceed ${MAX_MATCHER_DEPTH}`,
    );
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!MATCHER_KEYS.has(key)) {
      issue(errors, `${path}.${key}`, "unknown_field", "is not supported");
    }
  }
  const matcher: AgentScreenMatcher = {};
  const contains = stringList(
    raw.contains,
    `${path}.contains`,
    MAX_CONTAINS_LENGTH,
    errors,
  );
  if (contains) matcher.contains = contains;
  const regex = stringList(
    raw.regex,
    `${path}.regex`,
    MAX_PATTERN_LENGTH,
    errors,
    (pattern, itemPath) => validateRegex(pattern, itemPath, errors),
  );
  if (regex) matcher.regex = regex;
  const lineRegex = stringList(
    raw.lineRegex,
    `${path}.lineRegex`,
    MAX_PATTERN_LENGTH,
    errors,
    (pattern, itemPath) => validateRegex(pattern, itemPath, errors),
  );
  if (lineRegex) matcher.lineRegex = lineRegex;
  for (const key of ["all", "any", "not"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      issue(errors, `${path}.${key}`, "invalid_type", "must be an array");
      continue;
    }
    if (value.length === 0 || value.length > MAX_MATCHERS_PER_LIST) {
      issue(
        errors,
        `${path}.${key}`,
        "invalid_length",
        `must contain 1-${MAX_MATCHERS_PER_LIST} matchers`,
      );
    }
    const nested = value.flatMap((item, index) => {
      const parsed = parseMatcher(
        item,
        `${path}.${key}[${index}]`,
        depth + 1,
        errors,
      );
      return parsed ? [parsed] : [];
    });
    matcher[key] = nested;
  }
  if (!Object.keys(matcher).length) {
    issue(errors, path, "empty_matcher", "must contain a match condition");
  }
  return matcher;
}

function parseRule(
  raw: unknown,
  index: number,
  errors: AgentScreenRuleIssue[],
): AgentScreenRule | null {
  const path = `rules[${index}]`;
  if (!isRecord(raw)) {
    issue(errors, path, "invalid_type", "must be an object");
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!RULE_KEYS.has(key)) {
      issue(errors, `${path}.${key}`, "unknown_field", "is not supported");
    }
  }
  const matcher = parseMatcher(
    Object.fromEntries(
      Object.entries(raw).filter(([key]) => MATCHER_KEYS.has(key)),
    ),
    path,
    0,
    errors,
  );
  const id = raw.id;
  if (typeof id !== "string" || !RULE_ID_RE.test(id)) {
    issue(
      errors,
      `${path}.id`,
      "invalid_id",
      "must use 1-64 lowercase letters, digits, underscores, or hyphens",
    );
  }
  const state = raw.state;
  if (
    state !== "working" &&
    state !== "waiting" &&
    state !== "idle" &&
    state !== "skip"
  ) {
    issue(
      errors,
      `${path}.state`,
      "invalid_state",
      "must be working, waiting, idle, or skip",
    );
  }
  const priority = raw.priority;
  if (
    typeof priority !== "number" ||
    !Number.isInteger(priority) ||
    Math.abs(priority) > MAX_PRIORITY
  ) {
    issue(
      errors,
      `${path}.priority`,
      "invalid_priority",
      `must be an integer between -${MAX_PRIORITY} and ${MAX_PRIORITY}`,
    );
  }
  const region = raw.region;
  if (
    typeof region !== "string" ||
    !(AGENT_SCREEN_REGIONS as readonly string[]).includes(region)
  ) {
    issue(
      errors,
      `${path}.region`,
      "invalid_region",
      `must be one of ${AGENT_SCREEN_REGIONS.join(", ")}`,
    );
  }
  const lines = raw.lines;
  if (region === "bottom_non_empty") {
    if (
      typeof lines !== "number" ||
      !Number.isInteger(lines) ||
      lines < 1 ||
      lines > MAX_REGION_LINES
    ) {
      issue(
        errors,
        `${path}.lines`,
        "invalid_lines",
        `must be an integer between 1 and ${MAX_REGION_LINES}`,
      );
    }
  } else if (lines !== undefined) {
    issue(
      errors,
      `${path}.lines`,
      "unexpected_lines",
      "is only valid with bottom_non_empty",
    );
  }
  if (
    !matcher ||
    typeof id !== "string" ||
    !RULE_ID_RE.test(id) ||
    (state !== "working" &&
      state !== "waiting" &&
      state !== "idle" &&
      state !== "skip") ||
    typeof priority !== "number" ||
    !Number.isInteger(priority) ||
    Math.abs(priority) > MAX_PRIORITY ||
    typeof region !== "string" ||
    !(AGENT_SCREEN_REGIONS as readonly string[]).includes(region) ||
    (region === "bottom_non_empty" &&
      (typeof lines !== "number" ||
        !Number.isInteger(lines) ||
        lines < 1 ||
        lines > MAX_REGION_LINES)) ||
    (region !== "bottom_non_empty" && lines !== undefined)
  ) {
    return null;
  }
  return {
    id,
    state,
    priority,
    region: region as AgentScreenRegion,
    ...(typeof lines === "number" ? { lines } : {}),
    ...matcher,
  };
}

export function parseAgentScreenRuleSet(
  raw: unknown,
): AgentScreenRuleParseResult {
  const errors: AgentScreenRuleIssue[] = [];
  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [
        { path: "$", code: "invalid_type", message: "must be an object" },
      ],
    };
  }
  for (const key of Object.keys(raw)) {
    if (key !== "version" && key !== "rules") {
      issue(errors, key, "unknown_field", "is not supported");
    }
  }
  if (raw.version !== AGENT_SCREEN_RULE_SET_VERSION) {
    issue(
      errors,
      "version",
      "unsupported_version",
      `must be ${AGENT_SCREEN_RULE_SET_VERSION}`,
    );
  }
  if (!Array.isArray(raw.rules)) {
    issue(errors, "rules", "invalid_type", "must be an array");
    return { ok: false, errors };
  }
  if (raw.rules.length > MAX_RULES) {
    issue(
      errors,
      "rules",
      "too_many_rules",
      `must contain at most ${MAX_RULES} rules`,
    );
  }
  const rules = raw.rules.flatMap((item, index) => {
    const parsed = parseRule(item, index, errors);
    return parsed ? [parsed] : [];
  });
  const ids = new Map<string, number>();
  raw.rules.forEach((rule, index) => {
    if (
      !isRecord(rule) ||
      typeof rule.id !== "string" ||
      !RULE_ID_RE.test(rule.id)
    ) {
      return;
    }
    const previous = ids.get(rule.id);
    if (previous !== undefined) {
      issue(
        errors,
        `rules[${index}].id`,
        "duplicate_id",
        `duplicates rules[${previous}].id`,
      );
    } else {
      ids.set(rule.id, index);
    }
  });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { version: AGENT_SCREEN_RULE_SET_VERSION, rules },
  };
}

export function formatAgentScreenRuleSet(rules: AgentScreenRuleSet): string {
  return `${JSON.stringify(rules, null, 2)}\n`;
}

function lastOscTitle(raw: string): string {
  let title = "";
  for (const match of raw.matchAll(OSC_TITLE_RE)) title = match[1] ?? "";
  return title;
}

function recentScreen(raw: string): string {
  const tail = raw.slice(-MAX_RAW_SCREEN_CHARS);
  const lines = stripAnsi(tail).split("\r").join("\n").split("\n");
  return lines.slice(-MAX_RECENT_LINES).join("\n");
}

function nonEmptyLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

function regionText(
  rule: AgentScreenRule,
  screen: string,
  title: string,
): string {
  if (rule.region === "osc_title") return title;
  if (rule.region === "whole_recent") return screen;
  const lines = nonEmptyLines(screen);
  if (rule.region === "last_non_empty") return lines[lines.length - 1] ?? "";
  return lines.slice(-(rule.lines ?? 1)).join("\n");
}

function compileNativeRegex(pattern: string): RegExp {
  const caseInsensitive = pattern.startsWith("(?i)");
  return new RegExp(
    caseInsensitive ? pattern.slice(4) : pattern,
    caseInsensitive ? "iu" : "u",
  );
}

function compileRegex(pattern: string): RegExp {
  const unsafeReason = unsafeRegexReason(pattern);
  if (unsafeReason) throw new Error(unsafeReason);
  return compileNativeRegex(pattern);
}

function regexMatches(pattern: string, text: string): boolean {
  return compileRegex(pattern).test(text);
}

function matcherMatches(matcher: AgentScreenMatcher, text: string): boolean {
  const lower = text.toLowerCase();
  if (
    !(matcher.contains ?? []).every((value) =>
      lower.includes(value.toLowerCase()),
    )
  ) {
    return false;
  }
  if (!(matcher.regex ?? []).every((pattern) => regexMatches(pattern, text))) {
    return false;
  }
  const lines = text.split("\n");
  if (
    !(matcher.lineRegex ?? []).every((pattern) =>
      lines.some((line) => regexMatches(pattern, line)),
    )
  ) {
    return false;
  }
  if (!(matcher.all ?? []).every((nested) => matcherMatches(nested, text))) {
    return false;
  }
  if (
    (matcher.any?.length ?? 0) > 0 &&
    !matcher.any?.some((nested) => matcherMatches(nested, text))
  ) {
    return false;
  }
  return !(matcher.not ?? []).some((nested) => matcherMatches(nested, text));
}

export function detectAgentScreen(
  input: { screen: string; title?: string },
  ruleSet: AgentScreenRuleSet = DEFAULT_AGENT_SCREEN_RULES,
): AgentScreenDetection {
  const rawTail = input.screen.slice(-MAX_RAW_SCREEN_CHARS);
  const screen = recentScreen(input.screen);
  const title = stripAnsi(input.title || lastOscTitle(rawTail));
  let winner: AgentScreenRule | null = null;
  for (const rule of ruleSet.rules) {
    const text = regionText(rule, screen, title);
    if (!matcherMatches(rule, text)) continue;
    if (!winner || rule.priority > winner.priority) winner = rule;
  }
  if (!winner) return { kind: "none" };
  if (winner.state === "skip") {
    return { kind: "skip", ruleId: winner.id, priority: winner.priority };
  }
  return {
    kind: "state",
    state: winner.state,
    ruleId: winner.id,
    priority: winner.priority,
  };
}
