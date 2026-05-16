import { SqliteRepository } from "../storage/sqlite/sqlite-repository.js";
import { ContextService } from "./context-service.js";
import { ProjectService } from "./project-service.js";
import { ManifestService } from "./manifest-service.js";
import { UsageService } from "./usage-service.js";
import { resolveDbPath } from "../config/paths.js";
import type { Repository } from "../storage/repository.js";

export interface Services {
  repo: Repository;
  contexts: ContextService;
  projects: ProjectService;
  manifests: ManifestService;
  usage: UsageService;
  close(): void;
}

export function buildServices(dbPath?: string): Services {
  const repo = new SqliteRepository(resolveDbPath(dbPath));
  repo.init();
  const manifests = new ManifestService(repo);
  const usage = new UsageService(repo);
  return {
    repo,
    contexts: new ContextService(repo, manifests),
    projects: new ProjectService(repo, manifests),
    manifests,
    usage,
    close: () => repo.close(),
  };
}
