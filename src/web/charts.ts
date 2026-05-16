import type { UsageStats, UsageBucket } from "../core/types.js";
import { h } from "./views.js";

export function sparklineSvg(
  points: Array<{ day: string; count: number; errors: number }>,
  opts: { width?: number; height?: number; days?: number } = {},
): string {
  const width = opts.width ?? 720;
  const height = opts.height ?? 140;
  const days = opts.days ?? 30;
  const dense = fillMissingDays(points, days);
  if (dense.length === 0) return emptyChart(width, height);
  const maxCount = Math.max(1, ...dense.map((d) => d.count));
  const stepX = dense.length > 1 ? (width - 40) / (dense.length - 1) : width - 40;
  const baseY = height - 24;
  const topY = 12;
  const yFor = (n: number) => baseY - (n / maxCount) * (baseY - topY);

  const linePoints = dense
    .map((d, i) => `${20 + i * stepX},${yFor(d.count)}`)
    .join(" ");
  const areaPath = `M 20,${baseY} L ${linePoints} L ${20 + (dense.length - 1) * stepX},${baseY} Z`;
  const errorBars = dense
    .filter((d) => d.errors > 0)
    .map(
      (d, i) =>
        `<circle cx="${20 + dense.indexOf(d) * stepX}" cy="${yFor(d.count)}" r="3" fill="#b00020" />`,
    )
    .join("");
  const xLabels = [0, Math.floor(dense.length / 2), dense.length - 1]
    .filter((i, idx, arr) => arr.indexOf(i) === idx)
    .map(
      (i) =>
        `<text x="${20 + i * stepX}" y="${height - 4}" text-anchor="middle" font-size="11" fill="#6b6b6b">${h(dense[i].day.slice(5))}</text>`,
    )
    .join("");
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Calls per day">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" stroke="#e4e4dc" />
      <text x="${width - 10}" y="14" text-anchor="end" font-size="11" fill="#6b6b6b">max ${maxCount}/day</text>
      <path d="${areaPath}" fill="#1a4480" fill-opacity="0.1" />
      <polyline points="${linePoints}" fill="none" stroke="#1a4480" stroke-width="2" />
      ${errorBars}
      ${xLabels}
    </svg>`;
}

function fillMissingDays(
  points: Array<{ day: string; count: number; errors: number }>,
  days: number,
): Array<{ day: string; count: number; errors: number }> {
  const map = new Map(points.map((p) => [p.day, p]));
  const out: Array<{ day: string; count: number; errors: number }> = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { day: key, count: 0, errors: 0 });
  }
  return out;
}

function emptyChart(width: number, height: number): string {
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="No data">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" stroke="#e4e4dc" />
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="13" fill="#6b6b6b">No data yet.</text>
    </svg>`;
}

export function horizontalBars(
  buckets: UsageBucket[],
  options: { labelFor?: (b: UsageBucket) => string; max?: number } = {},
): string {
  if (buckets.length === 0) {
    return `<p class="muted">No data.</p>`;
  }
  const max = options.max ?? Math.max(...buckets.map((b) => b.count));
  return `<div class="bars">${buckets
    .map((b) => {
      const pct = max > 0 ? Math.round((b.count / max) * 100) : 0;
      const errorPct = b.count > 0 ? Math.round((b.error_count / b.count) * 100) : 0;
      const label = options.labelFor ? options.labelFor(b) : b.label;
      return `
        <div class="bar-row">
          <div class="bar-label">${h(label || "(none)")}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="bar-count">${b.count}${errorPct > 0 ? ` <span class="bar-err">(${errorPct}% err)</span>` : ""}</div>
        </div>`;
    })
    .join("")}</div>`;
}

export function statCard(label: string, value: string | number, hint?: string): string {
  return `<div class="stat-card">
    <div class="stat-value">${h(value)}</div>
    <div class="stat-label">${h(label)}</div>
    ${hint ? `<div class="stat-hint">${h(hint)}</div>` : ""}
  </div>`;
}

export function dashboardBody(opts: {
  stats: UsageStats;
  sinceDays: number;
  projectLabels: Map<string, string>;
  contextLabels: Map<string, string>;
}): string {
  const { stats, sinceDays, projectLabels, contextLabels } = opts;
  const errorRate =
    stats.total > 0 ? ((stats.errors / stats.total) * 100).toFixed(1) + "%" : "—";
  const lastSeen = stats.last_seen
    ? stats.last_seen.slice(0, 19).replace("T", " ")
    : "never";
  const uniqueProjects = stats.by_project.length;
  const uniqueContexts = stats.by_context.length;
  return `
<div class="page-header">
  <h2>Dashboard</h2>
  <form method="get" action="/dashboard" style="margin-left:auto; display:flex; gap:8px; align-items:center;">
    <label for="since" class="muted">Window</label>
    <select name="since_days" id="since" onchange="this.form.submit()">
      ${[7, 14, 30, 60, 90, 365]
        .map((d) => `<option value="${d}" ${d === sinceDays ? "selected" : ""}>${d} days</option>`)
        .join("")}
    </select>
  </form>
</div>

<div class="stat-row">
  ${statCard("Events", stats.total, `last ${sinceDays} days`)}
  ${statCard("Error rate", errorRate)}
  ${statCard("Active projects", uniqueProjects)}
  ${statCard("Touched contexts", uniqueContexts)}
  ${statCard("Last activity", lastSeen)}
</div>

<div class="card">
  <h3 style="margin-top:0">Activity over time</h3>
  ${sparklineSvg(stats.daily, { days: sinceDays })}
</div>

<div class="grid-2">
  <div class="card">
    <h3 style="margin-top:0">Top tools</h3>
    ${horizontalBars(stats.by_tool)}
  </div>
  <div class="card">
    <h3 style="margin-top:0">Top contexts</h3>
    ${horizontalBars(stats.by_context, {
      labelFor: (b) => contextLabels.get(b.key) ?? short(b.key),
    })}
  </div>
  <div class="card">
    <h3 style="margin-top:0">Top projects</h3>
    ${horizontalBars(stats.by_project, {
      labelFor: (b) => projectLabels.get(b.key) ?? short(b.key),
    })}
  </div>
  <div class="card">
    <h3 style="margin-top:0">By client (LLM / browser / CLI)</h3>
    ${horizontalBars(stats.by_client, { labelFor: (b) => b.label || "(unknown)" })}
  </div>
  <div class="card">
    <h3 style="margin-top:0">By source</h3>
    ${horizontalBars(stats.by_source)}
  </div>
</div>`;
}

function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function miniUsageBlock(stats: UsageStats, sinceDays: number): string {
  if (stats.total === 0) return `<p class="muted">No usage recorded yet.</p>`;
  return `
    <div class="stat-row" style="margin-bottom: 12px;">
      ${statCard("Events", stats.total, `last ${sinceDays} days`)}
      ${statCard("Errors", stats.errors)}
      ${statCard("Last activity", stats.last_seen ? stats.last_seen.slice(0, 16).replace("T", " ") : "—")}
    </div>
    <div class="grid-2">
      <div><h4 style="margin:6px 0">Top tools</h4>${horizontalBars(stats.by_tool.slice(0, 5))}</div>
      <div><h4 style="margin:6px 0">By client</h4>${horizontalBars(stats.by_client.slice(0, 5), { labelFor: (b) => b.label || "(unknown)" })}</div>
    </div>`;
}
