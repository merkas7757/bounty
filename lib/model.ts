// The token radar's model (radar-2): peer-calibrated implied value for pre-token protocols.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart, used as comparables and shown as the market's own
// values, never mixed into the ranked board.
//
// Implied value comes from what the market already pays for the same kind of business:
//
//   comps      = median(mcap_usd / tvl_usd) over the snapshot's live-token protocols in the same
//                category (at least MIN_PEERS of them, each ratio clamped to COMP_FLOOR..COMP_CAP)
//                else the median over every live-token protocol in the snapshot
//   base       = tvl_usd x comps
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.65 + min(age_days, 1095) / 1095 x 0.35   (age_days unknown: 365)
//   breadth    = 1 + (min(chains, 6) - 1) x 0.005           (1.000 .. 1.025)
//   implied    = max(1, round(base x growthMult x maturity x breadth))
//
// The band around each row is the model's own uncertainty: the comps median's interquartile spread,
// widened when few peers back it. No protocol name is ever special-cased: one function scores every
// row, and every figure the dashboard shows can be recomputed from the snapshot.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  comp_floor: number;
  comp_cap: number;
  min_peers: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  comp_floor: 0.02,
  comp_cap: 5,
  min_peers: 3,
  growth_weight: 0.35,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_weight: 0.005,
  breadth_max_chains: 6,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** What the market pays for one category, from the snapshot's own live-token protocols. */
export interface CategoryComp {
  category: string;
  peers: number;
  multiple: number;
  p25: number;
  p75: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    category_multiple: number;
    comps_peers: number;
    comps_label: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with its farm plan. */
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
  implied_low_usd: number;
  implied_high_usd: number;
  category_multiple: number;
  comps_peers: number;
  comps_label: string;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the comps table and the model it runs. */
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
  global_comps: { peers: number; multiple: number; p25: number; p75: number };
  comps: CategoryComp[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The value at `q` of a sorted copy of `xs` (nearest-rank), 0 for an empty list. */
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const at = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
  return s[at]!;
}

/** A protocol's market-cap-to-TVL ratio, when the snapshot records both sides of it. */
function compRatio(p: SnapshotProtocol, model: ModelConstants): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return Math.min(model.comp_cap, Math.max(model.comp_floor, p.mcap_usd / p.tvl_usd));
}

/** The market's own multiple for one category, or the whole snapshot's, from live-token protocols. */
export function compsFor(snapshot: Snapshot, model: ModelConstants = MODEL): {
  by_category: Map<string, CategoryComp>;
  global: { peers: number; multiple: number; p25: number; p75: number };
} {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.category === null || p.category === 'CEX') continue;
    const ratio = compRatio(p, model);
    if (ratio === null) continue;
    all.push(ratio);
    const bucket = byCategory.get(p.category);
    if (bucket === undefined) byCategory.set(p.category, [ratio]);
    else bucket.push(ratio);
  }
  const by_category = new Map<string, CategoryComp>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length < model.min_peers) continue;
    by_category.set(category, {
      category,
      peers: ratios.length,
      multiple: round4(quantile(ratios, 0.5)),
      p25: round4(quantile(ratios, 0.25)),
      p75: round4(quantile(ratios, 0.75)),
    });
  }
  const global = {
    peers: all.length,
    multiple: round4(all.length === 0 ? 0.25 : quantile(all, 0.5)),
    p25: round4(all.length === 0 ? 0.25 : quantile(all, 0.25)),
    p75: round4(all.length === 0 ? 0.25 : quantile(all, 0.75)),
  };
  return { by_category, global };
}

/** The comps table as the dashboard lists it: every category with enough peers, widest sample first. */
export function compsTable(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryComp[] {
  return [...compsFor(snapshot, model).by_category.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
}

/** What one protocol's implied value rests on: the comps, the multipliers and the band around it. */
export interface Scored {
  implied: number;
  low: number;
  high: number;
  categoryMultiple: number;
  compsPeers: number;
  compsLabel: string;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/** The multipliers and the implied value one protocol gets under `model` and `comps`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  comps: { by_category: Map<string, CategoryComp>; global: { peers: number; multiple: number; p25: number; p75: number } },
): Scored {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chains = protocol.chains.length;
  const breadthMult = 1 + Math.max(0, Math.min(chains, model.breadth_max_chains) - 1) * model.breadth_weight;

  const peer = protocol.category === null ? undefined : comps.by_category.get(protocol.category);
  const categoryMultiple = peer === undefined ? comps.global.multiple : peer.multiple;
  const compsPeers = peer === undefined ? comps.global.peers : peer.peers;
  const compsLabel = peer === undefined ? 'snapshot-wide comps' : `${protocol.category} comps`;
  // The band: the comps' own interquartile spread, widened when few peers carry the median.
  const spreadLo = (peer === undefined ? comps.global.p25 : peer.p25) / Math.max(categoryMultiple, 1e-6);
  const spreadHi = (peer === undefined ? comps.global.p75 : peer.p75) / Math.max(categoryMultiple, 1e-6);
  const thin = compsPeers < 6 ? 1.25 : 1;
  const lo = Math.max(0.35, 1 - (1 - Math.min(spreadLo, 0.95)) * thin);
  const hi = Math.min(2.4, 1 + (Math.max(spreadHi, 1.05) - 1) * thin);

  const base = protocol.tvl_usd * categoryMultiple;
  const value = base * growthMult * maturityMult * breadthMult;
  const implied = Math.max(1, Math.round(value));
  return {
    implied,
    low: Math.max(1, Math.round(value * lo)),
    high: Math.max(1, Math.round(value * hi)),
    categoryMultiple,
    compsPeers,
    compsLabel,
    growthPct,
    growthMult,
    maturityMult,
    breadthMult,
    age,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comps = compsFor(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model, comps) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((x, i) => ({
    rank: i + 1,
    slug: x.p.slug,
    name: x.p.name,
    category: x.p.category,
    chains: x.p.chains,
    tvl_usd: x.p.tvl_usd,
    change_7d: x.p.change_7d,
    mcap_usd: x.p.mcap_usd,
    listed_at: x.p.listed_at,
    gecko_id: x.p.gecko_id,
    symbol: x.p.symbol,
    token_status: 'pre-token' as const,
    age_days: x.s.age,
    implied_value_usd: x.s.implied,
    implied_low_usd: x.s.low,
    implied_high_usd: x.s.high,
    model: {
      category_multiple: x.s.categoryMultiple,
      comps_peers: x.s.compsPeers,
      comps_label: x.s.compsLabel,
      growth_pct: x.s.growthPct,
      growth_multiplier: round4(x.s.growthMult),
      maturity_multiplier: round4(x.s.maturityMult),
      breadth_multiplier: round4(x.s.breadthMult),
    },
    farm_steps: farmSteps(x.p, x.s.age, x.s.implied, x.s.low).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A dollar figure the farm plan can quote without decimals: $1.2B, $430M, $12M. */
function usd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age) and the model's own figures for it, never
 * from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number, low: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Size the position against the model's band: the radar prices this protocol's launch at ${usd(low)} to ${usd(implied)}, so $${capital} at risk only pays if the reward clears about $${Math.max(10, Math.round((capital * 2) / 10) * 10)} of value.`,
      cost: `the $${capital} stays in the position, and the band is an estimate, not a promise`,
      time: '10 minutes to decide',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet records activity in more than one epoch.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days and re-check the radar's band whenever the snapshot moves, then unwind if the value falls under the plan's own cost.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then log the wallet, dates and every transaction.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with its farm plan, for the dashboard's own pages. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    category_multiple: row.model.category_multiple,
    comps_peers: row.model.comps_peers,
    comps_label: row.model.comps_label,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const comps = compsFor(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_comps: comps.global,
    comps: compsTable(snapshot, model),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
