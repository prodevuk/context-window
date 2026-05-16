import type { Repository, UsageFilter } from "../storage/repository.js";
import type {
  UsageEvent,
  UsageStats,
  UsageBucket,
  UsageSource,
  UsageOutcome,
} from "./types.js";

const DEFAULT_WINDOW_DAYS = 30;

export interface RecordOptions {
  source: UsageSource;
  tool_name: string;
  project_id?: string | null;
  context_id?: string | null;
  duration_ms?: number;
  outcome: UsageOutcome;
  error_code?: string | null;
  metadata?: Record<string, unknown> | null;
  client_name?: string | null;
  client_version?: string | null;
}

export class UsageService {
  constructor(private readonly repo: Repository) {}

  record(opts: RecordOptions): void {
    const event: UsageEvent = {
      occurred_at: new Date().toISOString(),
      source: opts.source,
      tool_name: opts.tool_name,
      project_id: opts.project_id ?? null,
      context_id: opts.context_id ?? null,
      duration_ms: opts.duration_ms ?? null,
      outcome: opts.outcome,
      error_code: opts.error_code ?? null,
      metadata: opts.metadata ?? null,
      client_name: opts.client_name ?? null,
      client_version: opts.client_version ?? null,
    };
    try {
      this.repo.recordUsage(event);
    } catch {
      // never let metric writes break the request path
    }
  }

  overview(opts: { sinceDays?: number; limitBuckets?: number } = {}): UsageStats {
    return this.buildStats({}, opts, "overview");
  }

  forProject(projectId: string, opts: { sinceDays?: number; limitBuckets?: number } = {}): UsageStats {
    return this.buildStats({ project_id: projectId }, opts, "project", projectId);
  }

  forContext(contextId: string, opts: { sinceDays?: number; limitBuckets?: number } = {}): UsageStats {
    return this.buildStats({ context_id: contextId }, opts, "context", contextId);
  }

  forTool(toolName: string, opts: { sinceDays?: number; limitBuckets?: number } = {}): UsageStats {
    return this.buildStats({ tool_name: toolName }, opts, "tool", toolName);
  }

  recent(filter: UsageFilter, limit = 20): UsageEvent[] {
    return this.repo.recentUsage(filter, limit);
  }

  private buildStats(
    base: UsageFilter,
    opts: { sinceDays?: number; limitBuckets?: number },
    kind: UsageStats["scope"]["kind"],
    id?: string,
  ): UsageStats {
    const sinceDays = opts.sinceDays ?? DEFAULT_WINDOW_DAYS;
    const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    const since = new Date(sinceMs).toISOString();
    const filter: UsageFilter = { ...base, since };
    const limit = opts.limitBuckets ?? 10;

    const overall = this.repo.countUsage(filter);
    const by_tool = trim(this.repo.aggregateUsage(filter, "tool_name"), limit);
    const by_project = trim(this.repo.aggregateUsage(filter, "project_id"), limit);
    const by_context = trim(this.repo.aggregateUsage(filter, "context_id"), limit);
    const by_source = trim(
      this.repo.aggregateUsage(filter, "source") as UsageBucket<UsageSource>[],
      limit,
    );
    const by_client = trim(this.repo.aggregateUsage(filter, "client_name"), limit);
    const daily = this.repo.dailyUsage(filter);

    return {
      scope: { kind, id },
      total: overall.total,
      errors: overall.errors,
      last_seen: overall.last_seen,
      by_tool,
      by_project,
      by_context,
      by_source,
      by_client,
      daily,
      since,
    };
  }
}

function trim<T extends UsageBucket<string>>(buckets: T[], limit: number): T[] {
  return buckets.slice(0, limit);
}
