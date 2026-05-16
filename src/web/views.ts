import type { Context, Project, Manifest, SearchResultItem } from "../core/types.js";

export function h(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface LayoutOptions {
  title: string;
  active?: "contexts" | "projects" | "search" | "dashboard";
  flash?: { kind: "success" | "error" | "warn"; message: string } | null;
  searchQuery?: string;
}

export function layout(opts: LayoutOptions, body: string): string {
  const flash = opts.flash
    ? `<div class="flash ${h(opts.flash.kind)}">${h(opts.flash.message)}</div>`
    : "";
  const active = (key: string) => (opts.active === key ? "active" : "");
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${h(opts.title)} · context-window</title>
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<header class="topbar">
  <h1>context-window</h1>
  <nav>
    <a href="/" class="${active("contexts")}">Contexts</a>
    <a href="/projects" class="${active("projects")}">Projects</a>
    <a href="/dashboard" class="${active("dashboard")}">Dashboard</a>
  </nav>
  <form class="search" action="/search" method="get">
    <input type="text" name="q" placeholder="Search contexts…" value="${h(opts.searchQuery ?? "")}" />
  </form>
</header>
<main>
${flash}
${body}
</main>
</body>
</html>`;
}

export function contextListView(contexts: Context[]): string {
  const rows =
    contexts.length === 0
      ? `<tr><td colspan="6" class="empty">No contexts yet. <a href="/contexts/new">Create your first context</a>.</td></tr>`
      : contexts
          .map(
            (c) => `
            <tr>
              <td><a href="/contexts/${h(c.id)}">${h(c.name)}</a><div class="muted" style="font-size:12px;margin-top:2px">${h(c.description)}</div></td>
              <td>${h(c.category)}</td>
              <td class="priority-${h(c.priority)}">${h(c.priority)}</td>
              <td>${c.tags.map((t) => `<span class="tag muted">${h(t)}</span>`).join("")}</td>
              <td>${c.token_count}</td>
              <td class="status-${h(c.status)}">${h(c.status)}</td>
            </tr>`,
          )
          .join("");
  return `
<div class="page-header">
  <h2>Contexts</h2>
  <a href="/contexts/new" class="btn primary">+ New context</a>
</div>
<table>
  <thead><tr><th>Name</th><th>Category</th><th>Priority</th><th>Tags</th><th>Tokens</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function contextFormView(opts: {
  mode: "create" | "edit";
  context?: Context;
  categories: string[];
  error?: string;
}): string {
  const c = opts.context;
  const action = c ? `/contexts/${h(c.id)}` : `/contexts`;
  const submitLabel = c ? "Save changes" : "Create context";
  const title = c ? `Edit context` : `New context`;
  const errBlock = opts.error ? `<div class="flash error">${h(opts.error)}</div>` : "";
  const categoryOptions = opts.categories
    .map((cat) => `<option value="${h(cat)}" ${c?.category === cat ? "selected" : ""}>${h(cat)}</option>`)
    .join("");
  const priorities = ["critical", "important", "reference", "archived"];
  const prioritySelect = priorities
    .map((p) => `<option value="${p}" ${(c?.priority ?? "reference") === p ? "selected" : ""}>${p}</option>`)
    .join("");
  const visibilities = ["private", "shared", "public"];
  const visibilitySelect = visibilities
    .map((v) => `<option value="${v}" ${(c?.visibility ?? "private") === v ? "selected" : ""}>${v}</option>`)
    .join("");
  const statuses = ["active", "archived", "deprecated"];
  const statusSelect = c
    ? `<label for="status">Status</label>
       <select name="status" id="status">${statuses
         .map((s) => `<option value="${s}" ${c.status === s ? "selected" : ""}>${s}</option>`)
         .join("")}</select>`
    : "";
  const versionField = c
    ? `<input type="hidden" name="expected_version" value="${c.version}" />`
    : "";
  return `
<div class="page-header"><h2>${h(title)}</h2></div>
${errBlock}
<form class="stacked card" action="${action}" method="post">
  <label for="name">Name</label>
  <input type="text" name="name" id="name" required value="${h(c?.name ?? "")}" />

  <label for="description">Description</label>
  <input type="text" name="description" id="description" required value="${h(c?.description ?? "")}" placeholder="One-line summary used by LLMs to decide whether to load this context" />

  <div class="row">
    <div>
      <label for="category">Category</label>
      <select name="category" id="category">${categoryOptions}</select>
    </div>
    <div>
      <label for="priority">Priority</label>
      <select name="priority" id="priority">${prioritySelect}</select>
    </div>
    <div>
      <label for="visibility">Visibility</label>
      <select name="visibility" id="visibility">${visibilitySelect}</select>
    </div>
  </div>

  <label for="tags">Tags</label>
  <input type="text" name="tags" id="tags" value="${h((c?.tags ?? []).join(", "))}" placeholder="Comma-separated, e.g. rust, backend, conventions" />

  ${statusSelect}

  <label for="content">Content (markdown)</label>
  <textarea name="content" id="content" required>${h(c?.content ?? "")}</textarea>

  ${versionField}

  <div class="actions">
    <button type="submit" class="btn primary">${h(submitLabel)}</button>
    <a href="${c ? `/contexts/${h(c.id)}` : "/"}" class="btn">Cancel</a>
  </div>
</form>`;
}

export function contextDetailView(
  c: Context,
  referencingProjects: Project[],
): string {
  const projectsBlock =
    referencingProjects.length === 0
      ? `<p class="muted">Not attached to any project.</p>`
      : `<ul>${referencingProjects
          .map((p) => `<li><a href="/projects/${h(p.id)}">${h(p.name)}</a></li>`)
          .join("")}</ul>`;
  return `
<div class="page-header">
  <h2>${h(c.name)}</h2>
  <a href="/contexts/${h(c.id)}/edit" class="btn">Edit</a>
  <form class="inline-form" action="/contexts/${h(c.id)}/archive" method="post"><button class="btn">Archive</button></form>
  <form class="inline-form" action="/contexts/${h(c.id)}/delete" method="post" onsubmit="return confirm('Permanently delete this context? This cannot be undone.');"><button class="btn danger">Delete</button></form>
</div>
<div class="card">
  <p>${h(c.description)}</p>
  <p class="meta">
    <strong>ID</strong> <span class="kbd">${h(c.id)}</span> &nbsp;
    <strong>Category</strong> ${h(c.category)} &nbsp;
    <strong>Priority</strong> <span class="priority-${h(c.priority)}">${h(c.priority)}</span> &nbsp;
    <strong>Visibility</strong> ${h(c.visibility)} &nbsp;
    <strong>Status</strong> ${h(c.status)} &nbsp;
    <strong>Tokens</strong> ${c.token_count} &nbsp;
    <strong>Version</strong> ${c.version} &nbsp;
    <strong>Updated</strong> ${h(c.updated_at.slice(0, 19).replace("T", " "))}
  </p>
  <p>${c.tags.length > 0 ? c.tags.map((t) => `<span class="tag muted">${h(t)}</span>`).join("") : '<span class="muted">no tags</span>'}</p>
</div>
<h3>Content</h3>
<div class="content-render">${h(c.content)}</div>
<h3 style="margin-top:24px">Attached to</h3>
${projectsBlock}`;
}

export function projectListView(projects: Project[]): string {
  const rows =
    projects.length === 0
      ? `<tr><td colspan="4" class="empty">No projects yet. Use <span class="kbd">context project init</span> in a project directory, or <a href="/projects/new">create one here</a>.</td></tr>`
      : projects
          .map(
            (p) => `
            <tr>
              <td><a href="/projects/${h(p.id)}">${h(p.name)}</a><div class="muted" style="font-size:12px;margin-top:2px">${h(p.description)}</div></td>
              <td>${p.context_refs.length}</td>
              <td><span class="kbd">${h(p.root_path ?? "—")}</span></td>
              <td>${h(p.updated_at.slice(0, 19).replace("T", " "))}</td>
            </tr>`,
          )
          .join("");
  return `
<div class="page-header">
  <h2>Projects</h2>
  <a href="/projects/new" class="btn primary">+ New project</a>
</div>
<table>
  <thead><tr><th>Name</th><th>Contexts</th><th>Root path</th><th>Updated</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function projectFormView(error?: string): string {
  const errBlock = error ? `<div class="flash error">${h(error)}</div>` : "";
  return `
<div class="page-header"><h2>New project</h2></div>
${errBlock}
<form class="stacked card" action="/projects" method="post">
  <label for="name">Name</label>
  <input type="text" name="name" id="name" required />

  <label for="description">Description</label>
  <input type="text" name="description" id="description" />

  <label for="root_path">Root path (optional, absolute)</label>
  <input type="text" name="root_path" id="root_path" placeholder="/Users/you/code/myproject — leave empty for a project that lives only in the library" />

  <div class="actions">
    <button type="submit" class="btn primary">Create project</button>
    <a href="/projects" class="btn">Cancel</a>
  </div>
</form>`;
}

export function projectDetailView(
  project: Project,
  manifest: Manifest,
  attachableContexts: Context[],
): string {
  const rows =
    manifest.contexts.length === 0
      ? `<tr><td colspan="6" class="empty">No contexts attached yet.</td></tr>`
      : manifest.contexts
          .map(
            (entry, i) => `
            <tr>
              <td>${i}</td>
              <td><a href="/contexts/${h(entry.context_id)}">${h(entry.name)}</a><div class="muted" style="font-size:12px;margin-top:2px">${h(entry.description)}</div></td>
              <td>${h(entry.category)}</td>
              <td class="priority-${h(entry.priority)}">${h(entry.priority)}</td>
              <td>${entry.token_count}</td>
              <td class="row-actions">
                <form class="inline-form" action="/projects/${h(project.id)}/move" method="post">
                  <input type="hidden" name="context_id" value="${h(entry.context_id)}" />
                  <input type="hidden" name="direction" value="up" />
                  <button class="btn small" ${i === 0 ? "disabled" : ""}>↑</button>
                </form>
                <form class="inline-form" action="/projects/${h(project.id)}/move" method="post">
                  <input type="hidden" name="context_id" value="${h(entry.context_id)}" />
                  <input type="hidden" name="direction" value="down" />
                  <button class="btn small" ${i === manifest.contexts.length - 1 ? "disabled" : ""}>↓</button>
                </form>
                <form class="inline-form" action="/projects/${h(project.id)}/detach" method="post" onsubmit="return confirm('Detach this context from the project?');">
                  <input type="hidden" name="context_id" value="${h(entry.context_id)}" />
                  <button class="btn small danger">Detach</button>
                </form>
              </td>
            </tr>`,
          )
          .join("");
  const attachOptions = attachableContexts
    .map(
      (c) => `<option value="${h(c.id)}">${h(c.name)} — ${h(c.category)} · ${h(c.priority)}</option>`,
    )
    .join("");
  const attachBlock =
    attachableContexts.length === 0
      ? `<p class="muted">Every active context is already attached. Create a new one to attach.</p>`
      : `
        <form action="/projects/${h(project.id)}/attach" method="post" class="card" style="display:flex; gap:12px; align-items:flex-end;">
          <div style="flex:1">
            <label for="attach-context">Attach an existing context</label>
            <select name="context_id" id="attach-context">${attachOptions}</select>
          </div>
          <div>
            <label for="attach-priority">Priority override</label>
            <select name="priority_override" id="attach-priority">
              <option value="">(use default)</option>
              <option value="critical">critical</option>
              <option value="important">important</option>
              <option value="reference">reference</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <button class="btn primary" type="submit">Attach</button>
        </form>`;
  return `
<div class="page-header">
  <h2>${h(project.name)}</h2>
  <a href="/contexts/new?attach_to=${h(project.id)}" class="btn">+ New context</a>
</div>
<div class="card">
  <p>${h(project.description) || '<span class="muted">No description</span>'}</p>
  <p class="meta">
    <strong>ID</strong> <span class="kbd">${h(project.id)}</span> &nbsp;
    <strong>Root path</strong> <span class="kbd">${h(project.root_path ?? "—")}</span> &nbsp;
    <strong>Total tokens</strong> ${manifest.total_token_count} &nbsp;
    <strong>Updated</strong> ${h(project.updated_at.slice(0, 19).replace("T", " "))}
  </p>
</div>

<h3>Attached contexts</h3>
<table>
  <thead><tr><th>#</th><th>Name</th><th>Category</th><th>Priority</th><th>Tokens</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<h3 style="margin-top:24px">Attach context</h3>
${attachBlock}`;
}

export function searchResultsView(query: string, results: SearchResultItem[]): string {
  const rows =
    results.length === 0
      ? `<tr><td colspan="5" class="empty">No matches for <strong>${h(query)}</strong>.</td></tr>`
      : results
          .map(
            (r) => `
            <tr>
              <td><a href="/contexts/${h(r.id)}">${h(r.name)}</a><div class="muted" style="font-size:12px;margin-top:2px">${h(r.description)}</div></td>
              <td>${h(r.category)}</td>
              <td class="priority-${h(r.priority)}">${h(r.priority)}</td>
              <td>${r.token_count}</td>
              <td>${r.snippet ? snippetHtml(r.snippet) : ""}</td>
            </tr>`,
          )
          .join("");
  return `
<div class="page-header"><h2>Search results for &ldquo;${h(query)}&rdquo;</h2></div>
<table>
  <thead><tr><th>Name</th><th>Category</th><th>Priority</th><th>Tokens</th><th>Snippet</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function snippetHtml(raw: string): string {
  const escaped = h(raw);
  return escaped.replaceAll("[", "<mark>").replaceAll("]", "</mark>");
}
