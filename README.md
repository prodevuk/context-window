# context-window

A context management system with two first-class entities:

- **Context** — a reusable, standalone block of structured knowledge (a person, a tech, a process, conventions, anything an LLM might want to load).
- **Project** — an ordered set of references to contexts; emits a per-project `manifest.json` that LLMs read as an entry point.

Local mode is fully implemented: SQLite storage, stdio MCP server, CLI. Cloud mode is a future layer; the core/storage split is designed so that only the storage backend and transport need to swap.

## Install

```bash
npm install
npm run build
```

Requires Node ≥ 20.

## Quick start

```bash
# One-time: initialise the local SQLite database (~/.context-db/context.db by default)
node dist/cli/index.js context init

# In a project directory, create a project (writes .context/manifest.json)
cd /path/to/your/project
node /path/to/context-window/dist/cli/index.js project init -n my-project

# Create a standalone context and attach it
node dist/cli/index.js context new \
  -n "Rust Conventions" \
  -d "Idiomatic Rust style" \
  --content-file ./rust-style.md \
  --category conventions \
  --tags rust,backend \
  --priority important

node dist/cli/index.js project attach <context-id-prefix>

# Run the MCP server (stdio) for the current project
node dist/cli/index.js context serve
```

The DB path can be overridden via `--db <path>` or `CONTEXT_DB_PATH`.

## Data model

```
Context              Project
 ├─ id (uuid)         ├─ id (uuid)
 ├─ name              ├─ name
 ├─ description       ├─ description
 ├─ category          ├─ root_path
 ├─ content           ├─ settings (token_budget, …)
 ├─ tags[]            └─ context_refs[]  (ordered)
 ├─ priority                ├─ context_id
 ├─ visibility              ├─ position
 ├─ status                  └─ priority_override (optional)
 ├─ version
 └─ token_count
```

A project's `manifest.json` is a lightweight index — names, descriptions, categories, priorities, token counts. LLMs read it first, then fetch full content over MCP as needed.

## CLI reference

### Contexts
| Command | Purpose |
|---|---|
| `context init` | Create/upgrade the database |
| `context new -n -d --content/--content-file ...` | Create a standalone context |
| `context list [--category --status --tag --json]` | List contexts |
| `context search <query>` | Full-text search (FTS5) |
| `context show <id\|prefix>` | Display full content |
| `context edit <id\|prefix>` | Open content in `$EDITOR` |
| `context archive <id\|prefix>` | Set status to archived |
| `context delete <id\|prefix> --yes` | Permanently delete (requires `--yes`) |
| `context export [--ids ...]` | Dump as JSON |
| `context import -f file.json` | Bulk import from JSON array |
| `context serve [--project <id>]` | Run the MCP server (stdio) |

### Projects
| Command | Purpose |
|---|---|
| `project init [-n -d]` | Initialise a project in CWD, write manifest |
| `project list` | List all projects |
| `project attach <ctx-id> [--position N --priority P]` | Attach a context |
| `project detach <ctx-id>` | Detach (context itself is kept) |
| `project contexts` | Show the manifest's context list |
| `project manifest [--stdout]` | Regenerate manifest |
| `project budget --budget N` | Show which contexts fit a token budget |
| `project reorder --ids id1,id2,id3` | Reorder attached contexts |

## MCP server

Stdio server exposing 15 tools. The active project is selected via, in order:
1. `--project-id <id>` CLI flag
2. `CONTEXT_PROJECT_ID` env var
3. `project_id` field of the nearest `.context/manifest.json` on the filesystem

Tools:
- `get_project_summary` — orientation tool; returns the manifest
- `get_context` / `get_contexts_by_category` / `list_all_contexts`
- `search_contexts` (`scope: "project" | "all"`)
- `get_context_budget` — priority-ordered subset that fits a token budget
- `create_context` / `update_context` (with optional `expected_version`)
- `archive_context` / `delete_context` (requires `confirm: true`)
- `attach_context` / `detach_context` / `reorder_contexts`
- `create_category`
- `regenerate_manifest`

Wire it into an MCP client (e.g., Claude Desktop) as a stdio server pointing at `dist/mcp/server.js` with `--project-id` of the project you want active.

## Architecture

```
src/
├── core/         business logic, storage-agnostic
│   ├── types.ts            Zod schemas + types
│   ├── context-service.ts  context CRUD + auto manifest propagation
│   ├── project-service.ts  attach/detach/reorder with list-insert semantics
│   ├── manifest-service.ts manifest build, budget, cross-project regen
│   ├── tokens.ts           gpt-tokenizer wrapper
│   ├── services.ts         DI container
│   └── errors.ts
├── storage/      persistence
│   ├── repository.ts             interface (cloud mode will reimplement)
│   └── sqlite/sqlite-repository.ts  better-sqlite3 + FTS5
├── mcp/          MCP server (stdio)
│   ├── tools.ts            tool registry
│   ├── server.ts           stdio entry point
│   └── zod-to-json-schema.ts  minimal converter for tool listing
├── cli/          commander-based CLI
│   ├── context-commands.ts
│   ├── project-commands.ts
│   ├── active-project.ts   resolves "current project" (flag → env → manifest → cwd)
│   └── output.ts
└── config/paths.ts  DB + manifest path resolution
```

Key invariants:
- The manifest on disk is **derived state** — it is regenerated automatically whenever an attached context is created, updated, archived, or deleted, and whenever a project's attachments change.
- Contexts with `status !== "active"` are excluded from manifests and budgets (they remain attached, just hidden from LLMs).
- Position is always normalised to `0..n-1` after any attach/detach.
- Tokens are computed on write, never on read.

## Tests

```bash
node --test tests/services.test.mjs   # 7 unit tests over the service layer
node tests/smoke.mjs                  # 27 end-to-end checks via CLI + MCP stdio
npx tsc --noEmit                      # typecheck
```

The smoke test spawns the built CLI and the MCP server as real child processes, drives them through a sandbox temp directory, and asserts that the manifest on disk and MCP tool responses match expectations.

## For AI coding agents

This section is for agents that want to **use** this system — install the MCP server in their client, and call its tools effectively.

### 1. Install the MCP server in your client

Pick the project the server should serve. Either create it (`project init` in the project directory) or look one up:

```bash
node dist/cli/index.js project list
```

Note the project's UUID, then register a stdio MCP server in your client's config.

**Claude Code** — add to `~/.claude.json` (user-level) or `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "context-window": {
      "command": "node",
      "args": [
        "/absolute/path/to/context-window/dist/mcp/server.js",
        "--project-id",
        "<project-uuid>"
      ],
      "env": {
        "CONTEXT_DB_PATH": "/Users/you/.context-db/context.db"
      }
    }
  }
}
```

**Claude Desktop** — same shape, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-window": {
      "command": "node",
      "args": ["/absolute/path/to/context-window/dist/mcp/server.js"],
      "env": {
        "CONTEXT_PROJECT_ID": "<project-uuid>",
        "CONTEXT_DB_PATH": "/Users/you/.context-db/context.db"
      }
    }
  }
}
```

**Project resolution order** (the server picks the first that works):
1. `--project-id <uuid>` flag
2. `CONTEXT_PROJECT_ID` env var
3. `project_id` field of the nearest `.context/manifest.json` walking up from the working directory

Restart your client after editing the config. You should now see the tools listed below available.

### 2. How to use the tools

**Always start with `get_project_summary`.** It returns the project's name, description, and metadata for every attached context — names, descriptions, categories, priorities, and token counts. This is enough to decide what to load without reading any full bodies.

Then, depending on the task:

| You want to… | Call | Notes |
|---|---|---|
| Load a specific context by id | `get_context` | Returns the full content. |
| Stay within a token budget | `get_context_budget` | Returns the highest-priority subset that fits, plus what was excluded and why. |
| Find context by keyword | `search_contexts` | Default `scope: "project"`. Pass `scope: "all"` to search the whole user library. |
| Filter by category | `get_contexts_by_category` | Only searches the active project. |
| See contexts not attached to this project | `list_all_contexts` | The user's full library. |
| Capture something new you learned | `create_context` | Set `created_by: "llm:<your-model>"`. Returns `{ context, warnings }`. |
| Attach a created/existing context to the project | `attach_context` | Idempotent (upsert). Optional `position` and `priority_override`. |
| Edit an existing context | `update_context` | Pass `expected_version` for safe concurrent updates. |
| Hide a context from the manifest | `archive_context` | Stays attached but excluded from summary/budget/search. |
| Remove a context from the project | `detach_context` | Context itself is preserved in the library. |
| Permanently delete | `delete_context` | **Requires `confirm: true`.** Prefer archiving. |
| Reshuffle priority order | `reorder_contexts` | Pass the full ordered id list. |
| Create a custom category | `create_category` | Categories are flat strings. |
| Refresh the on-disk manifest | `regenerate_manifest` | Rarely needed — manifests auto-regenerate on every mutation. |

### 3. Recommended workflow

A reasonable default loop for an agent in a fresh conversation:

1. Call `get_project_summary`. Read the descriptions to decide which contexts are relevant to the user's request.
2. If your context budget is tight, call `get_context_budget` with the budget. Otherwise, call `get_context` on each relevant id.
3. If the relevant context isn't attached, `search_contexts` with `scope: "all"` to see whether it exists somewhere in the user's library. If it does, `attach_context`. If not, ask the user whether to capture and `create_context` + `attach_context`.
4. While working, when you learn something the user will want next time (a convention, a constraint, a decision, a person's preference), call `create_context` with a clear `name`, useful `description`, and `created_by: "llm:<model>"`. Decide attach-or-leave based on whether it's project-specific.
5. To revise something you previously created, fetch the current version, then `update_context` with `expected_version` set to detect conflicts.

### 4. Patterns and pitfalls

- **Descriptions are catalogue entries.** They are what future-you and other agents use to decide whether to load the full content. Write them as one-line summaries of "what this contains and when it's useful," not as titles.
- **Archive, don't delete.** `delete_context` requires `confirm: true` precisely because it's destructive. Default to `archive_context` unless the user explicitly asks for deletion.
- **`status: "archived"` contexts are hidden** from `get_project_summary`, `get_context_budget`, `search_contexts`, and `get_contexts_by_category`. They still appear in `list_all_contexts` (so you can find and un-archive them via `update_context`).
- **Optimistic locking.** If you pass `expected_version` to `update_context` and another writer has bumped the version, you get a `VERSION_CONFLICT` error — re-fetch with `get_context` and retry with the new version.
- **`attach_context` is an upsert.** Calling it again with a different `position` or `priority_override` mutates the existing attachment rather than creating a duplicate.
- **Position is list-insert.** `position: 0` puts the context first and shifts everything else down by one. Positions are always normalised to `0..n-1` after any mutation.
- **Token counts are pre-computed.** They're stored on the context and trustworthy — use them for budgeting without re-tokenising.
- **Search is FTS5 prefix matching.** Each whitespace-separated token becomes a `"token"*` prefix and tokens are OR-ed. Multi-word queries are loose; single distinctive terms are precise.
- **No project = no project-scoped tools.** If the server starts without resolving a project (`NO_ACTIVE_PROJECT`), `get_project_summary`, `attach_context`, `detach_context`, and the project-scoped variants of `search_contexts` will error. `list_all_contexts`, `get_context`, `create_context`, and `search_contexts` with `scope: "all"` still work.

### 5. Example session

```jsonc
// 1. Orient yourself
→ get_project_summary {}
← { project_name: "billing-service", contexts: [
     { context_id: "…a1", name: "Rust Conventions", priority: "important", token_count: 1240 },
     { context_id: "…b2", name: "Stripe Webhook Notes", priority: "critical", token_count: 820 }
  ], total_token_count: 2060 }

// 2. Load what you need
→ get_context { context_id: "…b2" }
← { id: "…b2", content: "...", version: 3, … }

// 3. Capture a new finding mid-conversation
→ create_context {
    name: "Stripe Idempotency Key Convention",
    description: "We always use <user_id>:<event_id> as the idempotency key for Stripe charges.",
    content: "## Convention\n…",
    category: "conventions",
    tags: ["stripe", "billing"],
    priority: "important",
    created_by: "llm:claude-opus-4-7"
  }
← { context: { id: "…c3", … }, warnings: [] }

→ attach_context { context_id: "…c3" }
← { project: { id: "…", context_refs: [...] } }
```

### 6. If the server isn't responding

- Run `node dist/cli/index.js project list` to confirm the project UUID still exists.
- Check `CONTEXT_DB_PATH` — the server will silently create an empty DB if the path doesn't exist.
- The server logs errors to stderr; redirect it (`2>/tmp/ctx.log`) if your client doesn't surface it.
- Build is required after a `git pull`: `npm install && npm run build`.

## Licence

[MIT](./LICENSE) © 2026 Promise.
