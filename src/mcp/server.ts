#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "./zod-to-json-schema.js";
import { tools, findTool, type McpContext } from "./tools.js";
import { buildServices } from "../core/services.js";
import { findProjectRoot } from "../config/paths.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "../core/errors.js";
import { ZodError } from "zod";

function parseArgs(argv: string[]): { projectId?: string; dbPath?: string } {
  const out: { projectId?: string; dbPath?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-id" && argv[i + 1]) out.projectId = argv[++i];
    else if (a === "--db" && argv[i + 1]) out.dbPath = argv[++i];
  }
  return out;
}

function detectProjectIdFromManifest(): string | null {
  const root = findProjectRoot();
  if (!root) return null;
  const path = join(root, ".context", "manifest.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { project_id?: string };
    return raw.project_id ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const services = buildServices(cli.dbPath);

  const projectId =
    cli.projectId ?? process.env.CONTEXT_PROJECT_ID ?? detectProjectIdFromManifest();

  const ctx: McpContext = { services, projectId };

  const server = new Server(
    { name: "context-window", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const getClient = (): { name: string | null; version: string | null } => {
    try {
      const info = (server as unknown as {
        getClientVersion?: () => { name?: string; version?: string } | undefined;
      }).getClientVersion?.();
      return {
        name: info?.name ?? null,
        version: info?.version ?? null,
      };
    } catch {
      return { name: null, version: null };
    }
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = findTool(req.params.name);
    if (!tool) {
      const client = getClient();
      services.usage.record({
        source: "mcp",
        tool_name: req.params.name,
        project_id: ctx.projectId,
        client_name: client.name,
        client_version: client.version,
        outcome: "error",
        error_code: "UNKNOWN_TOOL",
      });
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    const start = Date.now();
    let outcome: "success" | "error" = "success";
    let errorCode: string | null = null;
    let resultText: string | null = null;
    let errorMessage: string | null = null;
    let resultJson: unknown = null;
    try {
      const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
      resultJson = await tool.handler(parsed, ctx);
      resultText = JSON.stringify(resultJson, null, 2);
      return { content: [{ type: "text", text: resultText }] };
    } catch (err) {
      outcome = "error";
      if (err instanceof ZodError) {
        errorCode = "VALIDATION";
        errorMessage = `Invalid arguments: ${err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`;
      } else if (err instanceof DomainError) {
        errorCode = err.code;
        errorMessage = `${err.code}: ${err.message}`;
      } else if (err instanceof Error) {
        errorCode = "INTERNAL";
        errorMessage = err.message;
      } else {
        errorCode = "INTERNAL";
        errorMessage = String(err);
      }
      return { isError: true, content: [{ type: "text", text: errorMessage }] };
    } finally {
      const client = getClient();
      services.usage.record({
        source: "mcp",
        tool_name: req.params.name,
        project_id: ctx.projectId,
        client_name: client.name,
        client_version: client.version,
        context_id: extractContextId(req.params.name, req.params.arguments, resultJson),
        duration_ms: Date.now() - start,
        outcome,
        error_code: errorCode,
      });
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    services.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function extractContextId(
  toolName: string,
  args: unknown,
  result: unknown,
): string | null {
  if (toolName === "create_context") {
    const r = result as { context?: { id?: string } } | undefined;
    return r?.context?.id ?? null;
  }
  if (args && typeof args === "object" && "context_id" in args) {
    const v = (args as { context_id?: unknown }).context_id;
    return typeof v === "string" ? v : null;
  }
  return null;
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
