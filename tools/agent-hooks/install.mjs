#!/usr/bin/env node
/**
 * Install or remove Doom Term's agent hooks.
 *
 *   node tools/agent-hooks/install.mjs            # install
 *   node tools/agent-hooks/install.mjs --remove   # remove ours, leave others
 *   node tools/agent-hooks/install.mjs --status   # report, change nothing
 *   node tools/agent-hooks/install.mjs --purge-nodeterm   # also drop nodeterm's
 *
 * ── WHY THIS APPENDS RATHER THAN REPLACES ──────────────────────────────────
 *
 * `hooks.<Event>` in Claude Code's settings.json is an ARRAY of matcher groups.
 * Other tools install into the same array — nodeterm did on this machine, for
 * five agents, on 2026-08-23. Overwriting it would silently break whatever else
 * the user runs, and we would never notice because our own thing would work.
 *
 * So: every entry we write carries MARKER in its command string. Install
 * replaces only entries carrying it; removal deletes only those. Anything we
 * did not write is left exactly as found, and running install twice is a no-op
 * rather than a duplicate.
 *
 * A backup is written next to the file the first time it is modified.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Our fingerprint. Never change it without a migration — removal keys on it. */
const MARKER = 'doom-term-hook';

const HOOK_SRC = join(dirname(fileURLToPath(import.meta.url)), 'doom-term-hook.sh');
const HOOK_DEST = join(homedir(), '.doom-term', 'agent-hooks', 'doom-term-hook.sh');

/**
 * The events worth forwarding.
 *
 * PermissionRequest is the summons: the vendor telling us it has stopped and
 * needs a human. Stop clears it. Notification is deliberately NOT here — it is
 * a superset that fires for things which are not a block, and summoning on it
 * would take the screen for no reason.
 */
const EVENTS = ['PermissionRequest', 'Stop'];

/**
 * Both vendors use the same shape — `hooks.<Event>` is an array of matcher
 * groups, each with its own `hooks` array — and the same PascalCase event
 * names. (Codex's config.toml carries snake_case keys, but those are its
 * internal state cache, not event names. Verified against ~/.codex/hooks.json
 * on 2026-09-01.)
 */
const TARGETS = [
  { name: 'claude', path: join(homedir(), '.claude', 'settings.json') },
  { name: 'codex', path: join(homedir(), '.codex', 'hooks.json') },
];

/** Another tool's entries, matched so they can be removed on request. */
const isNodeterm = (h) =>
  typeof h?.command === 'string' && h.command.includes('.nodeterm/agent-hooks');

const command = (agent) => `sh '${HOOK_DEST}' ${agent}  # ${MARKER}`;
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes(MARKER);

function backupOnce(path) {
  const bak = `${path}.doom-term-backup`;
  if (!existsSync(bak)) copyFileSync(path, bak);
  return bak;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}


/**
 * Rewrite one vendor's hook config.
 *
 * Ours are always stripped first, so installing twice is a no-op rather than a
 * duplicate. `purgeNodeterm` additionally drops the other tool's entries — only
 * when explicitly asked, because silently disabling somebody else's terminal is
 * exactly the failure this file exists to avoid.
 */
function apply({ name, path }, { remove, purgeNodeterm }) {
  if (!existsSync(path)) return { path, note: 'not installed' };

  const cfg = readJson(path, {});
  cfg.hooks ??= {};
  const foreign = new Set();
  let purged = 0;
  let changed = false;

  // Ours go only on EVENTS, but a purge sweeps EVERY event the file declares —
  // "uninstall nodeterm" means all of it, not just the two we happen to use.
  const sweep = purgeNodeterm
    ? [...new Set([...EVENTS, ...Object.keys(cfg.hooks)])]
    : EVENTS;

  for (const event of sweep) {
    const before = JSON.stringify(cfg.hooks[event] ?? []);

    let groups = (cfg.hooks[event] ?? []).map((g) => {
      const hooks = (g.hooks ?? []).filter((h) => {
        if (isOurs(h)) return false;
        if (purgeNodeterm && isNodeterm(h)) { purged++; return false; }
        foreign.add(event);
        return true;
      });
      return { ...g, hooks };
    }).filter((g) => (g.hooks ?? []).length > 0);

    if (!remove && EVENTS.includes(event)) {
      groups = [...groups, { hooks: [{ type: 'command', command: command(name) }] }];
    }

    if (groups.length === 0) delete cfg.hooks[event];
    else cfg.hooks[event] = groups;

    if (JSON.stringify(cfg.hooks[event] ?? []) !== before) changed = true;
  }

  if (changed) {
    backupOnce(path);
    writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
  }
  return { path, changed, purged, coexisting: [...foreign] };
}

function status() {
  const out = [];
  for (const { name, path } of TARGETS) {
    if (!existsSync(path)) { out.push(`${name}: not installed`); continue; }
    const cfg = readJson(path, {});
    for (const event of [...new Set([...EVENTS, ...Object.keys(cfg.hooks ?? {})])]) {
      const entries = (cfg.hooks?.[event] ?? []).flatMap((g) => g.hooks ?? []);
      const ours = entries.filter(isOurs).length;
      const nt = entries.filter(isNodeterm).length;
      const other = entries.length - ours - nt;
      if (ours + nt + other === 0) continue;
      out.push(`${name}.${event}: ${ours} doom-term, ${nt} nodeterm, ${other} other`);
    }
  }
  return out;
}

const remove = process.argv.includes('--remove');

if (process.argv.includes('--status')) {
  console.log(status().join('\n'));
  process.exit(0);
}

if (!remove) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dirname(HOOK_DEST), { recursive: true });
  copyFileSync(HOOK_SRC, HOOK_DEST);
  chmodSync(HOOK_DEST, 0o755);
}

const purgeNodeterm = process.argv.includes('--purge-nodeterm');
const results = TARGETS.map((t) => apply(t, { remove, purgeNodeterm }));
console.log(remove ? 'Removed Doom Term hooks.' : `Installed Doom Term hooks -> ${HOOK_DEST}`);
for (const r of results) {
  const co = r.coexisting?.length ? ` (left other tools' hooks on: ${r.coexisting.join(', ')})` : '';
  const pu = r.purged ? ` (removed ${r.purged} nodeterm entr${r.purged === 1 ? 'y' : 'ies'})` : '';
  console.log(`  ${r.path}: ${r.note ?? (r.changed ? 'updated' : 'unchanged')}${pu}${co}`);
}
console.log('\nStatus:');
console.log(status().map((l) => `  ${l}`).join('\n'));
