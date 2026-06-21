// Money display: integer pence to UK pounds, used everywhere money is
// shown. 159970 becomes "£1,599.70".
const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export function formatPence(pence: number) {
  return gbp.format(pence / 100);
}

// Parses a user-entered pounds amount ("149.50", "£1,599.70") into integer
// pence using string maths, never floats. Returns null when the input is
// not a valid non-negative amount with at most two decimal places.
export function poundsToPence(value: string): number | null {
  const trimmed = value.trim().replace(/^£/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [pounds, pence = ""] = trimmed.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0") || "0");
}
