export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function printError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${msg}\n`);
}

export function exitWithError(err: unknown): never {
  printError(err);
  process.exit(1);
}

export function table(rows: Array<Record<string, string | number>>, columns?: string[]): void {
  if (rows.length === 0) {
    process.stdout.write("(no rows)\n");
    return;
  }
  const cols = columns ?? Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const sep = "  ";
  const header = cols.map((c, i) => c.padEnd(widths[i])).join(sep);
  const underline = cols.map((_, i) => "-".repeat(widths[i])).join(sep);
  process.stdout.write(header + "\n" + underline + "\n");
  for (const row of rows) {
    process.stdout.write(
      cols.map((c, i) => String(row[c] ?? "").padEnd(widths[i])).join(sep) + "\n",
    );
  }
}
