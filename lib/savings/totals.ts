// Savings totals (Phase 11, Pass 11A): the cadence-normalising sum, a pure
// helper so listSavings and a direct unit test share one implementation and the
// total can never drift from what the action returns (the same device as the
// templates fill engine).
//
// A workspace records each cancelled subscription as a cost saved (amount_pence,
// integer pence) that recurred either monthly or annually. We normalise the mix
// to a single monthly and annual total. A monthly item counts as itself per
// month and twelve times per year; an annual item counts as a twelfth per month
// and itself per year.
//
// No rounding drift: everything is summed as exact integer pence into the annual
// total first (a monthly item times twelve, an annual item once), so no per-item
// division loses fractional pence. The monthly total is that exact annual total
// divided by twelve and rounded once, to the nearest penny (money is integer
// pence, so the monthly figure of an annual cost is necessarily rounded; the
// annual total stays exact and authoritative). Rounding the aggregate once,
// rather than each item, is what keeps a mix exact: three annual items of 100p
// total 300p a year and 25p a month, not 3 x round(100/12) = 24p.

export type Cadence = "monthly" | "annual";

export type SavingsTotals = {
  monthlyTotalPence: number;
  annualTotalPence: number;
};

export function computeSavingsTotals(
  items: { amount_pence: number; cadence: Cadence }[]
): SavingsTotals {
  let annualTotalPence = 0;
  for (const item of items) {
    annualTotalPence +=
      item.cadence === "annual" ? item.amount_pence : item.amount_pence * 12;
  }
  return {
    annualTotalPence,
    monthlyTotalPence: Math.round(annualTotalPence / 12),
  };
}
