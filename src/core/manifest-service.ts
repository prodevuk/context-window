import { writeFileSync, readFileSync, existsSync } from "node:fs";
import type { Repository } from "../storage/repository.js";
import {
  type Manifest,
  type ManifestContextEntry,
  type Project,
  type Context,
  type ContextBudgetResult,
  type Priority,
  ManifestSchema,
} from "./types.js";
import { NotFoundError } from "./errors.js";
import { ensureManifestDir, manifestPathFor } from "../config/paths.js";

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  important: 1,
  reference: 2,
  archived: 3,
};

const DEFAULT_INSTRUCTIONS = `This project uses a context management system. The contexts listed below are available via MCP tools.
- Call get_project_summary first to orient yourself.
- Call get_context with a context_id to retrieve the full content of a specific context.
- Call search_contexts to find relevant context by keyword (use scope: "all" to search beyond attached contexts).
- Call get_context_budget with a token limit to load the highest-priority contexts that fit.
- When you learn new information worth keeping, call create_context (and optionally attach_context to link it to this project).
- Prefer archive_context over delete_context.`;

export class ManifestService {
  constructor(private readonly repo: Repository) {}

  build(projectId: string): Manifest {
    const project = this.repo.getProject(projectId);
    if (!project) throw new NotFoundError("Project", projectId);
    const ids = project.context_refs.map((r) => r.context_id);
    const contexts = this.repo.getContextsByIds(ids);
    const byId = new Map(contexts.map((c) => [c.id, c]));

    const entries: ManifestContextEntry[] = project.context_refs
      .map((ref): ManifestContextEntry | null => {
        const c = byId.get(ref.context_id);
        if (!c) return null;
        if (c.status !== "active") return null;
        return {
          context_id: c.id,
          name: c.name,
          description: c.description,
          category: c.category,
          priority: ref.priority_override ?? c.priority,
          token_count: c.token_count,
        };
      })
      .filter((e): e is ManifestContextEntry => e !== null);

    const total_token_count = entries.reduce((acc, e) => acc + e.token_count, 0);

    return ManifestSchema.parse({
      project_id: project.id,
      project_name: project.name,
      project_description: project.description,
      mcp_server: {
        transport: "stdio",
        command: "context-mcp",
        args: ["--project-id", project.id],
      },
      contexts: entries,
      total_token_count,
      instructions: DEFAULT_INSTRUCTIONS,
      last_generated: new Date().toISOString(),
    });
  }

  regenerateAllReferencing(contextId: string): Array<{ projectId: string; written: string | null }> {
    const projectIds = this.repo.listProjectsReferencing(contextId);
    const out: Array<{ projectId: string; written: string | null }> = [];
    for (const projectId of projectIds) {
      const project = this.repo.getProject(projectId);
      if (!project) continue;
      const manifest = this.build(projectId);
      let written: string | null = null;
      if (project.root_path) {
        try {
          written = this.writeToProjectRoot(project, manifest);
        } catch {
          written = null;
        }
      }
      out.push({ projectId, written });
    }
    return out;
  }

  writeToProjectRoot(project: Project, manifest: Manifest): string {
    if (!project.root_path) {
      throw new Error(
        `Project ${project.id} has no root_path; cannot write manifest to disk.`,
      );
    }
    ensureManifestDir(project.root_path);
    const path = manifestPathFor(project.root_path);
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    return path;
  }

  readFromProjectRoot(rootPath: string): Manifest | null {
    const path = manifestPathFor(rootPath);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    return ManifestSchema.parse(JSON.parse(raw));
  }

  buildBudget(projectId: string, budget: number): ContextBudgetResult {
    if (budget <= 0) {
      return { included: [], excluded: [], total_tokens: 0, budget };
    }
    const project = this.repo.getProject(projectId);
    if (!project) throw new NotFoundError("Project", projectId);

    const refs = [...project.context_refs].sort((a, b) => a.position - b.position);
    const contexts = this.repo.getContextsByIds(refs.map((r) => r.context_id));
    const byId = new Map(contexts.map((c) => [c.id, c]));

    const ranked = refs
      .map((ref) => {
        const c = byId.get(ref.context_id);
        if (!c) return null;
        if (c.status !== "active") return null;
        const effective = ref.priority_override ?? c.priority;
        return { context: c, effective, position: ref.position };
      })
      .filter((x): x is { context: Context; effective: Priority; position: number } => x !== null)
      .sort((a, b) => {
        const p = PRIORITY_ORDER[a.effective] - PRIORITY_ORDER[b.effective];
        return p !== 0 ? p : a.position - b.position;
      });

    const included: Context[] = [];
    const excluded: ContextBudgetResult["excluded"] = [];
    let used = 0;
    for (const r of ranked) {
      if (used + r.context.token_count <= budget) {
        included.push(r.context);
        used += r.context.token_count;
      } else {
        excluded.push({
          context: {
            id: r.context.id,
            name: r.context.name,
            description: r.context.description,
            category: r.context.category,
            priority: r.effective,
            token_count: r.context.token_count,
          },
          reason: `exceeds remaining budget (need ${r.context.token_count}, ${budget - used} left)`,
        });
      }
    }
    return { included, excluded, total_tokens: used, budget };
  }
}
