import path from "node:path";
import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const ScopeConfig = z.object({
  description: z.string().default(""),
  owners: z.array(z.string()).default([]),
  reviewers: z.array(z.string()).default([]),
});
export type ScopeConfig = z.infer<typeof ScopeConfig>;

export const RequiredVerifyField = z.enum(["source", "confidence", "owner"]);
export type RequiredVerifyField = z.infer<typeof RequiredVerifyField>;

export const SearchEngineMode = z.enum(["auto", "like", "fts5"]);
export type SearchEngineMode = z.infer<typeof SearchEngineMode>;

export const AgentPressConfigSchema = z.object({
  default_search_status: z.literal("verified").default("verified"),
  strict_stale_filter: z.boolean().default(false),
  default_review_interval_days: z.number().int().positive().default(90),
  required_fields_for_verify: z.array(RequiredVerifyField).default(["source", "confidence", "owner"]),
  reviewer_separation: z.enum(["warn", "enforce"]).default("warn"),
  note_body_max_chars: z.number().int().positive().default(8000),
  scopes: z.record(z.string(), ScopeConfig).default({}),
  default_actor: z.string().optional(),
  // "auto": use FTS5(trigram) when this SQLite build supports it, else LIKE.
  // "like": always the LIKE engine. "fts5": require FTS5(trigram); errors at search-engine
  // construction time (not a silent LIKE fallback) if this environment doesn't support it.
  search_engine: SearchEngineMode.default("auto"),
});
export type AgentPressConfig = z.infer<typeof AgentPressConfigSchema>;

export const DEFAULT_CONFIG: AgentPressConfig = AgentPressConfigSchema.parse({});

export const CONFIG_FILE_NAME = "agentpress.config.yaml";

/**
 * Loads `<dataDir>/agentpress.config.yaml`. Missing file, or a file with only
 * some keys set, falls back to DEFAULT_CONFIG for the rest.
 */
export function loadConfig(dataDir: string): AgentPressConfig {
  const configPath = path.join(dataDir, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw) ?? {};
  return AgentPressConfigSchema.parse(parsed);
}

/** Renders the default config as YAML text for `agentpress init` to write out. */
export function renderDefaultConfigYaml(): string {
  return `default_search_status: verified
strict_stale_filter: false
default_review_interval_days: 90
required_fields_for_verify: [source, confidence, owner]
reviewer_separation: warn
note_body_max_chars: 8000
# auto: FTS5(trigram) when this SQLite build supports it, else LIKE. like: always LIKE.
# fts5: require FTS5(trigram); fails clearly at startup if unsupported instead of
# silently falling back.
search_engine: auto
scopes:
  support:
    description: ""
    owners: []
    reviewers: []
`;
}
