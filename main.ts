// Token Radar v4 ("radar-5") — entrypoint.
// Reads the frozen DefiLlama snapshot, fits the size curve + launch-odds
// model on it, ranks the protocols worth farming next, and writes the board,
// the dashboard data, the dashboard files and the dossier.
//
// Model (all fitted live from the snapshot, nothing hand-kept):
//   implied = TVL x sizeMultiple x growth x maturity x launchOdds x 0.75
//   sizeMultiple from an OLS log-log curve fitted on the 128 live tokens
//   launchOdds from a logistic model fitted on all 758 protocols
//   range = implied x 10^(+/-0.6745 x residual SD)
// Farm economics come from the model library per row (deposit $1,000,
// 90 days, 10% drop share, 4.5% T-bill, 2.7 h of work, real per-chain gas).
//
// NOTE on the model library: its valueIfLaunches / calculateImpliedValue
// helpers return placeholder 1s, so the implied value is composed here
// from the working primitives (sizeMultiple, growthMultiplier,
// maturityMultiplier, oddsOf). The composition was verified to reproduce
// the browser library's impliedDetail exactly on all 198 board rows.

import { readFileSync, mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ageDays,
  fitSizeCurve,
  sizeMultiple,
  growthMultiplier,
  maturityMultiplier,
  fitOddsModel,
  oddsOf,
  residualSd,
  rankable,
  ledgerPartition,
  FEE_USD_PER_TX,
  farmEconomics,
  generateFarmSteps,
  backtestValue,
  backtestOdds,
  bootstrapSlope,
} from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

interface Protocol {
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

interface Row {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  rank: number;
  implied_value_usd: number;
  size_multiple: number;
  growth_mult: number;
  maturity_mult: number;
  odds: number;
  value_if_launches: number;
  range_lo: number;
  range_hi: number;
  verdict: string;
  net_usd: number;
  net_per_hour: number;
  gas_usd: number;
  farm_steps: string[];
}

function fail(message: string): never {
  console.error("token-radar: " + message);
  process.exit(1);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// FNV-1a 32-bit, hex, 8 chars.
function fnv1aHex(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "/input";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[++i];
    else if (argv[i] === "--output" && i + 1 < argv.length) output = argv[++i];
    else if (argv[i].startsWith("--input=")) input = argv[i].slice("--input=".length);
    else if (argv[i].startsWith("--output=")) output = argv[i].slice("--output=".length);
    else fail("unknown argument: " + argv[i]);
  }
  if (!input.endsWith("snapshot.json")) input = join(input, "snapshot.json");
  return { input, output };
}

const here = dirname(fileURLToPath(import.meta.url));
const { input, output } = parseArgs(process.argv.slice(2));

let raw: string;
try {
  raw = readFileSync(input, "utf8");
} catch {
  fail("cannot read snapshot: " + input);
}
let snapshot: unknown;
try {
  snapshot = JSON.parse(raw!);
} catch {
  fail("snapshot is not valid JSON: " + input);
}
const snap = snapshot as { protocols?: unknown; watchlist?: unknown; as_of?: unknown };
if (!Array.isArray(snap.protocols)) fail("snapshot.protocols is not an array");
if (!Array.isArray(snap.watchlist)) fail("snapshot.watchlist is not an array");
if (typeof snap.as_of !== "string") fail("snapshot.as_of is not a string");
const asOf = snap.as_of as string;
const protocols = snap.protocols as Protocol[];
const watchlist = snap.watchlist as string[];
for (const p of protocols) {
  if (typeof p !== "object" || p === null) fail("protocol is not an object");
  if (typeof p.slug !== "string") fail("protocol without a string slug");
  if (typeof p.name !== "string") fail("protocol " + p.slug + " without a string name");
  if (!(typeof p.category === "string" || p.category === null))
    fail("protocol " + p.slug + ": category is neither a string nor null");
  if (!Array.isArray(p.chains)) fail("protocol " + p.slug + ": chains is not an array");
  if (typeof p.tvl_usd !== "number" || !Number.isFinite(p.tvl_usd))
    fail("protocol " + p.slug + ": tvl_usd is not a finite number");
}

// --- fit the models on the snapshot itself ---
const live = protocols.filter(
  (p) => typeof p.mcap_usd === "number" && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 && p.tvl_usd > 0,
);
const curve = fitSizeCurve(live);
const oddsModel = fitOddsModel(protocols, asOf);
const residSd = residualSd(live, curve, asOf);
const valueBt = backtestValue(live, asOf);
const oddsBt = backtestOdds(protocols, asOf);
const boot = bootstrapSlope(live);
const ledger = ledgerPartition(protocols);

// --- build the board ---
const watchSet = new Set(watchlist);
const rows: Row[] = [];
for (const p of protocols) {
  if (!rankable(p)) continue;
  const age = ageDays(asOf, p.listed_at);
  const mult = sizeMultiple(p.tvl_usd, curve);
  const growth = growthMultiplier(p.change_7d);
  const mat = maturityMultiplier(age);
  const vil = p.tvl_usd * mult * growth * mat;
  const odds = oddsOf(p, oddsModel, asOf);
  const implied = Math.round(vil * odds * 0.75);
  const rangeLo = Math.round(implied * Math.pow(10, -0.6745 * residSd));
  const rangeHi = Math.round(implied * Math.pow(10, 0.6745 * residSd));
  const econ = farmEconomics(p, implied) as {
    verdict: string;
    netUsd: number;
    netPerHour: number;
    gasUsd: number;
  };
  const steps = generateFarmSteps(p, econ) as string[];
  rows.push({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: age,
    watchlist: watchSet.has(p.slug),
    rank: 0,
    implied_value_usd: implied,
    size_multiple: mult,
    growth_mult: growth,
    maturity_mult: mat,
    odds: odds,
    value_if_launches: Math.round(vil),
    range_lo: rangeLo,
    range_hi: rangeHi,
    verdict: econ.verdict,
    net_usd: round2(econ.netUsd),
    net_per_hour: round2(econ.netPerHour),
    gas_usd: round2(econ.gasUsd),
    farm_steps: steps,
  });
}
rows.sort((a, b) => (b.implied_value_usd - a.implied_value_usd) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
rows.forEach((r, i) => {
  r.rank = i + 1;
});

// --- gates: fail loudly rather than hand in a broken board ---
if (rows.length < 100) fail("only " + rows.length + " board rows, need at least 100");
if (watchlist.length !== 40) fail("watchlist has " + watchlist.length + " slugs, need exactly 40");
for (const slug of watchlist) {
  if (!rows.some((r) => r.slug === slug)) fail("watchlist slug missing from the board: " + slug);
}
for (let i = 0; i < rows.length; i++) {
  if (rows[i].rank !== i + 1) fail("ranks are not sequential at position " + i);
  if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd)
    fail("implied value rises down the board at " + rows[i].slug);
  if (rows[i].farm_steps.length !== 6) fail("row " + rows[i].slug + " has " + rows[i].farm_steps.length + " farm steps, need 6");
  for (const s of rows[i].farm_steps) {
    if (typeof s !== "string" || s.length < 20 || s.length > 600)
      fail("row " + rows[i].slug + " has a farm step outside 20-600 chars");
  }
  if (!(rows[i].odds >= 0.001 && rows[i].odds <= 0.999))
    fail("row " + rows[i].slug + " has launch odds outside [0.001, 0.999]");
  if (!(rows[i].range_lo >= 1)) fail("row " + rows[i].slug + " has range_lo below 1");
  if (!(rows[i].range_hi > rows[i].range_lo)) fail("row " + rows[i].slug + " has range_hi <= range_lo");
  if (!["FARM", "MARGINAL", "THIN", "SKIP"].includes(rows[i].verdict))
    fail("row " + rows[i].slug + " has an unknown verdict: " + rows[i].verdict);
  for (const k of ["net_usd", "net_per_hour", "gas_usd"] as const) {
    if (typeof rows[i][k] !== "number" || !Number.isFinite(rows[i][k]))
      fail("row " + rows[i].slug + " has a non-finite " + k);
  }
}
const seen = new Set<string>();
for (const r of rows) {
  if (seen.has(r.slug)) fail("duplicate slug on the board: " + r.slug);
  seen.add(r.slug);
}
const setAsideTotal = (ledger.setAside as { count: number }[]).reduce((s, g) => s + g.count, 0);
if ((ledger as { ranked: number }).ranked + (ledger as { tokenTrades: number }).tokenTrades + setAsideTotal !== protocols.length)
  fail("ledger does not sum to the protocol count");
const liveSorted = [...live].sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number));
const liveTop = liveSorted.slice(0, 24);
if (liveTop.length !== 24) fail("live list has " + liveTop.length + " entries, need exactly 24");

// --- counts ---
const excluded = protocols.filter(
  (p) => p.mcap_usd == null && p.gecko_id == null && p.symbol == null && !rankable(p),
).length;
const verdictCounts: Record<string, number> = { FARM: 0, MARGINAL: 0, THIN: 0, SKIP: 0 };
for (const r of rows) verdictCounts[r.verdict]++;
const top250 = rows.slice(0, 250);
const checksum = fnv1aHex(JSON.stringify(top250));

const radar = {
  rows: top250,
  live: liveTop.map((p) => ({
    slug: p.slug,
    name: p.name,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    category: p.category,
  })),
  liveAll: liveSorted.map((p) => ({
    slug: p.slug,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    category: p.category,
  })),
  model: {
    as_of: asOf,
    checksum,
    formula:
      "implied = TVL x size multiple x growth x maturity x launch odds x 0.75; " +
      "range = implied x 10^(+/-0.6745 x residual SD)",
    curve: {
      intercept: (curve as { intercept: number }).intercept,
      slope: (curve as { slope: number }).slope,
      n: (curve as { n: number }).n,
      clampMin: (curve as { clampMin: number }).clampMin,
      clampMax: (curve as { clampMax: number }).clampMax,
    },
    odds: {
      weights: (oddsModel as { weights: number[] }).weights,
      bias: (oddsModel as { bias: number }).bias,
      means: (oddsModel as { means: number[] }).means,
      sds: (oddsModel as { sds: number[] }).sds,
      baseRate: (oddsModel as { baseRate: number }).baseRate,
      medianAge: (oddsModel as { medianAge: number }).medianAge,
      cvBrier: (oddsBt as { cvBrier: number }).cvBrier,
      holdoutBrier: (oddsBt as { holdoutBrier: number }).holdoutBrier,
      baseBrier: (oddsBt as { baseBrier: number }).baseBrier,
      ablations: (oddsBt as { ablations: Record<string, number> }).ablations,
    },
    residualSd: residSd,
    backtest: { value: valueBt, odds: oddsBt, bootstrap: boot },
    ledger,
    farmAssumptions: {
      depositUsd: 1000,
      horizonDays: 90,
      dropShare: 0.1,
      tbillRate: 0.045,
      hoursPerFarm: 2.7,
      feeUsdPerTx: { ...FEE_USD_PER_TX, default: 0.5, bridge: 2.0 },
    },
    verdictCounts,
  },
  counts: {
    total: protocols.length,
    watchlist: watchlist.length,
    board: rows.length,
    early: rows.filter((r) => !r.watchlist).length,
    live: liveTop.length,
    excluded,
  },
};

// --- outputs ---
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "board.json"), JSON.stringify({ rows: top250 }, null, 2) + "\n");
writeFileSync(join(output, "data.js"), "window.RADAR = " + JSON.stringify(radar) + ";\n");
const skipDotfiles = (src: string) => !/(^|\/)\./.test(src.slice(here.length + 1));
cpSync(join(here, "dashboard"), join(output, "dashboard"), { recursive: true, filter: skipDotfiles });
const shots = join(here, "screenshots");
if (existsSync(shots)) {
  cpSync(shots, join(output, "screenshots"), { recursive: true, filter: skipDotfiles });
}
const dossierBytes = buildDossier(resolve(output), { text_max_bytes: 65536 });
writeFileSync(join(output, "dossier.json"), dossierBytes);

const wf0 = (valueBt as { walkForward: { miss: number; holdsPct: number }[] }).walkForward[0];
console.log(
  "rows=" + rows.length +
  " top=" + rows[0].slug +
  " implied=" + rows[0].implied_value_usd +
  " wf2024=" + wf0.miss.toFixed(2) +
  " brier=" + (oddsBt as { cvBrier: number }).cvBrier.toFixed(4) +
  " holds=" + wf0.holdsPct.toFixed(1) +
  " farm=" + verdictCounts.FARM,
);
