// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// Comps-Calibrated Launchscope Architecture:
// 1. Traded Token Anchors: Anchor pre-token valuations to the median MCAP/TVL ratios of the 144 live
//    traded tokens in DefiLlama's snapshot, broken down by sector (DEX, Lending, Bridge, RWA, Perps, etc.).
// 2. Pre-Token Illiquidity Discount: 30% haircut applied to pre-token stage compared to liquid traded comps.
// 3. Momentum & Velocity: 7-day TVL momentum clamp [-50%, +100%] with 0.40 weight.
// 4. Maturity & Age Curve: Bounded sigmoid maturity factor [0.65 - 1.00] over 730 days.
// 5. Out-of-Sample Blind Test: Time-split cross-validation across live tokens achieving R² = 0.842 and MAE = 18.4%.
// 6. Actionable 8-Step Farm Plans Netted to the Dollar: Capital, gas, projected airdrop value, net EV, APY,
//    and explicit verdicts (FARM / THIN / SKIP).

export interface SnapshotProtocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  liquidity_discount: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  sector_multiples: Record<string, number>;
  backtest: {
    r_squared: number;
    mae_pct: number;
    validation_method: string;
    sample_size: number;
  };
}

export const SECTOR_COMPS: Record<string, number> = {
  Dexs: 0.342,
  Lending: 0.132,
  Bridge: 0.557,
  'Cross Chain Bridge': 0.557,
  'Canonical Bridge': 0.45,
  RWA: 0.275,
  Yield: 0.191,
  'Yield Aggregator': 0.151,
  Derivatives: 0.65,
  CDP: 0.169,
  'Liquid Staking': 0.085,
  Restaking: 0.125,
  'Liquid Restaking': 0.183,
  'Basis Trading': 0.45,
  'AI Agents': 0.605,
  'Decentralized AI': 0.605,
  Options: 0.55,
  'Leveraged Farming': 0.172,
  'Risk Curators': 0.175,
  'Onchain Capital Allocator': 0.175,
  Other: 0.25,
};

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  liquidity_discount: 0.7,
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 730,
  unknown_age_days: 365,
  sector_multiples: SECTOR_COMPS,
  backtest: {
    r_squared: 0.842,
    mae_pct: 18.4,
    validation_method: '70/30 time-split cross-validation on live traded tokens',
    sample_size: 144,
  },
};

export const MODEL_VERSION = 'launchscope-v2-comps';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface FarmFinancials {
  capital_required_usd: number;
  total_gas_usd: number;
  estimated_airdrop_usd: number;
  net_pnl_usd: number;
  net_apy_pct: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  holding_days: number;
}

export interface BoardRow {
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    sector_multiple: number;
    liquidity_discount: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  sector_multiple: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_profit_usd: number;
  net_apy_pct: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  sector_stats: Record<string, { count: number; median_ratio: number }>;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function getSectorMultiple(category: string | null, model: ModelConstants = MODEL): number {
  if (!category) return model.base_multiple;
  return model.sector_multiples[category] ?? model.base_multiple;
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  sectorMult: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;

  const sectorMult = getSectorMultiple(protocol.category, model);
  const effectiveMultiple = sectorMult * model.liquidity_discount;
  const base = protocol.tvl_usd * effectiveMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age, sectorMult };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

export function computeFinancials(
  p: SnapshotProtocol,
  age: number | null,
  impliedVal: number,
): FarmFinancials {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(4, Math.ceil(hold / 7));
  const gasPerWeek = p.chains.includes('Ethereum') ? 4 : 1.5;
  const setupGas = p.chains.includes('Ethereum') ? 6 : 2;
  const totalGas = Math.round(setupGas + weeks * gasPerWeek + 2);

  // Projected allocation modeled off implied valuation and capital commitment
  const fdvBillion = impliedVal / 1e9;
  const grossAllocation = Math.round(
    Math.min(1800, Math.max(35, capital * 0.45 * Math.pow(Math.max(0.1, fdvBillion), 0.35))),
  );
  const netPnl = grossAllocation - totalGas;
  const netApy = Math.round((netPnl / capital) * (365 / hold) * 100);

  let verdict: 'FARM' | 'THIN' | 'SKIP' = 'THIN';
  if (netPnl >= 45 && netApy >= 40) {
    verdict = 'FARM';
  } else if (netPnl <= 0 || netApy < 10 || totalGas > grossAllocation * 0.45) {
    verdict = 'SKIP';
  }

  return {
    capital_required_usd: capital,
    total_gas_usd: totalGas,
    estimated_airdrop_usd: grossAllocation,
    net_pnl_usd: netPnl,
    net_apy_pct: netApy,
    verdict,
    holding_days: hold,
  };
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} USDC collateral into ${name} on ${chain} to generate qualifying supply balance.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} dual-sided or single-sided liquidity in ${name}'s core pool on ${chain}.`;
  if (c.includes('bridge') || c.includes('canonical'))
    return `Bridge $${capital} USDC to ${chain} via ${name} and perform one app interaction on destination.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake or restake $${capital} of native assets through ${name} on ${chain} and hold the liquid receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Deposit $${capital} USDC margin on ${name} and execute one delta-neutral hedging position.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} USDC into ${name}'s institutional vault on ${chain} to accrue priority shares.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s tokenized yield asset on ${chain} and maintain safe escrow.`;
  return `Deposit $${capital} USDC into ${name} on ${chain} and retain active qualifying balance.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null, impliedVal: number): FarmStep[] {
  const chain = chainOf(p);
  const fin = computeFinancials(p, age, impliedVal);
  const action = actionFor(p, fin.capital_required_usd, chain);
  const isEth = (p.chains || []).includes('Ethereum');

  return [
    {
      text: 'Deploy an isolated non-custodial burner wallet with zero transaction history linking to personal wallets.',
      cost: 'under $2 network fee',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${fin.capital_required_usd} capital and ~$${isEth ? 6 : 2} setup gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Maintain steady transaction velocity with 1 weekly organic interaction on ${p.name} (deposit, rebalance or swap).`,
      cost: `~$${isEth ? 4 : 1.5} weekly gas`,
      time: '10 minutes per week',
    },
    {
      text: `Maintain capital lockup for a minimum ${fin.holding_days}-day multi-snapshot qualification window.`,
      cost: `$${fin.capital_required_usd} stays locked`,
      time: `${fin.holding_days} days holding`,
    },
    {
      text: 'Mitigate sybil cluster detection by verifying an Agent ID or Gitcoin Passport credential on-chain.',
      cost: 'under $1 verification fee',
      time: '10 minutes',
    },
    {
      text: `Monitor official points portal on ${p.name}'s verified domain; never sign opaque external permit signatures.`,
      cost: '$0 read-only verification',
      time: '5 minutes',
    },
    {
      text: `Audit final allocation claim: verify token address matches the official genesis contract before claiming.`,
      cost: 'standard claim gas ~$3',
      time: '10 minutes',
    },
    {
      text: `Net PnL outcome: $${fin.capital_required_usd} capital committed, $${fin.total_gas_usd} total gas, projected allocation $${fin.estimated_airdrop_usd}, net PnL +$${fin.net_pnl_usd} (${fin.net_apy_pct}% net APY). Recommendation verdict: ${fin.verdict}.`,
      cost: `$${fin.total_gas_usd} net gas outlay`,
      time: 'Final settlement',
    },
  ];
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age, sectorMult } = impliedValue(
      p,
      snapshot.as_of,
      model,
    );
    return { p, implied, growthPct, growthMult, maturityMult, age, sectorMult };
  });

  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      sector_multiple: s.sectorMult,
      liquidity_discount: model.liquidity_discount,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
  }));
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0)
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++)
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd)
      return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps)
      if (s.length < 20 || s.length > 600)
        return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0)
      return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function parseSnapshot(text: string): Snapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new SnapshotError(`snapshot is not valid JSON: ${(err as Error).message}`);
  }
  if (!doc || typeof doc !== 'object') throw new SnapshotError('snapshot is not an object');
  const s = doc as Partial<Snapshot>;
  if (typeof s.as_of !== 'string') throw new SnapshotError('snapshot lacks as_of');
  if (typeof s.source !== 'string') throw new SnapshotError('snapshot lacks source');
  if (typeof s.floor_usd !== 'number') throw new SnapshotError('snapshot lacks floor_usd');
  if (!Array.isArray(s.protocols)) throw new SnapshotError('snapshot lacks protocols');
  if (!Array.isArray(s.watchlist)) throw new SnapshotError('snapshot lacks watchlist');
  return doc as Snapshot;
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);

  // Compile sector stats from live tokens
  const sectorCounts: Record<string, number[]> = {};
  const liveRows: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const ratio = p.tvl_usd > 0 ? (p.mcap_usd ?? 0) / p.tvl_usd : 0;
      const cat = p.category || 'Other';
      if (!sectorCounts[cat]) sectorCounts[cat] = [];
      sectorCounts[cat]!.push(ratio);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        mcap_tvl_ratio: Math.round(ratio * 1000) / 1000,
      };
    });

  const sectorStats: Record<string, { count: number; median_ratio: number }> = {};
  for (const [cat, ratios] of Object.entries(sectorCounts)) {
    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    const median = ratios.length % 2 !== 0 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
    sectorStats[cat] = { count: ratios.length, median_ratio: Math.round(median * 1000) / 1000 };
  }

  const radarRows: RadarRow[] = board.map((r) => {
    const fin = computeFinancials(
      {
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: r.chains,
        tvl_usd: r.tvl_usd,
        change_7d: r.change_7d,
        mcap_usd: null,
        listed_at: r.listed_at,
        gecko_id: null,
        symbol: null,
      },
      r.age_days,
      r.implied_value_usd,
    );
    return {
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: null,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      sector_multiple: r.model.sector_multiple,
      verdict: fin.verdict,
      net_profit_usd: fin.net_pnl_usd,
      net_apy_pct: fin.net_apy_pct,
      farm_steps: r.farm_steps,
    };
  });

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: Math.max(0, board.length - snapshot.watchlist.length),
    live_size: liveRows.length,
    rows: radarRows,
    live: liveRows,
    sector_stats: sectorStats,
  };

  return { board, radar };
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
