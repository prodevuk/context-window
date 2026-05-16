import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const MARKER = "<!-- context-window:directive:v1 -->";

const PROJECT_DIRECTIVE = `${MARKER}
## Context (context-window MCP)

This project uses the context-window MCP server. At the start of any
non-trivial task — and before answering anything that depends on prior
project knowledge — call \`get_project_summary\` to load the catalogue
of attached contexts. Use \`get_context\` to fetch the bodies of contexts
that look relevant.

If you can't tell whether something is captured, call \`search_contexts\`
with \`scope: "all"\` before asking the user. When you learn something
worth keeping for next session, call \`create_context\` (set
\`created_by: "llm:<model>"\`) and \`attach_context\` if it's project-specific.

Prefer \`archive_context\` over \`delete_context\`.
`;

const GLOBAL_DIRECTIVE = `${MARKER}
## context-window (MCP)

If the working directory or any parent directory contains a
\`.context/manifest.json\`, this is a project that uses the context-window
MCP server. Call \`get_project_summary\` before answering anything that
depends on prior project knowledge.
`;

export interface DirectiveResult {
  path: string;
  action: "created" | "appended" | "already-present";
}

export function ensureProjectDirective(rootPath: string): DirectiveResult {
  const path = join(rootPath, "CLAUDE.md");
  return ensureDirective(path, PROJECT_DIRECTIVE);
}

export function ensureGlobalDirective(): DirectiveResult {
  const dir = join(homedir(), ".claude");
  const path = join(dir, "CLAUDE.md");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return ensureDirective(path, GLOBAL_DIRECTIVE);
}

function ensureDirective(path: string, block: string): DirectiveResult {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, block, "utf8");
    return { path, action: "created" };
  }
  const existing = readFileSync(path, "utf8");
  if (existing.includes(MARKER)) {
    return { path, action: "already-present" };
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, existing + sep + block, "utf8");
  return { path, action: "appended" };
}
