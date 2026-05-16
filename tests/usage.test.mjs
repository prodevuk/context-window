import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildServices } from "../dist/core/services.js";
import { createApp } from "../dist/web/server.js";

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "ctx-usage-"));
  const dbPath = join(dir, "u.db");
  const proj = join(dir, "p");
  mkdirSync(proj, { recursive: true });
  return { dir, dbPath, proj };
}

test("UsageService records and aggregates across project, tool, context, client", () => {
  const { dir, dbPath, proj } = sandbox();
  const services = buildServices(dbPath);
  try {
    const project = services.projects.create({ name: "x", description: "", root_path: proj });
    const c1 = services.contexts.create({ name: "c1", description: "", content: "alpha" }).context;
    const c2 = services.contexts.create({ name: "c2", description: "", content: "beta" }).context;
    services.projects.attach(project.id, c1.id);

    // Simulate events from three clients
    services.usage.record({ source: "mcp", tool_name: "get_context", project_id: project.id, context_id: c1.id, outcome: "success", client_name: "claude", client_version: "opus-4-7" });
    services.usage.record({ source: "mcp", tool_name: "get_context", project_id: project.id, context_id: c1.id, outcome: "success", client_name: "claude", client_version: "opus-4-7" });
    services.usage.record({ source: "mcp", tool_name: "get_project_summary", project_id: project.id, outcome: "success", client_name: "claude", client_version: "opus-4-7" });
    services.usage.record({ source: "mcp", tool_name: "search_contexts", project_id: project.id, outcome: "error", error_code: "VALIDATION", client_name: "gpt", client_version: "5" });
    services.usage.record({ source: "web", tool_name: "web.view_context", context_id: c2.id, outcome: "success", client_name: "chrome", client_version: "121.0" });

    const proj_stats = services.usage.forProject(project.id);
    assert.equal(proj_stats.total, 4);
    assert.equal(proj_stats.errors, 1);
    assert.ok(proj_stats.by_tool.find((b) => b.key === "get_context")?.count === 2);
    assert.ok(proj_stats.by_client.find((b) => b.key === "claude")?.count === 3);
    assert.ok(proj_stats.by_context.find((b) => b.key === c1.id)?.count === 2);
    assert.ok(proj_stats.by_source.find((b) => b.key === "mcp")?.count === 4);

    const ctx_stats = services.usage.forContext(c1.id);
    assert.equal(ctx_stats.total, 2);

    const tool_stats = services.usage.forTool("get_context");
    assert.equal(tool_stats.total, 2);

    const overview = services.usage.overview();
    assert.equal(overview.total, 5);
    assert.ok(overview.by_client.find((b) => b.key === "chrome")?.count === 1);

    // daily bucket should have at least one entry today
    assert.ok(overview.daily.length >= 1);
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Web routes write usage events with UA-derived client info", async () => {
  const { dir, dbPath } = sandbox();
  const services = buildServices(dbPath);
  const app = createApp(services);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((res) => server.once("listening", res));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    // Create one context via the API path so we have something to view
    const resp = await fetch(base + "/contexts", {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
      body: new URLSearchParams({
        name: "UA test",
        description: "x",
        content: "y",
        category: "custom",
        priority: "reference",
        visibility: "private",
      }).toString(),
    });
    const ctxId = resp.headers.get("location").split("/").pop();

    // View the page with Firefox UA
    await fetch(base + `/contexts/${ctxId}`, {
      headers: { "user-agent": "Mozilla/5.0 Firefox/120.0" },
    });

    // Allow finish event to fire
    await new Promise((r) => setTimeout(r, 50));

    const stats = services.usage.forContext(ctxId);
    assert.ok(stats.total >= 2, `expected ≥2 events, got ${stats.total}`);
    assert.ok(stats.by_client.some((b) => b.key === "chrome"), "chrome event recorded");
    assert.ok(stats.by_client.some((b) => b.key === "firefox"), "firefox event recorded");

    const dash = await fetch(base + "/dashboard");
    const html = await dash.text();
    assert.equal(dash.status, 200);
    assert.ok(html.includes("Dashboard"), "dashboard heading present");
    assert.ok(html.includes("Activity over time"), "sparkline section present");
    assert.ok(html.includes("By client"), "client breakdown present");
  } finally {
    await new Promise((res) => server.close(res));
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI tracked() helper records cli source events", async () => {
  const { dir, dbPath } = sandbox();
  const services = buildServices(dbPath);
  try {
    const { tracked } = await import("../dist/cli/track.js");
    const ctx = await tracked(
      services,
      "cli.context.new",
      () => services.contexts.create({ name: "via-cli", description: "", content: "x" }),
      (r) => ({ context_id: r.context.id }),
    );
    assert.ok(ctx.context.id);
    const overview = services.usage.overview();
    const cliEvents = overview.by_source.find((b) => b.key === "cli");
    assert.ok(cliEvents && cliEvents.count >= 1);
    const byClient = overview.by_client.find((b) => b.key === "cli");
    assert.ok(byClient && byClient.count >= 1);
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
