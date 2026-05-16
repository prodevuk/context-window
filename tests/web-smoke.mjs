#!/usr/bin/env node
// Smoke test for the Express web UI.
// Spawns the server in-process, drives it via fetch(), checks each route.

import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const { createApp } = await import(join(root, "dist", "web", "server.js"));
const { buildServices } = await import(join(root, "dist", "core", "services.js"));

const sandbox = mkdtempSync(join(tmpdir(), "ctx-web-"));
const dbPath = join(sandbox, "web.db");
process.env.CONTEXT_DB_PATH = dbPath;
const projectRoot = join(sandbox, "proj");
mkdirSync(projectRoot, { recursive: true });

const services = buildServices(dbPath);
const app = createApp(services);
const server = app.listen(0, "127.0.0.1");
await new Promise((res) => server.once("listening", res));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

let failed = 0;
function check(label, cond, detail = "") {
  if (cond) process.stdout.write(`ok  ${label}\n`);
  else {
    failed++;
    process.stdout.write(`FAIL ${label} ${detail}\n`);
  }
}

async function get(path, init = {}) {
  return fetch(base + path, { redirect: "manual", ...init });
}
async function form(path, body, init = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.append(k, v);
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    redirect: "manual",
    ...init,
  });
}

try {
  // 1. Home page (empty)
  let resp = await get("/");
  let html = await resp.text();
  check("GET / returns 200", resp.status === 200);
  check("GET / mentions Contexts heading", html.includes("Contexts"));
  check("GET / shows empty state", html.includes("No contexts yet"));

  // 2. Stylesheet
  resp = await get("/styles.css");
  check("GET /styles.css returns CSS", resp.status === 200 && (resp.headers.get("content-type") ?? "").includes("text/css"));

  // 3. Health
  resp = await get("/health");
  check("GET /health returns ok", resp.status === 200);

  // 4. New context page
  resp = await get("/contexts/new");
  html = await resp.text();
  check("GET /contexts/new shows form", resp.status === 200 && html.includes("Create context"));

  // 5. Create context
  resp = await form("/contexts", {
    name: "Web Test Context",
    description: "Created via web smoke test",
    content: "# Hello\nSome content with searchable words like postgres tuning.",
    category: "technical",
    priority: "important",
    visibility: "private",
    tags: "test, web, smoke",
  });
  check("POST /contexts redirects on success", resp.status === 302);
  const loc = resp.headers.get("location");
  check("redirect points to /contexts/:id", loc && loc.startsWith("/contexts/"));
  const ctxId = loc.split("/").pop();

  // 6. Detail page reflects new context
  resp = await get(`/contexts/${ctxId}`);
  html = await resp.text();
  check("GET /contexts/:id shows name", html.includes("Web Test Context"));
  check("GET /contexts/:id shows content", html.includes("postgres tuning"));
  check("GET /contexts/:id shows tags", html.includes("smoke"));

  // 7. List shows it
  resp = await get("/");
  html = await resp.text();
  check("GET / lists created context", html.includes("Web Test Context"));

  // 8. Search finds it
  resp = await get("/search?q=postgres");
  html = await resp.text();
  check("GET /search finds matching context", html.includes("Web Test Context"));

  // 9. Edit form
  resp = await get(`/contexts/${ctxId}/edit`);
  html = await resp.text();
  check("GET /contexts/:id/edit pre-fills name", html.includes('value="Web Test Context"'));

  // 10. Update
  resp = await form(`/contexts/${ctxId}`, {
    name: "Web Test Context (renamed)",
    description: "Created via web smoke test",
    content: "# Hello\nNew content body.",
    category: "technical",
    priority: "critical",
    visibility: "private",
    status: "active",
    tags: "test, web",
    expected_version: "1",
  });
  check("POST /contexts/:id updates", resp.status === 302);
  resp = await get(`/contexts/${ctxId}`);
  html = await resp.text();
  check("update reflected on detail page", html.includes("Web Test Context (renamed)"));

  // 11. Projects empty
  resp = await get("/projects");
  html = await resp.text();
  check("GET /projects loads", resp.status === 200);

  // 12. Create project
  resp = await form("/projects", {
    name: "web-test-proj",
    description: "smoke project",
    root_path: projectRoot,
  });
  check("POST /projects redirects on success", resp.status === 302);
  const projLoc = resp.headers.get("location");
  const projId = projLoc.split("/").pop();

  // 13. Project detail
  resp = await get(`/projects/${projId}`);
  html = await resp.text();
  check("GET /projects/:id loads project page", resp.status === 200 && html.includes("web-test-proj"));
  check("project page lists attachable contexts", html.includes("Web Test Context (renamed)"));

  // 14. Attach
  resp = await form(`/projects/${projId}/attach`, {
    context_id: ctxId,
    priority_override: "critical",
  });
  check("POST /projects/:id/attach redirects", resp.status === 302);

  resp = await get(`/projects/${projId}`);
  html = await resp.text();
  check("project page now lists attached context", html.includes("Web Test Context (renamed)"));
  check("project page shows priority override", html.includes('priority-critical'));

  // 15. Create another context, attach, then move up
  resp = await form("/contexts", {
    name: "Second context",
    description: "second",
    content: "content body",
    category: "custom",
    priority: "reference",
    visibility: "private",
  });
  const secondId = resp.headers.get("location").split("/").pop();
  await form(`/projects/${projId}/attach`, { context_id: secondId, priority_override: "" });

  resp = await form(`/projects/${projId}/move`, {
    context_id: secondId,
    direction: "up",
  });
  check("POST /projects/:id/move redirects", resp.status === 302);
  resp = await get(`/projects/${projId}`);
  html = await resp.text();
  const firstRowName = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]?.match(/<tr>[\s\S]*?<td>0<\/td>[\s\S]*?<a [^>]*>([^<]+)<\/a>/)?.[1];
  check("move up reorders contexts", firstRowName === "Second context", `(got "${firstRowName}")`);

  // 16. Detach
  resp = await form(`/projects/${projId}/detach`, { context_id: secondId });
  check("POST /projects/:id/detach redirects", resp.status === 302);

  // 17. Archive
  resp = await form(`/contexts/${ctxId}/archive`, {});
  check("POST /contexts/:id/archive redirects", resp.status === 302);
  resp = await get(`/contexts/${ctxId}`);
  html = await resp.text();
  check("archived status shown", html.includes("archived"));

  // 18. Validation error renders nicely
  resp = await form("/contexts", { name: "", description: "no name", content: "x" });
  check("validation error redirects (no 500)", resp.status === 302 || resp.status === 400);

  // 19. 404 on bogus id
  resp = await get("/contexts/00000000-0000-0000-0000-000000000000");
  check("missing context redirects (flash)", [302, 404].includes(resp.status));

  if (failed === 0) process.stdout.write("\nALL WEB SMOKE TESTS PASSED\n");
  else {
    process.stdout.write(`\n${failed} WEB TEST(S) FAILED\n`);
    process.exit(1);
  }
} finally {
  await new Promise((res) => server.close(res));
  services.close();
  rmSync(sandbox, { recursive: true, force: true });
}
