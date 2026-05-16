import { v4 as uuid } from "uuid";
import type { Repository } from "../storage/repository.js";
import {
  type Project,
  type CreateProjectInput,
  type Priority,
  type ProjectContextRef,
  ProjectSchema,
  ProjectSettings,
  CreateProjectInput as CreateProjectInputSchema,
} from "./types.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { ManifestService } from "./manifest-service.js";

export class ProjectService {
  constructor(
    private readonly repo: Repository,
    private readonly manifests?: ManifestService,
  ) {}

  create(input: CreateProjectInput): Project {
    const parsed = CreateProjectInputSchema.parse(input);
    const now = new Date().toISOString();
    const project: Project = ProjectSchema.parse({
      id: uuid(),
      name: parsed.name,
      description: parsed.description,
      context_refs: [],
      root_path: parsed.root_path,
      settings: ProjectSettings.parse({ ...ProjectSettings.parse({}), ...parsed.settings }),
      created_at: now,
      updated_at: now,
      owner: parsed.owner,
    });
    return this.repo.createProject(project);
  }

  get(id: string): Project {
    const p = this.repo.getProject(id);
    if (!p) throw new NotFoundError("Project", id);
    return p;
  }

  getByRootPath(rootPath: string): Project | null {
    return this.repo.getProjectByRootPath(rootPath);
  }

  getByName(name: string): Project | null {
    return this.repo.getProjectByName(name);
  }

  list(): Project[] {
    return this.repo.listProjects();
  }

  attach(
    projectId: string,
    contextId: string,
    options: { position?: number; priority_override?: Priority } = {},
  ): Project {
    const project = this.get(projectId);
    const context = this.repo.getContext(contextId);
    if (!context) throw new NotFoundError("Context", contextId);

    const current = project.context_refs.slice().sort((a, b) => a.position - b.position);
    const existingRef = current.find((r) => r.context_id === contextId);
    const without = current.filter((r) => r.context_id !== contextId);

    let targetPos: number;
    if (options.position !== undefined) {
      targetPos = Math.max(0, Math.min(options.position, without.length));
    } else if (existingRef) {
      targetPos = Math.min(existingRef.position, without.length);
    } else {
      targetPos = without.length;
    }

    const priorityOverride =
      options.priority_override ?? existingRef?.priority_override;

    const inserted: ProjectContextRef = {
      context_id: contextId,
      position: targetPos,
      priority_override: priorityOverride,
    };
    const next = [...without.slice(0, targetPos), inserted, ...without.slice(targetPos)];
    this.writeOrder(projectId, next);
    this.touchProject(projectId);
    this.regenerateManifest(projectId);
    return this.get(projectId);
  }

  detach(projectId: string, contextId: string): Project {
    this.get(projectId);
    this.repo.detachContext(projectId, contextId);
    this.compactPositions(projectId);
    this.touchProject(projectId);
    this.regenerateManifest(projectId);
    return this.get(projectId);
  }

  reorder(projectId: string, orderedContextIds: string[]): Project {
    const project = this.get(projectId);
    const known = new Set(project.context_refs.map((r) => r.context_id));
    if (orderedContextIds.length !== known.size) {
      throw new ValidationError(
        `reorder requires all ${known.size} attached context ids; got ${orderedContextIds.length}`,
      );
    }
    for (const id of orderedContextIds) {
      if (!known.has(id))
        throw new ValidationError(`context ${id} is not attached to project ${projectId}`);
    }
    this.repo.reorderContexts(projectId, orderedContextIds);
    this.touchProject(projectId);
    this.regenerateManifest(projectId);
    return this.get(projectId);
  }

  setPriorityOverride(
    projectId: string,
    contextId: string,
    priority: Priority | null,
  ): Project {
    this.get(projectId);
    this.repo.setPriorityOverride(projectId, contextId, priority);
    this.touchProject(projectId);
    this.regenerateManifest(projectId);
    return this.get(projectId);
  }

  private writeOrder(projectId: string, refs: ProjectContextRef[]): void {
    refs.forEach((ref, index) => {
      this.repo.attachContext(projectId, {
        context_id: ref.context_id,
        position: index,
        priority_override: ref.priority_override,
      });
    });
  }

  private compactPositions(projectId: string): void {
    const refs = this.repo.listProjectContextRefs(projectId);
    const ordered = [...refs].sort((a, b) => a.position - b.position).map((r) => r.context_id);
    this.repo.reorderContexts(projectId, ordered);
  }

  private touchProject(projectId: string): void {
    const p = this.get(projectId);
    this.repo.updateProject({ ...p, updated_at: new Date().toISOString() });
  }

  private regenerateManifest(projectId: string): void {
    if (!this.manifests) return;
    const project = this.repo.getProject(projectId);
    if (!project?.root_path) return;
    const manifest = this.manifests.build(projectId);
    try {
      this.manifests.writeToProjectRoot(project, manifest);
    } catch {
      // ignore manifest write failures (e.g., read-only fs in tests)
    }
  }
}
