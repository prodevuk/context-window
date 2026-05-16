import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { SCHEMA_SQL, SEED_CATEGORIES, USAGE_EVENT_COLUMNS } from "./schema.js";
import type { Repository, ContextFilter, SearchOptions, UsageFilter } from "../repository.js";
import type {
  Context,
  Project,
  ProjectContextRef,
  Priority,
  SearchResultItem,
  UsageEvent,
  UsageBucket,
  UsageSource,
} from "../../core/types.js";
import { NotFoundError } from "../../core/errors.js";

interface ContextRow {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  tags: string;
  priority: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  version: number;
  status: string;
  token_count: number;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  root_path: string | null;
  settings: string;
  created_at: string;
  updated_at: string;
  owner: string;
}

interface ProjectContextRow {
  context_id: string;
  position: number;
  priority_override: string | null;
}

function rowToContext(r: ContextRow): Context {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    content: r.content,
    tags: JSON.parse(r.tags) as string[],
    priority: r.priority as Context["priority"],
    visibility: r.visibility as Context["visibility"],
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
    version: r.version,
    status: r.status as Context["status"],
    token_count: r.token_count,
  };
}

function rowToProject(r: ProjectRow, refs: ProjectContextRow[]): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    context_refs: refs.map((x) => ({
      context_id: x.context_id,
      position: x.position,
      priority_override: x.priority_override as Priority | undefined ?? undefined,
    })),
    root_path: r.root_path,
    settings: JSON.parse(r.settings),
    created_at: r.created_at,
    updated_at: r.updated_at,
    owner: r.owner,
  };
}

export class SqliteRepository implements Repository {
  private db: DB;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  init(): void {
    this.db.exec(SCHEMA_SQL);
    this.runMigrations();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)",
    );
    const tx = this.db.transaction((names: string[]) => {
      for (const n of names) stmt.run(n, now);
    });
    tx(SEED_CATEGORIES);
  }

  private runMigrations(): void {
    const cols = this.db
      .prepare("PRAGMA table_info(usage_events)")
      .all() as Array<{ name: string }>;
    const existing = new Set(cols.map((c) => c.name));
    for (const ddl of USAGE_EVENT_COLUMNS) {
      const name = ddl.split(" ")[0];
      if (!existing.has(name)) {
        this.db.exec(`ALTER TABLE usage_events ADD COLUMN ${ddl}`);
      }
    }
  }

  close(): void {
    this.db.close();
  }

  createContext(c: Context): Context {
    this.db
      .prepare(
        `INSERT INTO contexts (id, name, description, category, content, tags, priority, visibility,
          created_at, updated_at, created_by, version, status, token_count)
         VALUES (@id, @name, @description, @category, @content, @tags, @priority, @visibility,
          @created_at, @updated_at, @created_by, @version, @status, @token_count)`,
      )
      .run({ ...c, tags: JSON.stringify(c.tags) });
    this.indexContextFts(c);
    return c;
  }

  getContext(id: string): Context | null {
    const row = this.db
      .prepare("SELECT * FROM contexts WHERE id = ?")
      .get(id) as ContextRow | undefined;
    return row ? rowToContext(row) : null;
  }

  updateContext(id: string, next: Context): Context {
    const res = this.db
      .prepare(
        `UPDATE contexts
            SET name=@name, description=@description, category=@category, content=@content,
                tags=@tags, priority=@priority, visibility=@visibility,
                updated_at=@updated_at, version=@version, status=@status, token_count=@token_count
          WHERE id=@id`,
      )
      .run({ ...next, tags: JSON.stringify(next.tags) });
    if (res.changes === 0) throw new NotFoundError("Context", id);
    this.indexContextFts(next);
    return next;
  }

  archiveContext(id: string): Context {
    const existing = this.getContext(id);
    if (!existing) throw new NotFoundError("Context", id);
    const next: Context = {
      ...existing,
      status: "archived",
      updated_at: new Date().toISOString(),
      version: existing.version + 1,
    };
    return this.updateContext(id, next);
  }

  deleteContext(id: string): void {
    const res = this.db.prepare("DELETE FROM contexts WHERE id = ?").run(id);
    if (res.changes === 0) throw new NotFoundError("Context", id);
    this.db.prepare("DELETE FROM contexts_fts WHERE id = ?").run(id);
  }

  listContexts(filter: ContextFilter = {}): Context[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.category) {
      where.push("category = @category");
      params.category = filter.category;
    }
    if (filter.status) {
      where.push("status = @status");
      params.status = filter.status;
    }
    if (filter.visibility) {
      where.push("visibility = @visibility");
      params.visibility = filter.visibility;
    }
    if (filter.search) {
      where.push("(name LIKE @search OR description LIKE @search)");
      params.search = `%${filter.search}%`;
    }
    const sql = `SELECT * FROM contexts ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY updated_at DESC
                 LIMIT @limit OFFSET @offset`;
    params.limit = filter.limit ?? 200;
    params.offset = filter.offset ?? 0;
    const rows = this.db.prepare(sql).all(params) as ContextRow[];
    let out = rows.map(rowToContext);
    if (filter.tags?.length) {
      const required = new Set(filter.tags);
      out = out.filter((c) => c.tags.some((t) => required.has(t)));
    }
    return out;
  }

  getContextsByIds(ids: string[]): Context[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM contexts WHERE id IN (${placeholders})`)
      .all(...ids) as ContextRow[];
    const byId = new Map(rows.map((r) => [r.id, rowToContext(r)]));
    return ids.map((id) => byId.get(id)).filter((x): x is Context => Boolean(x));
  }

  createProject(p: Project): Project {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, root_path, settings, created_at, updated_at, owner)
         VALUES (@id, @name, @description, @root_path, @settings, @created_at, @updated_at, @owner)`,
      )
      .run({ ...p, settings: JSON.stringify(p.settings) });
    return p;
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | ProjectRow
      | undefined;
    if (!row) return null;
    const refs = this.db
      .prepare(
        `SELECT context_id, position, priority_override FROM project_contexts
         WHERE project_id = ? ORDER BY position ASC`,
      )
      .all(id) as ProjectContextRow[];
    return rowToProject(row, refs);
  }

  getProjectByName(name: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE name = ?").get(name) as
      | ProjectRow
      | undefined;
    return row ? this.getProject(row.id) : null;
  }

  getProjectByRootPath(rootPath: string): Project | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE root_path = ?")
      .get(rootPath) as ProjectRow | undefined;
    return row ? this.getProject(row.id) : null;
  }

  updateProject(p: Project): Project {
    const res = this.db
      .prepare(
        `UPDATE projects SET name=@name, description=@description, root_path=@root_path,
                             settings=@settings, updated_at=@updated_at, owner=@owner
         WHERE id=@id`,
      )
      .run({ ...p, settings: JSON.stringify(p.settings) });
    if (res.changes === 0) throw new NotFoundError("Project", p.id);
    return p;
  }

  deleteProject(id: string): void {
    const res = this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (res.changes === 0) throw new NotFoundError("Project", id);
  }

  listProjects(): Project[] {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRow[];
    return rows.map((r) => this.getProject(r.id)!).filter(Boolean);
  }

  attachContext(projectId: string, ref: ProjectContextRef): void {
    this.db
      .prepare(
        `INSERT INTO project_contexts (project_id, context_id, position, priority_override, attached_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, context_id) DO UPDATE SET
           position = excluded.position,
           priority_override = excluded.priority_override`,
      )
      .run(
        projectId,
        ref.context_id,
        ref.position,
        ref.priority_override ?? null,
        new Date().toISOString(),
      );
  }

  detachContext(projectId: string, contextId: string): void {
    const res = this.db
      .prepare("DELETE FROM project_contexts WHERE project_id = ? AND context_id = ?")
      .run(projectId, contextId);
    if (res.changes === 0)
      throw new NotFoundError(`Project-context link (${projectId})`, contextId);
  }

  reorderContexts(projectId: string, orderedContextIds: string[]): void {
    const upd = this.db.prepare(
      "UPDATE project_contexts SET position = ? WHERE project_id = ? AND context_id = ?",
    );
    const tx = this.db.transaction((ids: string[]) => {
      ids.forEach((cid, i) => upd.run(i, projectId, cid));
    });
    tx(orderedContextIds);
  }

  setPriorityOverride(projectId: string, contextId: string, priority: Priority | null): void {
    const res = this.db
      .prepare(
        "UPDATE project_contexts SET priority_override = ? WHERE project_id = ? AND context_id = ?",
      )
      .run(priority, projectId, contextId);
    if (res.changes === 0)
      throw new NotFoundError(`Project-context link (${projectId})`, contextId);
  }

  listProjectsReferencing(contextId: string): string[] {
    const rows = this.db
      .prepare("SELECT project_id FROM project_contexts WHERE context_id = ?")
      .all(contextId) as Array<{ project_id: string }>;
    return rows.map((r) => r.project_id);
  }

  listProjectContextRefs(projectId: string): ProjectContextRef[] {
    const rows = this.db
      .prepare(
        "SELECT context_id, position, priority_override FROM project_contexts WHERE project_id = ? ORDER BY position ASC",
      )
      .all(projectId) as ProjectContextRow[];
    return rows.map((r) => ({
      context_id: r.context_id,
      position: r.position,
      priority_override: (r.priority_override as Priority | null) ?? undefined,
    }));
  }

  createCategory(name: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)")
      .run(name, new Date().toISOString());
  }

  listCategories(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM categories ORDER BY name ASC")
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  searchContexts(opts: SearchOptions): SearchResultItem[] {
    const limit = opts.limit ?? 20;
    const ftsQuery = sanitiseFtsQuery(opts.query);
    if (!ftsQuery) return [];
    const params: Record<string, unknown> = { q: ftsQuery, limit };
    let sql = `
      SELECT c.id, c.name, c.description, c.category, c.priority, c.token_count,
             bm25(contexts_fts) AS score,
             snippet(contexts_fts, 2, '[', ']', '...', 12) AS snippet
        FROM contexts_fts
        JOIN contexts c ON c.id = contexts_fts.id
       WHERE contexts_fts MATCH @q AND c.status = 'active'
    `;
    if (opts.projectId) {
      sql += " AND c.id IN (SELECT context_id FROM project_contexts WHERE project_id = @projectId)";
      params.projectId = opts.projectId;
    }
    sql += " ORDER BY score ASC LIMIT @limit";
    const rows = this.db.prepare(sql).all(params) as Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      priority: string;
      token_count: number;
      score: number;
      snippet: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      priority: r.priority as Priority,
      token_count: r.token_count,
      score: r.score,
      snippet: r.snippet,
    }));
  }

  recordUsage(event: UsageEvent): void {
    this.db
      .prepare(
        `INSERT INTO usage_events (occurred_at, source, tool_name, project_id, context_id,
                                   duration_ms, outcome, error_code, metadata,
                                   client_name, client_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.occurred_at,
        event.source,
        event.tool_name,
        event.project_id,
        event.context_id,
        event.duration_ms,
        event.outcome,
        event.error_code,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.client_name,
        event.client_version,
      );
  }

  countUsage(filter: UsageFilter): { total: number; errors: number; last_seen: string | null } {
    const { where, params } = this.buildUsageWhere(filter);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
                MAX(occurred_at) AS last_seen
           FROM usage_events ${where}`,
      )
      .get(params) as { total: number; errors: number | null; last_seen: string | null };
    return {
      total: row.total ?? 0,
      errors: row.errors ?? 0,
      last_seen: row.last_seen,
    };
  }

  aggregateUsage(
    filter: UsageFilter,
    by: "tool_name" | "project_id" | "context_id" | "source" | "client_name",
  ): UsageBucket[] {
    const { where, params } = this.buildUsageWhere(filter);
    const rows = this.db
      .prepare(
        `SELECT ${by} AS key,
                COUNT(*) AS count,
                SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
                MAX(occurred_at) AS last_seen
           FROM usage_events
                ${where}
          GROUP BY ${by}
          ORDER BY count DESC`,
      )
      .all(params) as Array<{
      key: string | null;
      count: number;
      errors: number | null;
      last_seen: string | null;
    }>;
    return rows
      .filter((r) => r.key !== null)
      .map((r) => ({
        key: r.key as string,
        label: r.key as string,
        count: r.count,
        error_count: r.errors ?? 0,
        last_seen: r.last_seen,
      }));
  }

  recentUsage(filter: UsageFilter, limit: number): UsageEvent[] {
    const { where, params } = this.buildUsageWhere(filter);
    const rows = this.db
      .prepare(
        `SELECT occurred_at, source, tool_name, project_id, context_id,
                duration_ms, outcome, error_code, metadata, client_name, client_version
           FROM usage_events ${where}
          ORDER BY occurred_at DESC
          LIMIT @limit`,
      )
      .all({ ...params, limit }) as Array<{
      occurred_at: string;
      source: string;
      tool_name: string;
      project_id: string | null;
      context_id: string | null;
      duration_ms: number | null;
      outcome: string;
      error_code: string | null;
      metadata: string | null;
      client_name: string | null;
      client_version: string | null;
    }>;
    return rows.map((r) => ({
      occurred_at: r.occurred_at,
      source: r.source as UsageSource,
      tool_name: r.tool_name,
      project_id: r.project_id,
      context_id: r.context_id,
      duration_ms: r.duration_ms,
      outcome: r.outcome as UsageEvent["outcome"],
      error_code: r.error_code,
      metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
      client_name: r.client_name,
      client_version: r.client_version,
    }));
  }

  dailyUsage(filter: UsageFilter): Array<{ day: string; count: number; errors: number }> {
    const { where, params } = this.buildUsageWhere(filter);
    const rows = this.db
      .prepare(
        `SELECT substr(occurred_at, 1, 10) AS day,
                COUNT(*) AS count,
                SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors
           FROM usage_events ${where}
          GROUP BY day
          ORDER BY day ASC`,
      )
      .all(params) as Array<{ day: string; count: number; errors: number | null }>;
    return rows.map((r) => ({ day: r.day, count: r.count, errors: r.errors ?? 0 }));
  }

  private buildUsageWhere(filter: UsageFilter): {
    where: string;
    params: Record<string, unknown>;
  } {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.since) {
      clauses.push("occurred_at >= @since");
      params.since = filter.since;
    }
    if (filter.project_id) {
      clauses.push("project_id = @project_id");
      params.project_id = filter.project_id;
    }
    if (filter.context_id) {
      clauses.push("context_id = @context_id");
      params.context_id = filter.context_id;
    }
    if (filter.tool_name) {
      clauses.push("tool_name = @tool_name");
      params.tool_name = filter.tool_name;
    }
    if (filter.source) {
      clauses.push("source = @source");
      params.source = filter.source;
    }
    if (filter.client_name) {
      clauses.push("client_name = @client_name");
      params.client_name = filter.client_name;
    }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    return { where, params };
  }

  private indexContextFts(c: Context): void {
    this.db.prepare("DELETE FROM contexts_fts WHERE id = ?").run(c.id);
    this.db
      .prepare(
        `INSERT INTO contexts_fts (id, name, description, content, tags, category)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.name, c.description, c.content, c.tags.join(" "), c.category);
  }
}

function sanitiseFtsQuery(q: string): string {
  const cleaned = q.replace(/["']/g, " ").trim();
  if (!cleaned) return "";
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}
