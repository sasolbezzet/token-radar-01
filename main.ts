// Token Launch Radar entrypoint (Node 22, standard library + shared dashboard/model.js).
// Reads /input/snapshot.json (or --input <file|dir>), runs the shared RadarModel engine, validates
// every gate invariant, writes /output/board.json and /output/data.js, copies dashboard/ & screenshots/,
// and writes /output/dossier.json via vendor/makefun-board.ts.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL('.', import.meta.url));
process.umask(0o022);
const RadarModel = require('./dashboard/model.js') as {
  buildFromSnapshot: (snap: Snapshot) => RadarResult;
};

interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  tier: string;
  in_watchlist: boolean;
  age_days: number | null;
  tge_p50_usd: number;
  tge_p25_usd: number;
  tge_p75_usd: number;
  p_launch: number;
  implied_value_usd: number;
  capital_usd: number;
  best_chain: string;
  hold_days: number;
  gas_usd: number;
  opp_cost_usd: number;
  hours_total: number;
  gross_airdrop_usd: number;
  net_ev_usd: number;
  usd_per_hour: number;
  net_apy_pct: number;
  verdict: string;
  farm_steps: string[];
}

interface RadarResult {
  universe: { total: number; watchlist: number; pre_early: number; pre_total: number; live: number; excluded: number; comps: number };
  rows: RadarRow[];
}

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEq === undefined ? fallback : withEq.slice(name.length + 3);
}

function validateBoard(rows: RadarRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `row count ${rows.length} outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prevVal = Infinity;
  let allSame = true;
  const firstVal = rows[0]!.implied_value_usd;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!known.has(r.slug)) return `unknown slug ${r.slug}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `rank mismatch at index ${i}: ${r.rank}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `invalid implied_value_usd on ${r.slug}: ${r.implied_value_usd}`;
    }
    if (r.implied_value_usd > prevVal) return `value rose with rank at ${r.slug}`;
    if (r.implied_value_usd !== firstVal) allSame = false;
    prevVal = r.implied_value_usd;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `invalid farm_steps count on ${r.slug}`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `invalid farm_step length (${len}) on ${r.slug}`;
    }
  }
  if (allSame) return 'all implied values identical';
  for (const w of snapshot.watchlist) {
    if (!seen.has(w)) return `missing watchlist slug ${w}`;
  }
  return null;
}

function copyDirFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: missing snapshot at ${inputFile}\n`);
  process.exit(2);
}

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
const t0 = Date.now();
const radar = RadarModel.buildFromSnapshot(snapshot);
const elapsedMs = Date.now() - t0;

const issue = validateBoard(radar.rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: validation failed: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardRows = radar.rows.map((r) => ({
  rank: r.rank,
  slug: r.slug,
  name: r.name,
  category: r.category,
  chains: r.chains,
  tvl_usd: r.tvl_usd,
  change_7d: r.change_7d,
  mcap_usd: r.mcap_usd,
  listed_at: r.listed_at,
  gecko_id: r.gecko_id,
  symbol: r.symbol,
  tier: r.tier,
  in_watchlist: r.in_watchlist,
  age_days: r.age_days,
  tge_p50_usd: r.tge_p50_usd,
  tge_p25_usd: r.tge_p25_usd,
  tge_p75_usd: r.tge_p75_usd,
  p_launch: r.p_launch,
  implied_value_usd: r.implied_value_usd,
  capital_usd: r.capital_usd,
  best_chain: r.best_chain,
  hold_days: r.hold_days,
  gas_usd: r.gas_usd,
  opp_cost_usd: r.opp_cost_usd,
  hours_total: r.hours_total,
  gross_airdrop_usd: r.gross_airdrop_usd,
  net_ev_usd: r.net_ev_usd,
  usd_per_hour: r.usd_per_hour,
  net_apy_pct: r.net_apy_pct,
  verdict: r.verdict,
  farm_steps: r.farm_steps,
}));
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: boardRows })}\n`);

// Browser recomputes directly from window.SNAPSHOT via shared model.js and verifies parity with BOARD_DIGEST.
const boardDigest = radar.rows.map((r) => ({ slug: r.slug, rank: r.rank, implied_value_usd: r.implied_value_usd, net_ev_usd: r.net_ev_usd }));
writeFileSync(
  join(out, 'data.js'),
  `window.SNAPSHOT = ${JSON.stringify(snapshot)};\nwindow.BOARD_DIGEST = ${JSON.stringify(boardDigest)};\n`,
);

const dashFiles = copyDirFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDirFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ must have 3 or 4 images, found ${shots.length}\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: invalid screenshot filename ${name}\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${radar.universe.total} total -> ${radar.universe.watchlist} watchlist + ${radar.universe.pre_early} early (${radar.universe.pre_total} ranked) + ${radar.universe.live} live (${radar.universe.comps} comps) + ${radar.universe.excluded} excluded in ${elapsedMs}ms\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard (${dashFiles.length} files), screenshots (${shots.length} files), and dossier.json\n`,
);
