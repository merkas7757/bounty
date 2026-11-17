// token-radar-01 entry point (Node 22+, no dependencies).
//
//   node main.ts --input <snapshot.json|dir> [--output <dir>]
//
// The grader mounts the sealed snapshot at /input and collects /output; MAKEFUN_OUTPUT_DIR stands in
// for /output outside the container. This program scores every protocol with lib/model.ts, refuses to
// publish a board the gate would reject, and lays out everything the judge reads:
//
//   board.json      the ranked board, one row per protocol, with its implied value, band and farm plan
//   data.js         the same figures as window.RADAR, which the static dashboard reads
//   dashboard/      the offline page: board, a detail view per protocol, comps, model, live tokens
//   screenshots/    the board, a detail view and a filtered view
//   dossier.json    the summary, built by the vendored make.fun library from what is on disk
//   manifest.json   the sizes this run wrote, so a reader can see the caps were met

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps, quoted from reference/gate.json: the text budget shapes the bytes, the rest refuse. */
const CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--flag <value>` or `--flag=<value>` in the arguments, else `fallback`. */
function flag(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

/** Read the snapshot this run has to score: a file, or a directory holding snapshot.json. */
function snapshotText(): { text: string; path: string } {
  const where = flag('input', '/input');
  const path = where.endsWith('.json') ? where : join(where, 'snapshot.json');
  if (!existsSync(path)) {
    process.stderr.write(`token radar: no snapshot at ${path}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  return { text: readFileSync(path, 'utf8'), path };
}

/** Copy one directory's regular files into `to`, skipping dot-names, and name them. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

const { text, path: inputPath } = snapshotText();
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(text);
const { board, radar } = buildRadar(snapshot);

// The gate: a board that misses a watchlist slug, misranks a row or ships a short farm plan is not
// published at all, so a broken run fails loudly here instead of scoring badly later.
const refused = boardIssue(board, snapshot);
if (refused !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${refused}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const pages = copyDir(join(ROOT, 'dashboard'), join(out, 'dashboard'));
if (pages.length === 0) {
  process.stderr.write('token radar: dashboard/ is empty: the judge has no page to read\n');
  process.exit(1);
}

const shots = copyDir(join(ROOT, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
if (shots.length > CAPS.screenshots.max) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: at most ${CAPS.screenshots.max} are read\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SAFE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const bytes = statSync(join(out, 'screenshots', name)).size;
  if (bytes > CAPS.screenshots.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name} is ${bytes} bytes: the cap is ${CAPS.screenshots.max_bytes}\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output and compares the bytes.
const dossier = buildDossier(out, { text_max_bytes: CAPS.text_max_bytes, screenshots: CAPS.screenshots, dashboard: CAPS.dashboard });
writeFileSync(join(out, 'dossier.json'), dossier);

const sizes = ['board.json', 'data.js', 'dossier.json'].map((name) => ({ name, bytes: statSync(join(out, name)).size }));
writeFileSync(
  join(out, 'manifest.json'),
  `${JSON.stringify(
    {
      model: radar.model_version,
      snapshot: { path: inputPath, as_of: snapshot.as_of, protocols: snapshot.protocols.length, watchlist: snapshot.watchlist.length },
      board: { rows: board.length, watchlist_rows: radar.watchlist_size, early_rows: radar.early_size },
      comps: { categories: radar.comps.length, peers: radar.global_comps.peers, median: radar.global_comps.multiple },
      dashboard_files: pages,
      screenshots: shots,
      files: sizes,
      caps: CAPS,
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside), ` +
    `${radar.comps.length} categories priced on ${radar.global_comps.peers} live comparables\n` +
    `token radar: wrote board.json, data.js, manifest.json, dossier.json, dashboard/ (${pages.length} files) and screenshots/ (${shots.length} images) to ${out}\n`,
);
