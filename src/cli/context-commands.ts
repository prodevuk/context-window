import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { buildServices } from "../core/services.js";
import { Priority, Visibility, Status } from "../core/types.js";
import { exitWithError, printJson, table } from "./output.js";
import { tracked } from "./track.js";

export function registerContextCommands(program: Command): void {
  const context = program.command("context").description("Manage standalone contexts");

  context
    .command("init")
    .description("Initialise the context database (creates schema & seeds categories)")
    .option("--db <path>", "Database path override")
    .action((opts) => {
      const services = buildServices(opts.db);
      services.close();
      printJson({ initialised: true });
    });

  context
    .command("new")
    .description("Create a new context. Provide --content or --content-file.")
    .requiredOption("-n, --name <name>", "Context name")
    .requiredOption("-d, --description <desc>", "Short description")
    .option("--content <text>", "Inline content")
    .option("--content-file <path>", "Read content from a file")
    .option("--category <category>", "Category", "custom")
    .option("--tags <tags>", "Comma-separated tags", "")
    .option("--priority <priority>", "critical|important|reference|archived", "reference")
    .option("--visibility <visibility>", "private|shared|public", "private")
    .option("--created-by <by>", "Creator identifier", "user")
    .action(async (opts) => {
      try {
        let content = opts.content as string | undefined;
        if (!content && opts.contentFile) content = readFileSync(opts.contentFile, "utf8");
        if (content === undefined) throw new Error("--content or --content-file is required");
        const services = buildServices();
        try {
          const result = await tracked(
            services,
            "cli.context.new",
            () =>
              services.contexts.create({
                name: opts.name,
                description: opts.description,
                content,
                category: opts.category,
                tags: String(opts.tags || "")
                  .split(",")
                  .map((t: string) => t.trim())
                  .filter(Boolean),
                priority: Priority.parse(opts.priority),
                visibility: Visibility.parse(opts.visibility),
                created_by: opts.createdBy,
              }),
            (r) => ({ context_id: r.context.id }),
          );
          printJson({ context: result.context, warnings: result.warnings });
        } finally {
          services.close();
        }
      } catch (err) {
        exitWithError(err);
      }
    });

  context
    .command("list")
    .description("List contexts")
    .option("--category <category>")
    .option("--status <status>")
    .option("--visibility <visibility>")
    .option("--tag <tag>", "Repeatable", (val: string, prev: string[]) => prev.concat(val), [])
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Limit results", "200")
    .action((opts) => {
      const services = buildServices();
      try {
        const items = services.contexts.list({
          category: opts.category,
          status: opts.status ? Status.parse(opts.status) : undefined,
          visibility: opts.visibility ? Visibility.parse(opts.visibility) : undefined,
          tags: opts.tag,
          limit: Number(opts.limit),
        });
        if (opts.json) printJson(items);
        else
          table(
            items.map((c) => ({
              id: c.id.slice(0, 8),
              name: c.name,
              category: c.category,
              priority: c.priority,
              status: c.status,
              tokens: c.token_count,
              updated: c.updated_at.slice(0, 19).replace("T", " "),
            })),
          );
      } finally {
        services.close();
      }
    });

  context
    .command("search")
    .description("Full-text search over contexts")
    .argument("<query>", "Search query")
    .option("--limit <n>", "Limit results", "20")
    .option("--json", "Output as JSON")
    .action((query, opts) => {
      const services = buildServices();
      try {
        const results = services.contexts.search({ query, limit: Number(opts.limit) });
        if (opts.json) printJson(results);
        else
          table(
            results.map((r) => ({
              id: r.id.slice(0, 8),
              name: r.name,
              category: r.category,
              priority: r.priority,
              tokens: r.token_count,
              score: r.score.toFixed(3),
              snippet: r.snippet ?? "",
            })),
          );
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  context
    .command("show")
    .description("Display a context's full content")
    .argument("<id>", "Context ID (full or prefix)")
    .option("--json", "Output as JSON")
    .action((id, opts) => {
      const services = buildServices();
      try {
        const resolved = resolveContextId(services, id);
        const c = services.contexts.get(resolved);
        if (opts.json) {
          printJson(c);
        } else {
          process.stdout.write(`# ${c.name}\n`);
          process.stdout.write(`Description: ${c.description}\n`);
          process.stdout.write(`Category: ${c.category} | Priority: ${c.priority} | Status: ${c.status}\n`);
          process.stdout.write(`Tags: ${c.tags.join(", ") || "(none)"}\n`);
          process.stdout.write(`Tokens: ${c.token_count} | Version: ${c.version}\n\n`);
          process.stdout.write(c.content + "\n");
        }
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  context
    .command("edit")
    .description("Edit a context's content in $EDITOR")
    .argument("<id>", "Context ID (full or prefix)")
    .action(async (id) => {
      const services = buildServices();
      try {
        const resolved = resolveContextId(services, id);
        const c = services.contexts.get(resolved);
        const tmp = `${process.env.TMPDIR ?? "/tmp"}/context-${c.id}-${Date.now()}.md`;
        writeFileSync(tmp, c.content, "utf8");
        const editor = process.env.EDITOR ?? "vi";
        await new Promise<void>((res, rej) => {
          const child = spawn(editor, [tmp], { stdio: "inherit" });
          child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${editor} exited ${code}`))));
        });
        const next = readFileSync(tmp, "utf8");
        const updated = await tracked(
          services,
          "cli.context.edit",
          () => services.contexts.update(c.id, { content: next }),
          (u) => ({ context_id: u.id }),
        );
        printJson({ updated: { id: updated.id, version: updated.version, token_count: updated.token_count } });
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  context
    .command("archive")
    .description("Archive a context")
    .argument("<id>", "Context ID (full or prefix)")
    .action(async (id) => {
      const services = buildServices();
      try {
        const resolved = resolveContextId(services, id);
        const out = await tracked(
          services,
          "cli.context.archive",
          () => services.contexts.archive(resolved),
          (c) => ({ context_id: c.id }),
        );
        printJson(out);
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  context
    .command("delete")
    .description("Permanently delete a context")
    .argument("<id>", "Context ID (full or prefix)")
    .option("-y, --yes", "Skip confirmation")
    .action(async (id, opts) => {
      const services = buildServices();
      try {
        const resolved = resolveContextId(services, id);
        if (!opts.yes) {
          process.stderr.write("Refusing to delete without --yes. Use 'context archive' instead.\n");
          process.exit(2);
        }
        await tracked(
          services,
          "cli.context.delete",
          () => services.contexts.delete(resolved),
          () => ({ context_id: resolved }),
        );
        printJson({ deleted: resolved });
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  context
    .command("export")
    .description("Export contexts as JSON to stdout")
    .option("--ids <ids>", "Comma-separated context ids; default all active")
    .action((opts) => {
      const services = buildServices();
      try {
        if (opts.ids) {
          const ids = String(opts.ids).split(",").map((s: string) => s.trim()).filter(Boolean);
          printJson(services.repo.getContextsByIds(ids));
        } else {
          printJson(services.contexts.list({ status: "active", limit: 10_000 }));
        }
      } finally {
        services.close();
      }
    });

  context
    .command("import")
    .description("Import contexts from a JSON file (array of context inputs)")
    .requiredOption("-f, --file <path>", "JSON file")
    .action((opts) => {
      const services = buildServices();
      try {
        const raw = readFileSync(opts.file, "utf8");
        const items = JSON.parse(raw) as Array<Record<string, unknown>>;
        const created = items.map((it) =>
          services.contexts.create({
            name: String(it.name ?? ""),
            description: String(it.description ?? ""),
            content: String(it.content ?? ""),
            category: it.category ? String(it.category) : undefined,
            tags: Array.isArray(it.tags) ? (it.tags as string[]) : undefined,
            priority: it.priority ? Priority.parse(it.priority) : undefined,
            visibility: it.visibility ? Visibility.parse(it.visibility) : undefined,
            created_by: it.created_by ? String(it.created_by) : undefined,
          } as never),
        );
        printJson({ imported: created.length, ids: created.map((c) => c.context.id) });
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  context
    .command("stats")
    .description("Show usage statistics across all projects, contexts, and tools")
    .option("--scope <scope>", "overview | tool | context", "overview")
    .option("--tool <name>", "Tool name when --scope tool")
    .option("--context <id>", "Context id when --scope context")
    .option("--days <n>", "Look back N days", "30")
    .option("--json", "JSON output")
    .action((opts) => {
      const services = buildServices();
      try {
        const sinceDays = Number(opts.days);
        let stats;
        if (opts.scope === "tool") {
          if (!opts.tool) throw new Error("--tool is required for --scope tool");
          stats = services.usage.forTool(opts.tool, { sinceDays });
        } else if (opts.scope === "context") {
          if (!opts.context) throw new Error("--context is required for --scope context");
          stats = services.usage.forContext(resolveContextId(services, opts.context), { sinceDays });
        } else {
          stats = services.usage.overview({ sinceDays });
        }
        if (opts.json) {
          printJson(stats);
          return;
        }
        printStats(stats);
      } catch (err) {
        exitWithError(err);
      } finally {
        services.close();
      }
    });

  context
    .command("web")
    .description("Start the web UI (Express) for managing contexts and projects")
    .option("-p, --port <port>", "Port to listen on", "5173")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--db <path>", "Database path override")
    .action(async (opts) => {
      const { startWeb } = await import("../web/server.js");
      await startWeb({
        port: Number(opts.port),
        host: opts.host,
        dbPath: opts.db,
      });
    });

  context
    .command("serve")
    .description("Run the MCP server (stdio) for the current project")
    .option("--project <id>", "Project ID")
    .action(async (opts) => {
      const { fileURLToPath } = await import("node:url");
      const here = fileURLToPath(import.meta.url);
      const dir = here.replace(/\/cli\/context-commands\.[tj]s$/, "");
      const args: string[] = [];
      if (opts.project) args.push("--project-id", opts.project);
      const child = spawn("node", [`${dir}/mcp/server.js`, ...args], { stdio: "inherit" });
      child.on("exit", (code) => process.exit(code ?? 0));
    });
}

export function printStats(stats: import("../core/types.js").UsageStats): void {
  process.stdout.write(
    `${stats.scope.kind}${stats.scope.id ? `:${stats.scope.id}` : ""}  since ${stats.since.slice(0, 10)}\n`,
  );
  process.stdout.write(`  total: ${stats.total}  errors: ${stats.errors}  last_seen: ${stats.last_seen ?? "—"}\n`);
  const print = (label: string, buckets: typeof stats.by_tool) => {
    if (buckets.length === 0) return;
    process.stdout.write(`\n${label}\n`);
    for (const b of buckets) {
      process.stdout.write(`  ${b.count.toString().padStart(5)}  ${b.label}\n`);
    }
  };
  print("by tool", stats.by_tool);
  print("by project", stats.by_project);
  print("by context", stats.by_context);
  print("by source", stats.by_source);
}

export function resolveContextId(services: ReturnType<typeof buildServices>, idOrPrefix: string): string {
  if (idOrPrefix.length >= 32) return idOrPrefix;
  const matches = services.contexts
    .list({ limit: 10_000 })
    .filter((c) => c.id.startsWith(idOrPrefix));
  if (matches.length === 0) throw new Error(`No context matches id prefix '${idOrPrefix}'`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous id prefix '${idOrPrefix}' (${matches.length} matches). Use a longer prefix.`,
    );
  return matches[0].id;
}
