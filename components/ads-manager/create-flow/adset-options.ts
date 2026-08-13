// Performance-goal options used to live here as an if-chain on the objective. They now come from
// `lib/odax-matrix.ts`, which the create-campaign route reads too — one table, not two lists that
// can drift apart.

export const COUNTRIES = [
  { name: "Vietnam", code: "VN" },
  { name: "United States", code: "US" },
  { name: "Thailand", code: "TH" },
  { name: "Singapore", code: "SG" },
  { name: "Malaysia", code: "MY" },
  { name: "Indonesia", code: "ID" },
  { name: "Philippines", code: "PH" },
  { name: "Japan", code: "JP" },
  { name: "South Korea", code: "KR" },
  { name: "United Kingdom", code: "GB" },
  { name: "Australia", code: "AU" },
  { name: "Canada", code: "CA" },
  { name: "Germany", code: "DE" },
  { name: "France", code: "FR" },
]

export const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
])
