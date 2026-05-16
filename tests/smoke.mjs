#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "dist", "cli", "index.js");
const mcp = join(root, "dist", "mcp", "server.js");

const sandbox = mkdtempSync(join(tmpdir(), "ctx-smoke-"));
const dbPath = join(sandbox, "smoke.db");
const projectDir = join(sandbox, "myproject");
mkdirSync(projectDir, { recursive: true });

const env = { ...process.env, CONTEXT_DB_PATH: dbPath };

function run(args, cwd = projectDir) {
  const out = execFileSync("node", [cli, ...args], { env, cwd, encoding: "utf8" });
  return out;
}

function runJson(args, cwd = projectDir) {
  return JSON.parse(run(args, cwd));
}

let failed = 0;
function check(label, cond, detail = "") {
  if (cond) {
    process.stdout.write(`ok  ${label}\n`);
  } else {
    failed++;
    process.stdout.write(`FAIL ${label} ${detail}\n`);
  }
}

try {
  // 1. context init
  const init = runJson(["context", "init", "--db", dbPath]);
  check("context init", init.initialised === true);

  // 2. project init
  const projInit = runJson(["project", "init", "-n", "smoke", "-d", "smoke project"]);
  check("project init creates project", typeof projInit.project?.id === "string");
  check("manifest written", existsSync(join(projectDir, ".context", "manifest.json")));

  // 3. create contexts
  const c1 = runJson([
    "context",
    "new",
    "-n",
    "Rust Conventions",
    "-d",
    "Rust style and idioms",
    "--content",
    "Use Result over panic. Avoid unwrap in libraries.",
    "--category",
    "conventions",
    "--tags",
    "rust,backend,conventions",
    "--priority",
    "important",
  ]);
  check("context new returns id", typeof c1.context?.id === "string");

  const c2 = runJson([
    "context",
    "new",
    "-n",
    "Personal Background",
    "-d",
    "About Promise",
    "--content",
    "Promise is based in the UK and runs Prodevel.",
    "--category",
    "personal",
    "--priority",
    "critical",
  ]);
  check("second context", typeof c2.context?.id === "string");

  // 4. list and search
  const list = runJson(["context", "list", "--json"]);
  check("context list has 2 items", Array.isArray(list) && list.length === 2);

  const searchResults = runJson(["context", "search", "rust", "--json"]);
  check(
    "search finds rust context",
    Array.isArray(searchResults) &&
      searchResults.some((r) => r.id === c1.context.id),
  );

  // 5. attach contexts
  const attached1 = runJson(["project", "attach", c1.context.id]);
  check("attach #1", attached1.project.context_refs.length === 1);
  const attached2 = runJson([
    "project",
    "attach",
    c2.context.id,
    "--priority",
    "critical",
  ]);
  check("attach #2 with override", attached2.project.context_refs.length === 2);

  // 6. manifest reflects attachments
  const manifest = JSON.parse(
    readFileSync(join(projectDir, ".context", "manifest.json"), "utf8"),
  );
  check("manifest has 2 entries", manifest.contexts.length === 2);
  check("manifest has token total > 0", manifest.total_token_count > 0);

  // 7. budget
  const budget = runJson(["project", "budget", "--budget", "10"]);
  check("budget returns shape", typeof budget.budget === "number");

  // 8. detach
  const after = runJson(["project", "detach", c1.context.id]);
  check("detach reduces refs", after.project.context_refs.length === 1);

  // 9a. update propagates to manifest on disk
  const c3 = runJson([
    "context",
    "new",
    "-n",
    "Project Goals",
    "-d",
    "Goals",
    "--content",
    "Initial goals",
    "--category",
    "project",
  ]);
  runJson(["project", "attach", c3.context.id]);
  // simulate update via CLI: re-import to overwrite, or use a dedicated update endpoint via show + edit not feasible here.
  // Use API directly through a tiny inline node process.
  const updateScript = `
    import { buildServices } from '${join(root, "dist", "core", "services.js")}';
    const services = buildServices(process.env.CONTEXT_DB_PATH);
    services.contexts.update('${c3.context.id}', { content: 'Updated goals with more substantial text to change token count.' });
    services.close();
  `;
  execFileSync("node", ["--input-type=module", "-e", updateScript], { env });
  const m1 = JSON.parse(
    readFileSync(join(projectDir, ".context", "manifest.json"), "utf8"),
  );
  const updatedEntry = m1.contexts.find((c) => c.context_id === c3.context.id);
  check("update propagates to manifest on disk", updatedEntry && updatedEntry.token_count > 0);

  // 9b. attach with explicit position shifts others
  const cP = runJson([
    "context",
    "new",
    "-n",
    "Pinned",
    "-d",
    "pinned",
    "--content",
    "always first",
  ]);
  const pinned = runJson(["project", "attach", cP.context.id, "--position", "0"]);
  const positions = pinned.project.context_refs
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((r) => r.position);
  check("positions are 0..n-1 after explicit insert", JSON.stringify(positions) === JSON.stringify([0, 1, 2]));
  check(
    "explicit-position context is first",
    pinned.project.context_refs.find((r) => r.context_id === cP.context.id).position === 0,
  );

  // 9c. archive removes from manifest
  const archived = runJson(["context", "archive", c2.context.id]);
  check("archive sets status", archived.status === "archived");
  const m2 = JSON.parse(
    readFileSync(join(projectDir, ".context", "manifest.json"), "utf8"),
  );
  check(
    "archived context excluded from manifest",
    !m2.contexts.some((c) => c.context_id === c2.context.id),
  );

  // 10. MCP server: list tools via stdio JSON-RPC
  const mcpResult = await runMcp(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.1" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ],
    { ...env, CONTEXT_PROJECT_ID: projInit.project.id },
  );
  const tools = mcpResult.find((m) => m.id === 2)?.result?.tools ?? [];
  check("MCP tools/list returns tools", tools.length >= 14, `(got ${tools.length})`);
  const names = new Set(tools.map((t) => t.name));
  for (const required of [
    "get_project_summary",
    "get_context",
    "search_contexts",
    "create_context",
    "attach_context",
    "regenerate_manifest",
    "get_context_budget",
  ]) {
    check(`MCP exposes ${required}`, names.has(required));
  }

  // 11. MCP call get_project_summary
  const summary = await runMcp(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.1" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_project_summary", arguments: {} } },
    ],
    { ...env, CONTEXT_PROJECT_ID: projInit.project.id },
  );
  const summaryResp = summary.find((m) => m.id === 2);
  check("get_project_summary succeeds", !summaryResp?.result?.isError);

  if (failed === 0) {
    process.stdout.write("\nALL SMOKE TESTS PASSED\n");
  } else {
    process.stdout.write(`\n${failed} TEST(S) FAILED\n`);
    process.exit(1);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

function runMcp(messages, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("node", [mcp], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    for (const msg of messages) {
      child.stdin.write(JSON.stringify(msg) + "\n");
    }
    setTimeout(() => {
      child.kill("SIGTERM");
    }, 2500);
    child.on("close", () => {
      const lines = stdout.split("\n").filter(Boolean);
      const parsed = [];
      for (const line of lines) {
        try {
          parsed.push(JSON.parse(line));
        } catch {
          // ignore non-JSON lines
        }
      }
      if (parsed.length === 0 && stderr) {
        reject(new Error(`MCP produced no output. Stderr: ${stderr}`));
        return;
      }
      resolvePromise(parsed);
    });
  });
}
