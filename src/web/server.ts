import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { buildServices, type Services } from "../core/services.js";
import { Priority, Status, Visibility } from "../core/types.js";
import { DomainError } from "../core/errors.js";
import { STYLES } from "./styles.js";
import {
  layout,
  contextListView,
  contextFormView,
  contextDetailView,
  projectListView,
  projectFormView,
  projectDetailView,
  searchResultsView,
} from "./views.js";
import { dashboardBody, miniUsageBlock } from "./charts.js";

interface WebOptions {
  port: number;
  dbPath?: string;
  host?: string;
}

interface SessionFlash {
  kind: "success" | "error" | "warn";
  message: string;
}

export function createApp(services: Services): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "5mb" }));

  app.use((req, _res, next) => {
    const flash = readFlash(req);
    (req as Request & { flash?: SessionFlash | null }).flash = flash;
    next();
  });

  app.use((req, res, next) => {
    if (req.path === "/styles.css" || req.path === "/health") return next();
    const start = Date.now();
    res.on("finish", () => {
      const route = matchWebRoute(req.method, req.path);
      if (!route) return;
      const client = parseUserAgent(req.get("user-agent"));
      const inferred = inferFromRedirect(res.getHeader("location"));
      services.usage.record({
        source: "web",
        tool_name: route.tool,
        project_id: route.project_id ?? inferred.project_id ?? null,
        context_id: route.context_id ?? inferred.context_id ?? null,
        duration_ms: Date.now() - start,
        outcome: res.statusCode >= 400 ? "error" : "success",
        error_code: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : null,
        client_name: client.name,
        client_version: client.version,
      });
    });
    next();
  });

  app.get("/styles.css", (_req, res) => {
    res.type("text/css").send(STYLES);
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/dashboard", (req, res) => {
    const sinceDays = clampInt(req.query.since_days, 1, 365, 30);
    const stats = services.usage.overview({ sinceDays });
    const projectLabels = new Map(
      services.projects.list().map((p) => [p.id, p.name]),
    );
    const contextLabels = new Map(
      services.contexts.list({ limit: 1000 }).map((c) => [c.id, c.name]),
    );
    res.send(
      layout(
        { title: "Dashboard", flash: readFlashAndClear(res, req) },
        dashboardBody({ stats, sinceDays, projectLabels, contextLabels }),
      ),
    );
  });

  // -------------------- Contexts --------------------

  app.get("/", (req, res) => {
    const contexts = services.contexts.list({ limit: 500 });
    const body = contextListView(contexts);
    res.send(
      layout(
        { title: "Contexts", active: "contexts", flash: readFlashAndClear(res, req) },
        body,
      ),
    );
  });

  app.get("/contexts/new", (req, res) => {
    const categories = services.contexts.listCategories();
    const attachTo = (req.query.attach_to as string | undefined) ?? null;
    const errorParam = req.query.error as string | undefined;
    const body =
      contextFormView({ mode: "create", categories, error: errorParam }) +
      (attachTo
        ? `<input type="hidden" form="attach-after" name="attach_to" value="${escapeAttr(attachTo)}" />`
        : "");
    res.send(
      layout(
        { title: "New context", active: "contexts", flash: readFlashAndClear(res, req) },
        body,
      ),
    );
  });

  app.post("/contexts", (req, res, next) => {
    try {
      const tags = parseTags(req.body.tags);
      const { context } = services.contexts.create({
        name: required(req.body.name, "name"),
        description: required(req.body.description, "description"),
        content: required(req.body.content, "content"),
        category: req.body.category || "custom",
        tags,
        priority: Priority.parse(req.body.priority || "reference"),
        visibility: Visibility.parse(req.body.visibility || "private"),
        created_by: "user:web",
      });
      const attachTo = typeof req.body.attach_to === "string" ? req.body.attach_to : null;
      if (attachTo) {
        services.projects.attach(attachTo, context.id);
        setFlash(res, { kind: "success", message: `Created and attached to project.` });
        res.redirect(`/projects/${attachTo}`);
        return;
      }
      setFlash(res, { kind: "success", message: `Created "${context.name}".` });
      res.redirect(`/contexts/${context.id}`);
    } catch (err) {
      next(err);
    }
  });

  app.get("/contexts/:id", (req, res, next) => {
    try {
      const c = services.contexts.get(req.params.id);
      const projectIds = services.repo.listProjectsReferencing(c.id);
      const projects = projectIds
        .map((pid) => services.repo.getProject(pid))
        .filter((p): p is NonNullable<typeof p> => p !== null);
      const stats = services.usage.forContext(c.id, { sinceDays: 30 });
      const body =
        contextDetailView(c, projects) +
        `<h3 style="margin-top:24px">Usage</h3>` +
        miniUsageBlock(stats, 30);
      res.send(
        layout(
          { title: c.name, active: "contexts", flash: readFlashAndClear(res, req) },
          body,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  app.get("/contexts/:id/edit", (req, res, next) => {
    try {
      const c = services.contexts.get(req.params.id);
      const categories = services.contexts.listCategories();
      res.send(
        layout(
          { title: `Edit · ${c.name}`, active: "contexts", flash: readFlashAndClear(res, req) },
          contextFormView({ mode: "edit", context: c, categories }),
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/contexts/:id", (req, res, next) => {
    try {
      const tags = parseTags(req.body.tags);
      const expectedVersion = req.body.expected_version
        ? Number(req.body.expected_version)
        : undefined;
      services.contexts.update(req.params.id, {
        name: req.body.name,
        description: req.body.description,
        content: req.body.content,
        category: req.body.category,
        tags,
        priority: Priority.parse(req.body.priority),
        visibility: Visibility.parse(req.body.visibility),
        status: req.body.status ? Status.parse(req.body.status) : undefined,
        expected_version: expectedVersion,
      });
      setFlash(res, { kind: "success", message: "Context updated." });
      res.redirect(`/contexts/${req.params.id}`);
    } catch (err) {
      next(err);
    }
  });

  app.post("/contexts/:id/archive", (req, res, next) => {
    try {
      services.contexts.archive(req.params.id);
      setFlash(res, { kind: "success", message: "Context archived." });
      res.redirect(`/contexts/${req.params.id}`);
    } catch (err) {
      next(err);
    }
  });

  app.post("/contexts/:id/delete", (req, res, next) => {
    try {
      services.contexts.delete(req.params.id);
      setFlash(res, { kind: "success", message: "Context deleted." });
      res.redirect(`/`);
    } catch (err) {
      next(err);
    }
  });

  // -------------------- Search --------------------

  app.get("/search", (req, res, next) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q) {
        res.redirect("/");
        return;
      }
      const results = services.contexts.search({ query: q, limit: 50 });
      res.send(
        layout(
          { title: `Search · ${q}`, active: "search", searchQuery: q, flash: readFlashAndClear(res, req) },
          searchResultsView(q, results),
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  // -------------------- Projects --------------------

  app.get("/projects", (req, res) => {
    const projects = services.projects.list();
    res.send(
      layout(
        { title: "Projects", active: "projects", flash: readFlashAndClear(res, req) },
        projectListView(projects),
      ),
    );
  });

  app.get("/projects/new", (req, res) => {
    res.send(
      layout(
        { title: "New project", active: "projects", flash: readFlashAndClear(res, req) },
        projectFormView(req.query.error as string | undefined),
      ),
    );
  });

  app.post("/projects", (req, res, next) => {
    try {
      const rootPath = typeof req.body.root_path === "string" && req.body.root_path.trim()
        ? req.body.root_path.trim()
        : null;
      const project = services.projects.create({
        name: required(req.body.name, "name"),
        description: req.body.description ?? "",
        root_path: rootPath,
      });
      setFlash(res, { kind: "success", message: `Created project "${project.name}".` });
      res.redirect(`/projects/${project.id}`);
    } catch (err) {
      next(err);
    }
  });

  app.get("/projects/:id", (req, res, next) => {
    try {
      const project = services.projects.get(req.params.id);
      const manifest = services.manifests.build(project.id);
      const attached = new Set(project.context_refs.map((r) => r.context_id));
      const attachable = services.contexts
        .list({ status: "active", limit: 1000 })
        .filter((c) => !attached.has(c.id));
      const stats = services.usage.forProject(project.id, { sinceDays: 30 });
      const body =
        projectDetailView(project, manifest, attachable) +
        `<h3 style="margin-top:24px">Usage</h3>` +
        miniUsageBlock(stats, 30);
      res.send(
        layout(
          { title: project.name, active: "projects", flash: readFlashAndClear(res, req) },
          body,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/projects/:id/attach", (req, res, next) => {
    try {
      const contextId = required(req.body.context_id, "context_id");
      const override = req.body.priority_override;
      const priorityOverride =
        typeof override === "string" && override.length > 0
          ? Priority.parse(override)
          : undefined;
      services.projects.attach(req.params.id, contextId, {
        priority_override: priorityOverride,
      });
      setFlash(res, { kind: "success", message: "Context attached." });
      res.redirect(`/projects/${req.params.id}`);
    } catch (err) {
      next(err);
    }
  });

  app.post("/projects/:id/detach", (req, res, next) => {
    try {
      const contextId = required(req.body.context_id, "context_id");
      services.projects.detach(req.params.id, contextId);
      setFlash(res, { kind: "success", message: "Context detached." });
      res.redirect(`/projects/${req.params.id}`);
    } catch (err) {
      next(err);
    }
  });

  app.post("/projects/:id/move", (req, res, next) => {
    try {
      const contextId = required(req.body.context_id, "context_id");
      const direction = req.body.direction === "up" ? "up" : "down";
      const project = services.projects.get(req.params.id);
      const ordered = [...project.context_refs]
        .sort((a, b) => a.position - b.position)
        .map((r) => r.context_id);
      const idx = ordered.indexOf(contextId);
      if (idx < 0) throw new DomainError(`Context ${contextId} not attached`, "NOT_ATTACHED");
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= ordered.length) {
        res.redirect(`/projects/${req.params.id}`);
        return;
      }
      [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
      services.projects.reorder(req.params.id, ordered);
      res.redirect(`/projects/${req.params.id}`);
    } catch (err) {
      next(err);
    }
  });

  app.use(((err, req, res, _next) => {
    const status =
      err instanceof DomainError && err.code === "NOT_FOUND"
        ? 404
        : err instanceof DomainError && err.code === "VALIDATION"
          ? 400
          : err instanceof DomainError && err.code === "CONFLICT"
            ? 409
            : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (process.env.CONTEXT_WEB_DEBUG) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    if (status >= 500) {
      res.status(status).send(
        layout(
          { title: `Error`, flash: { kind: "error", message } },
          `<div class="card"><p>Something went wrong.</p><pre>${escapeAttr(message)}</pre></div>`,
        ),
      );
    } else {
      setFlash(res, { kind: "error", message });
      const referer = req.get("referer");
      res.status(status).redirect(referer ?? "/");
    }
  }) as express.ErrorRequestHandler);

  return app;
}

export async function startWeb(options: WebOptions): Promise<{ services: Services; close: () => Promise<void> }> {
  const services = buildServices(options.dbPath);
  const app = createApp(services);
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolveP) => {
    const server = app.listen(options.port, host, () => resolveP());
    (app as Express & { server?: ReturnType<Express["listen"]> }).server = server;
  });
  // eslint-disable-next-line no-console
  console.error(`context-window web UI listening at http://${host}:${options.port}`);
  return {
    services,
    close: () =>
      new Promise<void>((res) => {
        const server = (app as Express & { server?: ReturnType<Express["listen"]> }).server;
        if (!server) {
          services.close();
          res();
          return;
        }
        server.close(() => {
          services.close();
          res();
        });
      }),
  };
}

// -------------------- helpers --------------------

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError(`${name} is required`, "VALIDATION");
  }
  return value;
}

function parseTags(input: unknown): string[] {
  if (typeof input !== "string") return [];
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function escapeAttr(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function setFlash(res: Response, flash: SessionFlash): void {
  const payload = Buffer.from(JSON.stringify(flash), "utf8").toString("base64url");
  res.cookie("ctx_flash", payload, { httpOnly: true, sameSite: "lax", path: "/" });
}

function readFlash(req: Request): SessionFlash | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const match = raw.split(";").map((s) => s.trim()).find((s) => s.startsWith("ctx_flash="));
  if (!match) return null;
  const value = match.slice("ctx_flash=".length);
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.kind === "string" && typeof parsed.message === "string") {
      return parsed as SessionFlash;
    }
    return null;
  } catch {
    return null;
  }
}

function readFlashAndClear(res: Response, req: Request): SessionFlash | null {
  const flash = readFlash(req);
  if (flash) res.clearCookie("ctx_flash", { path: "/" });
  return flash;
}

interface MatchedRoute {
  tool: string;
  project_id?: string;
  context_id?: string;
}

function inferFromRedirect(location: unknown): { project_id?: string; context_id?: string } {
  if (typeof location !== "string") return {};
  const ctx = location.match(/^\/contexts\/([0-9a-f-]{36})(?:[/?#]|$)/i);
  if (ctx) return { context_id: ctx[1] };
  const proj = location.match(/^\/projects\/([0-9a-f-]{36})(?:[/?#]|$)/i);
  if (proj) return { project_id: proj[1] };
  return {};
}

function parseUserAgent(ua: string | undefined): { name: string; version: string | null } {
  if (!ua) return { name: "browser", version: null };
  const known: Array<[RegExp, string]> = [
    [/Edg\/([\d.]+)/, "edge"],
    [/Chrome\/([\d.]+)/, "chrome"],
    [/Firefox\/([\d.]+)/, "firefox"],
    [/Version\/([\d.]+).*Safari/, "safari"],
    [/curl\/([\d.]+)/, "curl"],
    [/HTTPie\/([\d.]+)/, "httpie"],
    [/node-fetch/, "node-fetch"],
  ];
  for (const [re, name] of known) {
    const m = ua.match(re);
    if (m) return { name, version: m[1] ?? null };
  }
  return { name: "browser", version: null };
}

function matchWebRoute(method: string, path: string): MatchedRoute | null {
  if (method === "GET") {
    if (path === "/") return { tool: "web.list_contexts" };
    if (path === "/contexts/new") return { tool: "web.new_context_form" };
    if (path === "/projects") return { tool: "web.list_projects" };
    if (path === "/projects/new") return { tool: "web.new_project_form" };
    if (path === "/search") return { tool: "web.search" };
    if (path === "/dashboard") return { tool: "web.dashboard" };
    const ctxEdit = path.match(/^\/contexts\/([^/]+)\/edit$/);
    if (ctxEdit) return { tool: "web.edit_context_form", context_id: ctxEdit[1] };
    const ctxView = path.match(/^\/contexts\/([^/]+)$/);
    if (ctxView) return { tool: "web.view_context", context_id: ctxView[1] };
    const projView = path.match(/^\/projects\/([^/]+)$/);
    if (projView) return { tool: "web.view_project", project_id: projView[1] };
    return null;
  }
  if (method === "POST") {
    if (path === "/contexts") return { tool: "web.create_context" };
    if (path === "/projects") return { tool: "web.create_project" };
    const archive = path.match(/^\/contexts\/([^/]+)\/archive$/);
    if (archive) return { tool: "web.archive_context", context_id: archive[1] };
    const del = path.match(/^\/contexts\/([^/]+)\/delete$/);
    if (del) return { tool: "web.delete_context", context_id: del[1] };
    const update = path.match(/^\/contexts\/([^/]+)$/);
    if (update) return { tool: "web.update_context", context_id: update[1] };
    const attach = path.match(/^\/projects\/([^/]+)\/attach$/);
    if (attach) return { tool: "web.attach_context", project_id: attach[1] };
    const detach = path.match(/^\/projects\/([^/]+)\/detach$/);
    if (detach) return { tool: "web.detach_context", project_id: detach[1] };
    const move = path.match(/^\/projects\/([^/]+)\/move$/);
    if (move) return { tool: "web.move_context", project_id: move[1] };
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const portArg = process.argv.indexOf("--port");
  const dbArg = process.argv.indexOf("--db");
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 5173;
  const dbPath = dbArg >= 0 ? process.argv[dbArg + 1] : undefined;
  startWeb({ port, dbPath }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
