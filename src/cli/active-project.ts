import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../config/paths.js";
import type { Services } from "../core/services.js";
import type { Project } from "../core/types.js";

export function resolveActiveProject(services: Services, explicitId?: string): Project | null {
  if (explicitId) return services.projects.get(explicitId);
  if (process.env.CONTEXT_PROJECT_ID) {
    return services.projects.get(process.env.CONTEXT_PROJECT_ID);
  }
  const root = findProjectRoot();
  if (!root) return null;
  const manifestPath = join(root, ".context", "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as { project_id?: string };
      if (raw.project_id) return services.projects.get(raw.project_id);
    } catch {
      // fall through
    }
  }
  return services.projects.getByRootPath(root);
}

export function requireActiveProject(services: Services, explicitId?: string): Project {
  const p = resolveActiveProject(services, explicitId);
  if (!p) {
    throw new Error(
      "No active project. Run `context project init` or pass --project <id>.",
    );
  }
  return p;
}
