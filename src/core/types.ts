import { z } from "zod";

export const Priority = z.enum(["critical", "important", "reference", "archived"]);
export type Priority = z.infer<typeof Priority>;

export const Visibility = z.enum(["private", "shared", "public"]);
export type Visibility = z.infer<typeof Visibility>;

export const Status = z.enum(["active", "archived", "deprecated"]);
export type Status = z.infer<typeof Status>;

export const ContextSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  priority: Priority.default("reference"),
  visibility: Visibility.default("private"),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string(),
  version: z.number().int().nonnegative().default(1),
  status: Status.default("active"),
  token_count: z.number().int().nonnegative().default(0),
});
export type Context = z.infer<typeof ContextSchema>;

export const CreateContextInput = z.object({
  name: z.string().min(1),
  description: z.string(),
  content: z.string(),
  category: z.string().min(1).default("custom"),
  tags: z.array(z.string()).default([]),
  priority: Priority.default("reference"),
  visibility: Visibility.default("private"),
  created_by: z.string().default("user"),
});
export type CreateContextInput = z.input<typeof CreateContextInput>;

export const UpdateContextInput = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  category: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  priority: Priority.optional(),
  visibility: Visibility.optional(),
  status: Status.optional(),
  expected_version: z.number().int().nonnegative().optional(),
});
export type UpdateContextInput = z.infer<typeof UpdateContextInput>;

export const ProjectSettings = z.object({
  token_budget: z.number().int().positive().default(8000),
  preferred_categories: z.array(z.string()).default([]),
  auto_include_tags: z.array(z.string()).default([]),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

export const ProjectContextRef = z.object({
  context_id: z.string().uuid(),
  position: z.number().int().nonnegative(),
  priority_override: Priority.optional(),
});
export type ProjectContextRef = z.infer<typeof ProjectContextRef>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().default(""),
  context_refs: z.array(ProjectContextRef).default([]),
  root_path: z.string().nullable(),
  settings: ProjectSettings,
  created_at: z.string(),
  updated_at: z.string(),
  owner: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectInput = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  root_path: z.string().nullable().default(null),
  settings: ProjectSettings.partial().default({}),
  owner: z.string().default("user"),
});
export type CreateProjectInput = z.input<typeof CreateProjectInput>;

export const ManifestContextEntry = z.object({
  context_id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  priority: Priority,
  token_count: z.number().int().nonnegative(),
});
export type ManifestContextEntry = z.infer<typeof ManifestContextEntry>;

export const ManifestSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  project_description: z.string(),
  mcp_server: z.object({
    transport: z.enum(["stdio", "http", "sse"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    port: z.number().optional(),
    auth: z.string().optional(),
  }),
  contexts: z.array(ManifestContextEntry),
  total_token_count: z.number().int().nonnegative(),
  instructions: z.string(),
  last_generated: z.string(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export interface ContextBudgetResult {
  included: Context[];
  excluded: Array<{ context: Pick<Context, "id" | "name" | "description" | "category" | "priority" | "token_count">; reason: string }>;
  total_tokens: number;
  budget: number;
}

export interface SearchResultItem {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: Priority;
  token_count: number;
  score: number;
  snippet: string | null;
}

export const UsageSource = z.enum(["mcp", "cli", "web"]);
export type UsageSource = z.infer<typeof UsageSource>;

export const UsageOutcome = z.enum(["success", "error"]);
export type UsageOutcome = z.infer<typeof UsageOutcome>;

export interface UsageEvent {
  occurred_at: string;
  source: UsageSource;
  tool_name: string;
  project_id: string | null;
  context_id: string | null;
  duration_ms: number | null;
  outcome: UsageOutcome;
  error_code: string | null;
  metadata: Record<string, unknown> | null;
  client_name: string | null;
  client_version: string | null;
}

export interface UsageBucket<KeyT extends string = string> {
  key: KeyT;
  label: string;
  count: number;
  error_count: number;
  last_seen: string | null;
}

export interface UsageStats {
  scope: { kind: "project" | "tool" | "context" | "overview"; id?: string };
  total: number;
  errors: number;
  last_seen: string | null;
  by_tool: UsageBucket[];
  by_project: UsageBucket[];
  by_context: UsageBucket[];
  by_source: UsageBucket<UsageSource>[];
  by_client: UsageBucket[];
  daily: Array<{ day: string; count: number; errors: number }>;
  since: string;
}
