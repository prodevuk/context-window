import { z } from "zod";
import type { Services } from "../core/services.js";
import { Priority, Visibility, Status } from "../core/types.js";
import { DomainError } from "../core/errors.js";

export interface McpContext {
  services: Services;
  projectId: string | null;
}

export type ToolHandler = (args: unknown, ctx: McpContext) => Promise<unknown>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<unknown>;
  handler: ToolHandler;
}

function requireProject(ctx: McpContext): string {
  if (!ctx.projectId) {
    throw new DomainError(
      "No active project. Start the server with --project-id <id> or set CONTEXT_PROJECT_ID.",
      "NO_ACTIVE_PROJECT",
    );
  }
  return ctx.projectId;
}

export const tools: ToolDef[] = [
  {
    name: "get_project_summary",
    description:
      "Return the active project's name, description, and the list of attached contexts (metadata only). Call this first.",
    inputSchema: z.object({}).strict(),
    handler: async (_args, ctx) => {
      const projectId = requireProject(ctx);
      const manifest = ctx.services.manifests.build(projectId);
      return manifest;
    },
  },
  {
    name: "get_context",
    description: "Retrieve the full content of a context by id.",
    inputSchema: z
      .object({ context_id: z.string().uuid() })
      .strict(),
    handler: async (args, ctx) => {
      const { context_id } = args as { context_id: string };
      return ctx.services.contexts.get(context_id);
    },
  },
  {
    name: "get_contexts_by_category",
    description: "List contexts attached to the active project filtered by category.",
    inputSchema: z.object({ category: z.string().min(1) }).strict(),
    handler: async (args, ctx) => {
      const projectId = requireProject(ctx);
      const { category } = args as { category: string };
      const project = ctx.services.projects.get(projectId);
      const ids = project.context_refs.map((r) => r.context_id);
      const all = ctx.services.repo.getContextsByIds(ids);
      return all.filter((c) => c.category === category);
    },
  },
  {
    name: "search_contexts",
    description:
      "Full-text search across contexts. scope=\"project\" (default) limits to attached contexts; scope=\"all\" searches the entire library.",
    inputSchema: z
      .object({
        query: z.string().min(1),
        scope: z.enum(["project", "all"]).default("project"),
        limit: z.number().int().positive().max(100).default(20),
      })
      .strict(),
    handler: async (args, ctx) => {
      const { query, scope, limit } = args as {
        query: string;
        scope: "project" | "all";
        limit: number;
      };
      const projectId = scope === "project" ? requireProject(ctx) : undefined;
      return ctx.services.contexts.search({ query, projectId, limit });
    },
  },
  {
    name: "list_all_contexts",
    description: "List every context in the user's library (regardless of project attachment).",
    inputSchema: z
      .object({
        category: z.string().optional(),
        status: Status.optional(),
        visibility: Visibility.optional(),
        limit: z.number().int().positive().max(500).default(200),
      })
      .strict(),
    handler: async (args, ctx) => {
      const { category, status, visibility, limit } = args as {
        category?: string;
        status?: z.infer<typeof Status>;
        visibility?: z.infer<typeof Visibility>;
        limit?: number;
      };
      return ctx.services.contexts.list({ category, status, visibility, limit });
    },
  },
  {
    name: "get_context_budget",
    description:
      "Given a token budget, return the highest-priority subset of attached contexts that fits.",
    inputSchema: z
      .object({ budget: z.number().int().positive() })
      .strict(),
    handler: async (args, ctx) => {
      const projectId = requireProject(ctx);
      const { budget } = args as { budget: number };
      return ctx.services.manifests.buildBudget(projectId, budget);
    },
  },
  {
    name: "create_context",
    description:
      "Create a new standalone context. The context is added to the user's library; use attach_context to link it to the active project.",
    inputSchema: z
      .object({
        name: z.string().min(1),
        description: z.string(),
        content: z.string(),
        category: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        priority: Priority.optional(),
        visibility: Visibility.optional(),
        created_by: z.string().optional(),
      })
      .strict(),
    handler: async (args, ctx) => {
      const input = args as Parameters<typeof ctx.services.contexts.create>[0];
      return ctx.services.contexts.create(input);
    },
  },
  {
    name: "update_context",
    description: "Update a context by id. Pass expected_version for optimistic locking.",
    inputSchema: z
      .object({
        context_id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        content: z.string().optional(),
        category: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        priority: Priority.optional(),
        visibility: Visibility.optional(),
        status: Status.optional(),
        expected_version: z.number().int().nonnegative().optional(),
      })
      .strict(),
    handler: async (args, ctx) => {
      const { context_id, ...rest } = args as { context_id: string } & Record<
        string,
        unknown
      >;
      return ctx.services.contexts.update(context_id, rest as never);
    },
  },
  {
    name: "archive_context",
    description: "Set a context's status to 'archived'. Prefer this over delete_context.",
    inputSchema: z.object({ context_id: z.string().uuid() }).strict(),
    handler: async (args, ctx) => {
      const { context_id } = args as { context_id: string };
      return ctx.services.contexts.archive(context_id);
    },
  },
  {
    name: "delete_context",
    description:
      "Permanently delete a context. Requires confirm=true. LLMs should archive instead unless explicitly instructed.",
    inputSchema: z
      .object({
        context_id: z.string().uuid(),
        confirm: z.literal(true),
      })
      .strict(),
    handler: async (args, ctx) => {
      const { context_id } = args as { context_id: string; confirm: true };
      ctx.services.contexts.delete(context_id);
      return { deleted: context_id };
    },
  },
  {
    name: "attach_context",
    description: "Attach an existing context to the active project.",
    inputSchema: z
      .object({
        context_id: z.string().uuid(),
        position: z.number().int().nonnegative().optional(),
        priority_override: Priority.optional(),
      })
      .strict(),
    handler: async (args, ctx) => {
      const projectId = requireProject(ctx);
      const { context_id, position, priority_override } = args as {
        context_id: string;
        position?: number;
        priority_override?: z.infer<typeof Priority>;
      };
      return ctx.services.projects.attach(projectId, context_id, {
        position,
        priority_override,
      });
    },
  },
  {
    name: "detach_context",
    description: "Detach a context from the active project. Does not delete the context itself.",
    inputSchema: z.object({ context_id: z.string().uuid() }).strict(),
    handler: async (args, ctx) => {
      const projectId = requireProject(ctx);
      const { context_id } = args as { context_id: string };
      return ctx.services.projects.detach(projectId, context_id);
    },
  },
  {
    name: "reorder_contexts",
    description:
      "Reorder all attached contexts. Pass the full ordered list of context_ids.",
    inputSchema: z
      .object({ ordered_context_ids: z.array(z.string().uuid()).min(1) })
      .strict(),
    handler: async (args, ctx) => {
      const projectId = requireProject(ctx);
      const { ordered_context_ids } = args as { ordered_context_ids: string[] };
      return ctx.services.projects.reorder(projectId, ordered_context_ids);
    },
  },
  {
    name: "create_category",
    description: "Create a new custom category.",
    inputSchema: z.object({ name: z.string().min(1) }).strict(),
    handler: async (args, ctx) => {
      const { name } = args as { name: string };
      ctx.services.contexts.createCategory(name);
      return { name };
    },
  },
  {
    name: "get_usage_stats",
    description:
      "Return usage statistics for the active project, a specific context, a specific tool, or the whole system. Buckets show counts by tool, project, context, and source.",
    inputSchema: z
      .object({
        scope: z.enum(["project", "context", "tool", "overview"]).default("project"),
        context_id: z.string().uuid().optional(),
        tool_name: z.string().optional(),
        since_days: z.number().int().positive().max(365).default(30),
        limit_buckets: z.number().int().positive().max(50).default(10),
      })
      .strict(),
    handler: async (args, ctx) => {
      const a = args as {
        scope: "project" | "context" | "tool" | "overview";
        context_id?: string;
        tool_name?: string;
        since_days: number;
        limit_buckets: number;
      };
      const opts = { sinceDays: a.since_days, limitBuckets: a.limit_buckets };
      if (a.scope === "project") {
        const projectId = requireProject(ctx);
        return ctx.services.usage.forProject(projectId, opts);
      }
      if (a.scope === "context") {
        if (!a.context_id) {
          throw new DomainError("context_id is required when scope=context", "VALIDATION");
        }
        return ctx.services.usage.forContext(a.context_id, opts);
      }
      if (a.scope === "tool") {
        if (!a.tool_name) {
          throw new DomainError("tool_name is required when scope=tool", "VALIDATION");
        }
        return ctx.services.usage.forTool(a.tool_name, opts);
      }
      return ctx.services.usage.overview(opts);
    },
  },
  {
    name: "regenerate_manifest",
    description:
      "Regenerate the active project's manifest file. Writes to <root_path>/.context/manifest.json if root_path is set.",
    inputSchema: z.object({}).strict(),
    handler: async (_args, ctx) => {
      const projectId = requireProject(ctx);
      const project = ctx.services.projects.get(projectId);
      const manifest = ctx.services.manifests.build(projectId);
      let written: string | null = null;
      if (project.root_path) {
        written = ctx.services.manifests.writeToProjectRoot(project, manifest);
      }
      return { manifest, written_to: written };
    },
  },
];

export function findTool(name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}
