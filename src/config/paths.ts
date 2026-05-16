import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const DB_DIRNAME = ".context-db";
const DB_FILENAME = "context.db";
const MANIFEST_DIRNAME = ".context";
const MANIFEST_FILENAME = "manifest.json";

export function defaultDbPath(): string {
  const dir = join(homedir(), DB_DIRNAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, DB_FILENAME);
}

export function resolveDbPath(override?: string): string {
  const target = override ?? process.env.CONTEXT_DB_PATH ?? defaultDbPath();
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return target;
}

export function findProjectRoot(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, MANIFEST_DIRNAME, MANIFEST_FILENAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function manifestPathFor(rootPath: string): string {
  return join(rootPath, MANIFEST_DIRNAME, MANIFEST_FILENAME);
}

export function ensureManifestDir(rootPath: string): string {
  const dir = join(rootPath, MANIFEST_DIRNAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
