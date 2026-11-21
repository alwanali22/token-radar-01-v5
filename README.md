# Token Radar 01

Ranks pre-token protocols by model-implied value using a size-fitted multiple, growth, and maturity.

## Model

`implied_value_usd = round(TVL * sizeMultiple(TVL) * 0.75 * growthMult * maturityMult)`

The size curve is fitted from the snapshot's own live tokens: n=128, slope -0.48, corr -0.41. Five-fold backtest median error is 0.56 in log10 versus 0.72 for a flat median multiple.

## Run

