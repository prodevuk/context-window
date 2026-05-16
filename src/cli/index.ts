#!/usr/bin/env node
import { Command } from "commander";
import { registerContextCommands } from "./context-commands.js";
import { registerProjectCommands } from "./project-commands.js";
import { ensureGlobalDirective } from "./claude-md.js";
import { printJson } from "./output.js";

const program = new Command();

program
  .name("context")
  .description("Context management system (local mode)")
  .version("0.1.0");

program
  .command("setup")
  .description("Append the context-window directive to ~/.claude/CLAUDE.md so Claude Code picks up the MCP tools automatically. Idempotent.")
  .action(() => {
    const result = ensureGlobalDirective();
    printJson(result);
  });

registerContextCommands(program);
registerProjectCommands(program);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
