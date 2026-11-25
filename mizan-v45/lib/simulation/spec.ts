/**
 * محاكاة تاريخية (historical simulation) — PRE-REGISTERED SPECIFICATION, version mizan-sim-1.
 * This file is committed and merged BEFORE any runner or result exists. Nothing here may be changed after results are seen;
 * a different rule means a new version (mizan-sim-2) and a new registration, and old results stay under their own version.
 *
 * Purpose: decide, with information available at each decision date only, whether a candidate selection rule beats BOTH the current engine and the
 * matched base rate (the rise rate of all stocks available for picking, same market, same dates, same horizon) before anyone proposes changing the live engine.
 * Results are labelled «محاكاة تاريخية», are stored apart from forecasts the live engine actually issued, and never feed a forecast, score, decision or bot.
 */
import {UNIVERSE,SA_UNIVERSE} from '../integration/backtest';

export const SIM_SPEC_VERSION='mizan-sim-1' as const;
export const SIM_LABEL='محاكاة تاريخية' as const;

export const SIM_SPEC=Object.freeze({
 version:SIM_SPEC_VERSION,
 /** Stocks tested: the universes already declared for the integration test (not chosen after looking at results). */
 universe:{us:UNIVERSE,sa:SA_UNIVERSE},
 horizons:[5,21] as const,
 /** A decision is taken every 5 sessions from the first date with 252 valid closes. Only data dated on or before the decision date is read (point-in-time). */
 decisionEverySessions:5,
 minHistorySessions:252,
 /** Chronological split of decision dates (no shuffling). Thresholds are chosen on development+validation only; the holdout is evaluated once, last. */
 split:{development:0.5,validation:0.25,holdout:0.25},
 /** A purge gap of one horizon is dropped between adjacent periods so no outcome window straddles a boundary. */
 purge:'one horizon between periods',
 /** A pick "succeeds" if the close `horizon` sessions after the decision date is strictly above the decision-date close. Costs and dividends are NOT modelled. */
 successDefinition:'close[t+h] > close[t]',
 /** Arms compared. `engine_current` replays the live forecast model on price history ending at each decision date (no fundamentals, no market index). */
 arms:{
  baseline:'all universe stocks on the date (matched base rate)',
  engine_current:'UP when replayed expected change >= noSignalPct',
  mom126_5:'top fraction by close[t-5]/close[t-131]-1 (daily-picks definition)',
  audit_up:'decision state UP from the numeric audit rules',
  composite:'top fraction by equal-weight cross-sectional rank of: mom126_5, -volatility60 (std of 60 daily returns), close/MA200-1',
 },
 noSignalPct:0.15,
 /** Only these top fractions may be tried for mom126_5 and composite; chosen by highest validation lift, ties go to 0.2. */
 topFractionGrid:[0.1,0.2,0.3] as const,
 defaultTopFraction:0.2,
 /** Verdict rules, fixed in advance. Evaluated on the HOLDOUT only, per market and horizon. */
 criteria:{
  minIndependentDates:20,           // independent dates = decision dates * decisionEverySessions / horizon, rounded down
  minResolvedPicks:100,
  ciLevel:0.95,
  bootstrap:{iterations:1000,blockDates:4,seed:20261125},
  /** Beats baseline: lower CI bound of (hit rate - matched base rate) > 0.
   *  Beats current engine: lower CI bound of (lift_new - lift_engine) > 0 on the same dates (paired date bootstrap). Both required. */
  beatsRule:'lift lower bound > 0 AND paired difference vs engine_current lower bound > 0',
  /** If the sample is below the minimum the verdict is «غير كافٍ»; never a pass. */
  insufficient:'verdict withheld',
 },
 /** Candidate selection may not look at the holdout. A run records the SHA of this spec and which periods were used for each choice. */
 holdoutRule:'evaluated once, after all choices are recorded',
});

export const SIM_SPEC_FINGERPRINT_INPUT=JSON.stringify(SIM_SPEC);
