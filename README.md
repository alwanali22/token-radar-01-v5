# Token Radar — radar-5

A token-launch radar for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01):
which pre-token protocols are worth farming next, and what to do about each.

## Model

Implied value = TVL × size multiple × growth × maturity × launch odds × 0.75.

- **Size multiple** — an OLS log-log curve fitted on the snapshot's own 128
  live tokens: log10 multiple = 3.02 − 0.48 × log10 TVL.
- **Growth** — the protocol's 7-day TVL change, as a multiplier.
- **Maturity** — 0.7 + 0.3 × min(1, age in days / 1095).
- **Launch odds** — a logistic model fitted on all 758 protocols
  (age, category, no-listed-date flag). Brier 0.204 vs 0.248 base rate.
- **Range** — implied × 10^(±0.6745 × residual SD); the P25–P75 band holds
  56.9% of newer live tokens in walk-forward testing (miss 2.90× vs 5.33× flat).

Every board row carries six protocol-specific farm steps and farming
economics at a $1,000 deposit over 90 days (10% drop share, 4.5% T-bill,
2.7 h of work, real per-chain gas), with a verdict of FARM, MARGINAL,
THIN or SKIP. The dashboard recomputes every row live in the browser and
shows a what-if panel that reprices a row at any deposit, drop share,
horizon and T-bill rate.

## Run

```sh
bun main.ts --input <kit>/input --output <outdir>
```

Reads `snapshot.json` from the input dir, writes `board.json`, `data.js`,
the `dashboard/` and `screenshots/` folders and `dossier.json` into the
output dir, and prints one summary line (`rows=198 top=steakhouse-financial
implied=27616749 wf2024=2.90 brier=0.2036 holds=56.9 farm=0`).

## License

MIT — see LICENSE.
