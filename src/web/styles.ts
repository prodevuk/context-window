export const STYLES = `
* { box-sizing: border-box; }
:root {
  --bg: #fafaf7;
  --surface: #ffffff;
  --ink: #1a1a1a;
  --muted: #6b6b6b;
  --line: #e4e4dc;
  --accent: #1a4480;
  --accent-soft: #eef3fb;
  --danger: #b00020;
  --danger-soft: #fbe9ec;
  --good: #1f6f3a;
  --warn: #8a6300;
}
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header.topbar { background: var(--ink); color: #fff; padding: 14px 24px; display: flex; align-items: center; gap: 24px; }
header.topbar h1 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: 0.2px; }
header.topbar nav { display: flex; gap: 18px; flex: 1; }
header.topbar nav a { color: #d6d6cd; font-size: 14px; }
header.topbar nav a:hover { color: #fff; text-decoration: none; }
header.topbar nav a.active { color: #fff; }
header.topbar form.search { flex: 1; max-width: 360px; }
header.topbar form.search input { width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid #444; background: #2a2a2a; color: #fff; }
main { max-width: 1100px; margin: 0 auto; padding: 24px; }
.flash { padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 14px; }
.flash.success { background: #eaf5ee; color: var(--good); border: 1px solid #c8e2d2; }
.flash.error { background: var(--danger-soft); color: var(--danger); border: 1px solid #f3c3cc; }
.flash.warn { background: #fbf3df; color: var(--warn); border: 1px solid #ecd9a3; }
h2 { margin-top: 0; font-weight: 600; }
.page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.page-header h2 { flex: 1; margin: 0; }
.btn { display: inline-block; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 14px; cursor: pointer; }
.btn:hover { background: #f0f0e8; text-decoration: none; }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn.primary:hover { background: #143459; }
.btn.danger { background: var(--surface); color: var(--danger); border-color: #e3b3bc; }
.btn.danger:hover { background: var(--danger-soft); }
.btn.small { padding: 4px 10px; font-size: 13px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--line); font-size: 14px; vertical-align: top; }
th { background: #f3f3ec; font-weight: 600; font-size: 13px; }
tr:last-child td { border-bottom: none; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; margin-right: 4px; }
.tag.muted { background: #eee; color: var(--muted); }
.priority-critical { color: var(--danger); font-weight: 600; }
.priority-important { color: var(--warn); font-weight: 600; }
.priority-reference { color: var(--muted); }
.priority-archived { color: var(--muted); font-style: italic; }
.status-archived { color: var(--muted); font-style: italic; }
.status-deprecated { color: var(--danger); }
form.stacked label { display: block; font-size: 13px; font-weight: 600; color: var(--muted); margin: 14px 0 4px; }
form.stacked input[type=text], form.stacked select, form.stacked textarea { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); font: inherit; }
form.stacked textarea { min-height: 240px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
form.stacked .row { display: flex; gap: 16px; }
form.stacked .row > div { flex: 1; }
form.stacked .actions { margin-top: 22px; display: flex; gap: 10px; }
.meta { color: var(--muted); font-size: 13px; }
.meta strong { color: var(--ink); }
.content-render { background: #f7f7f0; border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.55; }
.muted { color: var(--muted); }
.kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f0f0e8; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--line); }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.inline-form { display: inline; }
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.detach-btn { all: unset; cursor: pointer; color: var(--danger); font-size: 13px; }
.detach-btn:hover { text-decoration: underline; }

.stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 18px; }
.stat-card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
.stat-value { font-size: 22px; font-weight: 600; color: var(--ink); }
.stat-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
.stat-hint { color: var(--muted); font-size: 11px; margin-top: 4px; }

.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }

.bars { display: flex; flex-direction: column; gap: 6px; }
.bar-row { display: grid; grid-template-columns: minmax(120px, 0.5fr) 1fr 64px; align-items: center; gap: 10px; font-size: 13px; }
.bar-label { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { background: #eee; border-radius: 4px; height: 10px; overflow: hidden; }
.bar-fill { height: 10px; background: var(--accent); }
.bar-count { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
.bar-err { color: var(--danger); font-size: 11px; }
`;
