import { v4 as uuid } from "uuid";
import type { Repository, ContextFilter, SearchOptions } from "../storage/repository.js";
import {
  type Context,
  type CreateContextInput,
  type UpdateContextInput,
  type SearchResultItem,
  ContextSchema,
  CreateContextInput as CreateContextInputSchema,
  UpdateContextInput as UpdateContextInputSchema,
} from "./types.js";
import { NotFoundError, ValidationError, VersionConflictError } from "./errors.js";
import { countTokens } from "./tokens.js";
import type { ManifestService } from "./manifest-service.js";

const LARGE_CONTEXT_TOKENS = 32_000;

export class ContextService {
  constructor(
    private readonly repo: Repository,
    private readonly manifests?: ManifestService,
  ) {}

  create(input: CreateContextInput): { context: Context; warnings: string[] } {
    const parsed = CreateContextInputSchema.parse(input);
    const now = new Date().toISOString();
    const token_count = countTokens(parsed.content);
    const ctx: Context = ContextSchema.parse({
      id: uuid(),
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      content: parsed.content,
      tags: parsed.tags,
      priority: parsed.priority,
      visibility: parsed.visibility,
      created_at: now,
      updated_at: now,
      created_by: parsed.created_by,
      version: 1,
      status: "active",
      token_count,
    });
    this.repo.createCategory(ctx.category);
    const saved = this.repo.createContext(ctx);
    const warnings: string[] = [];
    if (token_count > LARGE_CONTEXT_TOKENS) {
      warnings.push(
        `Context size is ${token_count} tokens; consider splitting into smaller contexts.`,
      );
    }
    return { context: saved, warnings };
  }

  get(id: string): Context {
    const c = this.repo.getContext(id);
    if (!c) throw new NotFoundError("Context", id);
    return c;
  }

  tryGet(id: string): Context | null {
    return this.repo.getContext(id);
  }

  update(id: string, input: UpdateContextInput): Context {
    const parsed = UpdateContextInputSchema.parse(input);
    const existing = this.get(id);
    if (
      parsed.expected_version !== undefined &&
      parsed.expected_version !== existing.version
    ) {
      throw new VersionConflictError(
        "Context",
        id,
        parsed.expected_version,
        existing.version,
      );
    }
    const merged: Context = {
      ...existing,
      name: parsed.name ?? existing.name,
      description: parsed.description ?? existing.description,
      content: parsed.content ?? existing.content,
      category: parsed.category ?? existing.category,
      tags: parsed.tags ?? existing.tags,
      priority: parsed.priority ?? existing.priority,
      visibility: parsed.visibility ?? existing.visibility,
      status: parsed.status ?? existing.status,
      updated_at: new Date().toISOString(),
      version: existing.version + 1,
      token_count:
        parsed.content !== undefined
          ? countTokens(parsed.content)
          : existing.token_count,
    };
    if (parsed.category && parsed.category !== existing.category) {
      this.repo.createCategory(parsed.category);
    }
    const saved = this.repo.updateContext(id, merged);
    this.manifests?.regenerateAllReferencing(id);
    return saved;
  }

  archive(id: string): Context {
    const archived = this.repo.archiveContext(id);
    this.manifests?.regenerateAllReferencing(id);
    return archived;
  }

  delete(id: string): void {
    const referencing = this.manifests ? this.repo.listProjectsReferencing(id) : [];
    this.repo.deleteContext(id);
    if (this.manifests) {
      for (const projectId of referencing) {
        const project = this.repo.getProject(projectId);
        if (!project) continue;
        const manifest = this.manifests.build(projectId);
        if (project.root_path) {
          try {
            this.manifests.writeToProjectRoot(project, manifest);
          } catch {
            // ignore disk write failures during cleanup
          }
        }
      }
    }
  }

  list(filter: ContextFilter = {}): Context[] {
    return this.repo.listContexts(filter);
  }

  search(opts: SearchOptions): SearchResultItem[] {
    if (!opts.query.trim()) throw new ValidationError("query is required");
    return this.repo.searchContexts(opts);
  }

  createCategory(name: string): void {
    if (!name.trim()) throw new ValidationError("category name is required");
    this.repo.createCategory(name.trim());
  }

  listCategories(): string[] {
    return this.repo.listCategories();
  }
}
