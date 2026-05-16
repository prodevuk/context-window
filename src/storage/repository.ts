import type {
  Context,
  Project,
  ProjectContextRef,
  Priority,
  SearchResultItem,
  UsageEvent,
  UsageBucket,
  UsageSource,
} from "../core/types.js";

export interface ContextFilter {
  category?: string;
  tags?: string[];
  status?: Context["status"];
  visibility?: Context["visibility"];
  owner?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SearchOptions {
  query: string;
  projectId?: string;
  limit?: number;
}

export interface Repository {
  init(): void;
  close(): void;

  // Contexts
  createContext(c: Context): Context;
  getContext(id: string): Context | null;
  updateContext(id: string, next: Context): Context;
  archiveContext(id: string): Context;
  deleteContext(id: string): void;
  listContexts(filter?: ContextFilter): Context[];
  getContextsByIds(ids: string[]): Context[];

  // Projects
  createProject(p: Project): Project;
  getProject(id: string): Project | null;
  getProjectByName(name: string): Project | null;
  getProjectByRootPath(rootPath: string): Project | null;
  updateProject(p: Project): Project;
  deleteProject(id: string): void;
  listProjects(): Project[];

  // Project-Context linking
  attachContext(projectId: string, ref: ProjectContextRef): void;
  detachContext(projectId: string, contextId: string): void;
  reorderContexts(projectId: string, orderedContextIds: string[]): void;
  setPriorityOverride(projectId: string, contextId: string, priority: Priority | null): void;
  listProjectContextRefs(projectId: string): ProjectContextRef[];
  listProjectsReferencing(contextId: string): string[];

  // Categories
  createCategory(name: string): void;
  listCategories(): string[];

  // Search
  searchContexts(opts: SearchOptions): SearchResultItem[];

  // Usage
  recordUsage(event: UsageEvent): void;
  countUsage(filter: UsageFilter): { total: number; errors: number; last_seen: string | null };
  aggregateUsage(
    filter: UsageFilter,
    by: "tool_name" | "project_id" | "context_id" | "source" | "client_name",
  ): UsageBucket[];
  recentUsage(filter: UsageFilter, limit: number): UsageEvent[];
  dailyUsage(filter: UsageFilter): Array<{ day: string; count: number; errors: number }>;
}

export interface UsageFilter {
  since?: string;
  project_id?: string;
  context_id?: string;
  tool_name?: string;
  source?: UsageSource;
  client_name?: string;
}
