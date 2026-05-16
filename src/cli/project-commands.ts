import { Command } from "commander";
import { resolve } from "node:path";
import { buildServices } from "../core/services.js";
import { Priority } from "../core/types.js";
import { exitWithError, printJson, table } from "./output.js";
import { requireActiveProject } from "./active-project.js";
import { resolveContextId } from "./context-commands.js";
import { ensureProjectDirective } from "./claude-md.js";
import { tracked } from "./track.js";

export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("Manage projects and their attached contexts");

  project
    .command("init")
    .description("Initialise a project in the current directory and write its manifest")
    .option("-n, --name <name>", "Project name (defaults to directory name)")
    .option("-d, --description <desc>", "Project description", "")
    .option("--no-manifest", "Skip writing the manifest file")
    .option("--no-claude-md", "Skip scaffolding the CLAUDE.md directive block")
    .action((opts) => {
      const services = buildServices();
      try {
        const rootPath = resolve(process.cwd());
        const existing = services.projects.getByRootPath(rootPath);
        const claudeMd = opts.claudeMd
          ? ensureProjectDirective(rootPath)
          : null;
        if (existing) {
          process.stderr.write(`Project already exists for ${rootPath}: ${existing.id}\n`);
          if (opts.manifest) {
            const m = services.manifests.build(existing.id);
            const written = services.manifests.writeToProjectRoot(existing, m);
            printJson({ project: existing, manifest_path: written, claude_md: claudeMd });
            return;
          }
          printJson({ project: existing, claude_md: claudeMd });
          return;
        }
        const name = opts.name ?? rootPath.split("/").filter(Boolean).pop() ?? "project";
        const created = services.projects.create({
          name,
          description: opts.description ?? "",
          root_path: rootPath,
          settings: {},
          owner: "user",
        });
        if (opts.manifest) {
          const manifest = services.manifests.build(created.id);
          const written = services.manifests.writeToProjectRoot(created, manifest);
          printJson({ project: created, manifest_path: written, claude_md: claudeMd });
        } else {
          printJson({ project: created, claude_md: claudeMd });
        }
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  project
    .command("list")
    .description("List all projects")
    .option("--json", "JSON output")
    .action((opts) => {
      const services = buildServices();
      try {
        const items = services.projects.list();
        if (opts.json) printJson(items);
        else
          table(
            items.map((p) => ({
              id: p.id.slice(0, 8),
              name: p.name,
              contexts: p.context_refs.length,
              root: p.root_path ?? "",
              updated: p.updated_at.slice(0, 19).replace("T", " "),
            })),
          );
      } finally {
        services.close();
      }
    });

  project
    .command("attach")
    .description("Attach a context to the current project")
    .argument("<context_id>", "Context ID (full or prefix)")
    .option("--project <id>", "Project ID override")
    .option("--position <n>", "Position (0-based)")
    .option("--priority <priority>", "Override priority for this attachment")
    .action(async (id, opts) => {
      const services = buildServices();
      try {
        const project = requireActiveProject(services, opts.project);
        const contextId = resolveContextId(services, id);
        const updated = await tracked(
          services,
          "cli.project.attach",
          () =>
            services.projects.attach(project.id, contextId, {
              position: opts.position !== undefined ? Number(opts.position) : undefined,
              priority_override: opts.priority ? Priority.parse(opts.priority) : undefined,
            }),
          () => ({ project_id: project.id, context_id: contextId }),
        );
        const manifest = services.manifests.build(updated.id);
        if (updated.root_path) services.manifests.writeToProjectRoot(updated, manifest);
        printJson({ project: updated, manifest });
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  project
    .command("detach")
    .description("Detach a context from the current project")
    .argument("<context_id>", "Context ID (full or prefix)")
    .option("--project <id>", "Project ID override")
    .action(async (id, opts) => {
      const services = buildServices();
      try {
        const project = requireActiveProject(services, opts.project);
        const contextId = resolveContextId(services, id);
        const updated = await tracked(
          services,
          "cli.project.detach",
          () => services.projects.detach(project.id, contextId),
          () => ({ project_id: project.id, context_id: contextId }),
        );
        const manifest = services.manifests.build(updated.id);
        if (updated.root_path) services.manifests.writeToProjectRoot(updated, manifest);
        printJson({ project: updated });
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  project
    .command("contexts")
    .description("List contexts attached to the current project")
    .option("--project <id>", "Project ID override")
    .option("--json", "JSON output")
    .action((opts) => {
      const services = buildServices();
      try {
        const project = requireActiveProject(services, opts.project);
        const manifest = services.manifests.build(project.id);
        if (opts.json) printJson(manifest);
        else
          table(
            manifest.contexts.map((c, i) => ({
              "#": i,
              id: c.context_id.slice(0, 8),
              name: c.name,
              category: c.category,
              priority: c.priority,
              tokens: c.token_count,
            })),
          );
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  project
    .command("manifest")
    .description("Regenerate the manifest file for the current project")
    .option("--project <id>", "Project ID override")
    .option("--stdout", "Print to stdout instead of writing the file")
    .action((opts) => {
      const services = buildServices();
      try {
        const project = requireActiveProject(services, opts.project);
        const manifest = services.manifests.build(project.id);
        if (opts.stdout || !project.root_path) {
          printJson(manifest);
          return;
        }
        const path = services.manifests.writeToProjectRoot(project, manifest);
        printJson({ written: path, total_token_count: manifest.total_token_count });
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  project
    .command("budget")
    .description("Show which contexts fit within a token budget")
    .requiredOption("--budget <n>", "Token budget")
    .option("--project <id>", "Project ID override")
    .action((opts) => {
      const services = buildServices();
      try {
        const project = requireActiveProject(services, opts.project);
        const result = services.manifests.buildBudget(project.id, Number(opts.budget));
        printJson({
          budget: result.budget,
          total_tokens: result.total_tokens,
          included: result.included.map((c) => ({
            id: c.id,
            name: c.name,
            priority: c.priority,
            tokens: c.token_count,
          })),
          excluded: result.excluded,
        });
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  project
    .command("reorder")
    .description("Reorder the attached contexts (pass full ordered list)")
    .requiredOption("--ids <ids>", "Comma-separated ordered context ids")
    .option("--project <id>", "Project ID override")
    .action((opts) => {
      const services = buildServices();
      try {
        const project = requireActiveProject(services, opts.project);
        const ids = String(opts.ids)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => resolveContextId(services, s));
        const updated = services.projects.reorder(project.id, ids);
        const manifest = services.manifests.build(updated.id);
        if (updated.root_path) services.manifests.writeToProjectRoot(updated, manifest);
        printJson({ project: updated });
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });
}
