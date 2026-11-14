// Token launch radar — value model (lib/model.ts).
//
// Implied value is derived from the snapshot's own figures only, never from a
// hand-kept list of protocol names. The same function scores every row.
//
//   multiple(cat) = median(mcap_usd / tvl_usd) over the snapshot's TOKEN-BEARING
//                   protocols in that category (needs >= 2 samples), else the
//                   global median over all token-bearing protocols, clamped to
//                   [0.03, 1.50]. Calibrated at run time from the sealed input.
//   growth  = clamp(change_7d, -60, +120) %  ->  growthMult = 1 + growth/100 * 0.5
//   maturity = 0.70 + min(age_days, 1460) / 1460 * 0.50   (age unknown -> 365d)
//   implied = max(1, round(tvl_usd * multiple(cat) * growthMult * maturity))
//
// A protocol is pre-token when its record carries no token (mcap, gecko_id and
// symbol all null). Rankable = pre-token AND not CEX, Bridge, Canonical Bridge,
// Liquid Staking, Liquid Restaking or Restaked BTC, AND not a versioned name,
// AND no whole word wrapped/staked/staking in its name, AND not starting with
// an exchange name. The board ranks EVERY rankable protocol (watchlist + the
// early ones below the floor). Live-token protocols are kept apart: the
// dashboard shows them in a separate "Already launched" view at their market
// value, never mixed into the ranked board.

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number; growth_floor: number; growth_cap: number;
  maturity_floor: number; maturity_range: number; maturity_days: number;
  unknown_age_days: number; multiple_min: number; multiple_max: number;
  min_category_samples: number;
}
export const MODEL: ModelConstants = {
  growth_weight: 0.5, growth_floor: -60, growth_cap: 120,
  maturity_floor: 0.7, maturity_range: 0.5, maturity_days: 1460,
  unknown_age_days: 365, multiple_min: 0.03, multiple_max: 1.5,
  min_category_samples: 2,
};
export const MODEL_VERSION = 'radar-2-calibrated';
export const LIVE_ROWS = 12;

export interface FarmStep { text: string; cost: string; time: string; }
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null;
  implied_value_usd: number;
  model: { multiple: number; growth_pct: number; growth_multiplier: number;
    maturity_multiplier: number; age_days: number | null; };
  farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  listed_at: string | null; age_days: number | null;
  implied_value_usd: number; growth_multiplier: number; maturity_multiplier: number;
}
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}
export interface RadarData {
  as_of: string; floor_usd: number; model: ModelConstants; model_version: string;
  watchlist_size: number; board_size: number; early_size: number; live_size: number;
  multiples: Record<string, number>; global_multiple: number;
  watchlist: string[];
  rows: RadarRow[]; live: LiveRow[];
}
export class SnapshotError extends Error {
  constructor(m: string) { super(m); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
function finite(v: unknown, fb: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fb;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Calibrate FDV/TVL multiples from the snapshot's own token-bearing protocols. */
export function calibrateMultiples(snapshot: Snapshot, model: ModelConstants = MODEL):
    { multiples: Record<string, number>; global: number } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0) continue;
    all.push(r);
    const k = p.category ?? '(none)';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(r);
  }
  const global = clamp(median(all), model.multiple_min, model.multiple_max);
  const multiples: Record<string, number> = {};
  for (const [k, v] of byCat) {
    if (v.length >= model.min_category_samples) {
      multiples[k] = clamp(median(v), model.multiple_min, model.multiple_max);
    }
  }
  return { multiples, global };
}

export function impliedValue(p: SnapshotProtocol, asOf: string, multiple: number,
    model: ModelConstants = MODEL): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageFor = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor +
    (Math.min(Math.max(ageFor, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !EXCLUDED_CATS.has(p.category ?? '') &&
    !VERSIONED.test(p.name) && !WRAPPED_WORD.test(p.name) && !EXCHANGE_PREFIX.test(p.name);
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page.`;
  return s;
}
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
/** The category's main farming action, parameterized by capital and chain. */
export function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${n} on ${chain} as a lender and keep the deposit open`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${n}'s largest pool on ${chain} and keep the LP position open`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} through ${n}, then use the bridged funds inside its app`;
  if (c.includes('stak') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${n} and keep the receipt token`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small hedged position`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${n} and place one position in an active market, then hold it to settlement`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${n} vault on ${chain} and hold the vault shares`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it for yield`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active`;
  if (c.includes('liquid'))
    return `Deposit $${capital} of the liquid asset into ${n} on ${chain} and keep the position open`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open`;
}
/** Six concrete farm steps, parameterized by category, chain, TVL and age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const second = p.chains.length > 1 ? p.chains[1]! : chain;
  return [
    { text: `Set up a fresh wallet holding only the $${capital} you plan to farm with, and store its seed phrase offline, never in a screenshot or chat`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: `Repeat one qualifying action each week on ${chain} — a deposit, a swap, a borrow or a vote — and do at least one of them on ${second} too if the app supports it`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window`, cost: `the $${capital} stays locked in the position`, time: `${hold} days` },
    { text: `Each month, open ${p.name}'s own points or rewards page from the link the protocol itself publishes and record your points balance`, cost: 'no fee to check; never pay to claim', time: '10 minutes a month' },
    { text: `Keep a farm log with the wallet address, the deposit dates and every transaction hash, so you can repeat the position or unwind it cleanly`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { multiples, global } = calibrateMultiples(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Early radar: every other rankable pre-token protocol, not just the top by TVL.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const mult = multiples[p.category ?? '(none)'] ?? global;
    const v = impliedValue(p, snapshot.as_of, mult, model);
    return { p, mult, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category,
    chains: s.p.chains, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at, gecko_id: s.p.gecko_id,
    symbol: s.p.symbol, token_status: 'pre-token' as const, age_days: s.age,
    implied_value_usd: s.implied,
    model: { multiple: round4(s.mult), growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult), maturity_multiplier: round4(s.maturityMult), age_days: s.age },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function radarRow(row: BoardRow): RadarRow {
  return { rank: row.rank, slug: row.slug, name: row.name, category: row.category,
    chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d,
    listed_at: row.listed_at, age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL):
    { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const { multiples, global } = calibrateMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, model,
    model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: early, live_size: live.length,
    multiples, global_multiple: round4(global),
    watchlist: [...snapshot.watchlist],
    rows: board.map(radarRow), live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
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
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd))
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name,
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd)
    return `all ${board.length} rows share the same implied value`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** Compact data.js: rows as arrays, one line, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  const rows = radar.rows.map((r) => [r.rank, r.slug, r.name, r.category, r.chains,
    r.tvl_usd, r.change_7d, r.age_days, r.implied_value_usd, r.growth_multiplier, r.maturity_multiplier]);
  const live = radar.live.map((l) => [l.slug, l.name, l.category, l.chains, l.tvl_usd, l.mcap_usd, l.change_7d]);
  const slim = { a: radar.as_of, f: radar.floor_usd, v: radar.model_version,
    w: radar.watchlist_size, n: radar.board_size, e: radar.early_size,
    g: radar.global_multiple, m: radar.multiples, wl: radar.watchlist, rows, live };
  return `window.RADAR=${JSON.stringify(slim)};\n`;
}
