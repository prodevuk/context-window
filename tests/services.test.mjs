import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildServices } from "../dist/core/services.js";

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "ctx-unit-"));
  const dbPath = join(dir, "test.db");
  const projectRoot = join(dir, "proj");
  mkdirSync(projectRoot, { recursive: true });
  return { dir, dbPath, projectRoot };
}

function newCtx(services, overrides = {}) {
  return services.contexts.create({
    name: overrides.name ?? "Sample",
    description: overrides.description ?? "desc",
    content: overrides.content ?? "body of text for tokenization",
    category: overrides.category ?? "custom",
    tags: overrides.tags ?? [],
    priority: overrides.priority ?? "reference",
  }).context;
}

test("manifest excludes archived contexts and reflects priority overrides", () => {
  const { dir, dbPath, projectRoot } = makeSandbox();
  const services = buildServices(dbPath);
  try {
    const project = services.projects.create({
      name: "demo",
      description: "",
      root_path: projectRoot,
    });

    const a = newCtx(services, { name: "A", priority: "reference" });
    const b = newCtx(services, { name: "B", priority: "important" });
    services.projects.attach(project.id, a.id);
    services.projects.attach(project.id, b.id, { priority_override: "critical" });

    let manifest = services.manifests.build(project.id);
    assert.equal(manifest.contexts.length, 2);
    assert.equal(manifest.contexts[1].priority, "critical", "override applied");

    services.contexts.archive(a.id);
    manifest = JSON.parse(readFileSync(join(projectRoot, ".context", "manifest.json"), "utf8"));
    assert.equal(manifest.contexts.length, 1, "archived context excluded from manifest on disk");
    assert.equal(manifest.contexts[0].context_id, b.id);
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updating a context regenerates manifests of every referencing project", () => {
  const { dir, dbPath } = makeSandbox();
  const r1 = mkdtempSync(join(tmpdir(), "ctx-proj1-"));
  const r2 = mkdtempSync(join(tmpdir(), "ctx-proj2-"));
  const services = buildServices(dbPath);
  try {
    const ctx = newCtx(services, { name: "Shared", content: "v1" });
    const p1 = services.projects.create({ name: "p1", description: "", root_path: r1 });
    const p2 = services.projects.create({ name: "p2", description: "", root_path: r2 });
    services.projects.attach(p1.id, ctx.id);
    services.projects.attach(p2.id, ctx.id);

    const updated = services.contexts.update(ctx.id, {
      name: "Shared (renamed)",
      content: "v2 with quite a bit more text to change token count significantly",
    });
    assert.equal(updated.version, 2);

    const m1 = JSON.parse(readFileSync(join(r1, ".context", "manifest.json"), "utf8"));
    const m2 = JSON.parse(readFileSync(join(r2, ".context", "manifest.json"), "utf8"));
    assert.equal(m1.contexts[0].name, "Shared (renamed)");
    assert.equal(m2.contexts[0].name, "Shared (renamed)");
    assert.equal(m1.contexts[0].token_count, updated.token_count);
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(r1, { recursive: true, force: true });
    rmSync(r2, { recursive: true, force: true });
  }
});

test("attach with explicit position shifts existing entries", () => {
  const { dir, dbPath, projectRoot } = makeSandbox();
  const services = buildServices(dbPath);
  try {
    const project = services.projects.create({
      name: "ord",
      description: "",
      root_path: projectRoot,
    });
    const a = newCtx(services, { name: "A" });
    const b = newCtx(services, { name: "B" });
    const c = newCtx(services, { name: "C" });
    services.projects.attach(project.id, a.id);
    services.projects.attach(project.id, b.id);

    const refreshed = services.projects.attach(project.id, c.id, { position: 0 });
    const ids = refreshed.context_refs
      .slice()
      .sort((x, y) => x.position - y.position)
      .map((r) => r.context_id);
    assert.deepEqual(ids, [c.id, a.id, b.id]);
    assert.deepEqual(
      refreshed.context_refs.slice().sort((x, y) => x.position - y.position).map((r) => r.position),
      [0, 1, 2],
    );
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("budget picks contexts by priority order respecting token limit", () => {
  const { dir, dbPath, projectRoot } = makeSandbox();
  const services = buildServices(dbPath);
  try {
    const project = services.projects.create({
      name: "budget",
      description: "",
      root_path: projectRoot,
    });
    const big = newCtx(services, { name: "Big", content: "x ".repeat(2000), priority: "reference" });
    const small = newCtx(services, { name: "Small", content: "x", priority: "critical" });
    services.projects.attach(project.id, big.id);
    services.projects.attach(project.id, small.id);

    const result = services.manifests.buildBudget(project.id, big.token_count - 1);
    assert.equal(result.included.length, 1, "only small fits");
    assert.equal(result.included[0].id, small.id, "critical loaded first");
    assert.equal(result.excluded.length, 1);
    assert.equal(result.excluded[0].context.id, big.id);
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FTS search respects scope and active status", () => {
  const { dir, dbPath, projectRoot } = makeSandbox();
  const services = buildServices(dbPath);
  try {
    const project = services.projects.create({
      name: "search",
      description: "",
      root_path: projectRoot,
    });
    const attached = newCtx(services, {
      name: "Postgres tuning",
      content: "vacuum and analyse keep tables healthy",
      tags: ["postgres"],
    });
    const orphan = newCtx(services, {
      name: "Redis cache",
      content: "redis is good for caching",
    });
    services.projects.attach(project.id, attached.id);

    const project_scope = services.contexts.search({ query: "postgres", projectId: project.id });
    assert.equal(project_scope.length, 1);
    assert.equal(project_scope[0].id, attached.id);

    const all_scope = services.contexts.search({ query: "cache" });
    assert.ok(all_scope.some((r) => r.id === orphan.id));

    services.contexts.archive(attached.id);
    const after = services.contexts.search({ query: "postgres", projectId: project.id });
    assert.equal(after.length, 0, "archived contexts excluded from search");
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("optimistic locking rejects stale updates", () => {
  const { dir, dbPath } = makeSandbox();
  const services = buildServices(dbPath);
  try {
    const c = newCtx(services, { content: "first" });
    services.contexts.update(c.id, { content: "second" });
    assert.throws(
      () => services.contexts.update(c.id, { content: "third", expected_version: 1 }),
      /version mismatch/,
    );
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("delete cleans up FTS and detaches from all projects", () => {
  const { dir, dbPath, projectRoot } = makeSandbox();
  const services = buildServices(dbPath);
  try {
    const project = services.projects.create({
      name: "delcheck",
      description: "",
      root_path: projectRoot,
    });
    const c = newCtx(services, { name: "Doomed" });
    services.projects.attach(project.id, c.id);
    services.contexts.delete(c.id);
    const manifest = services.manifests.build(project.id);
    assert.equal(manifest.contexts.length, 0);
    const search = services.contexts.search({ query: "Doomed" });
    assert.equal(search.length, 0);
  } finally {
    services.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
