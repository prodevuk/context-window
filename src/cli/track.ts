import type { Services } from "../core/services.js";

interface TrackExtras {
  project_id?: string | null;
  context_id?: string | null;
}

const CLI_CLIENT = { name: "cli", version: "0.1.0" };

export async function tracked<T>(
  services: Services,
  tool: string,
  fn: () => Promise<T> | T,
  extract?: (result: T) => TrackExtras,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const extras = extract ? extract(result) : {};
    services.usage.record({
      source: "cli",
      tool_name: tool,
      duration_ms: Date.now() - start,
      outcome: "success",
      project_id: extras.project_id ?? null,
      context_id: extras.context_id ?? null,
      client_name: CLI_CLIENT.name,
      client_version: CLI_CLIENT.version,
    });
    return result;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : "INTERNAL";
    services.usage.record({
      source: "cli",
      tool_name: tool,
      duration_ms: Date.now() - start,
      outcome: "error",
      error_code: code,
      client_name: CLI_CLIENT.name,
      client_version: CLI_CLIENT.version,
    });
    throw err;
  }
}
