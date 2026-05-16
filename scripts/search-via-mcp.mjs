#!/usr/bin/env node
// Drives the MCP server to run search_contexts queries and print results.
// Usage: node scripts/search-via-mcp.mjs "query 1" "query 2" ...

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const mcpPath = join(root, "dist", "mcp", "server.js");
const manifestPath = join(root, ".context", "manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath}`);
  process.exit(1);
}
const { project_id } = JSON.parse(readFileSync(manifestPath, "utf8"));

const queries =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ["FTS5", "TypeScript", "manifest invariants", "kubernetes"];

async function main() {
  const mcp = startMcp(project_id);
  try {
    await mcp.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "search", version: "0.1.0" },
    });

    for (const q of queries) {
      const resp = await mcp.request("tools/call", {
        name: "search_contexts",
        arguments: { query: q, scope: "project", limit: 5 },
      });
      assertOk(resp, `search_contexts(${q})`);
      const results = JSON.parse(resp.result.content[0].text);
      process.stdout.write(`\nquery: "${q}"  →  ${results.length} result(s)\n`);
      for (const r of results) {
        process.stdout.write(
          `  • ${r.name}  [${r.category}/${r.priority}]  score=${r.score.toFixed(3)}\n`,
        );
        if (r.snippet) process.stdout.write(`      snippet: ${r.snippet.replace(/\s+/g, " ").trim()}\n`);
      }
    }
  } finally {
    mcp.close();
  }
}

function startMcp(projectId) {
  const child = spawn("node", [mcpPath, "--project-id", projectId], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buffer = "";
  let nextId = 1;

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id).resolve(msg);
          pending.delete(msg.id);
        }
      } catch {
        // ignore non-JSON
      }
    }
  });

  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  child.on("exit", (code) => {
    for (const { reject } of pending.values()) {
      reject(new Error(`MCP exited (${code}). stderr: ${stderr}`));
    }
    pending.clear();
  });

  return {
    request(method, params) {
      const id = nextId++;
      const promise = new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            rej(new Error(`Timeout waiting for ${method} id=${id}`));
          }
        }, 5000);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return promise;
    },
    close() {
      try {
        child.stdin.end();
      } catch {}
      child.kill("SIGTERM");
    },
  };
}

function assertOk(resp, label) {
  if (resp.error) throw new Error(`${label} JSON-RPC error: ${JSON.stringify(resp.error)}`);
  if (resp.result?.isError) {
    throw new Error(`${label} tool error: ${resp.result.content?.[0]?.text ?? "unknown"}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
