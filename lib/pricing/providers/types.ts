export type FetchedRate = {
  baseCode: string;
  quoteCode: string;
  rate: string;
  marketTimestamp: Date | null;
  providerName: string;
};

export type RateProvider = {
  key: "exchange_rate" | "crypto_price";
  name: string;
  /** Fetch rates for the requested base codes quoted in quoteCode (usually IRT or USD). */
  fetchRates: (bases: string[], quoteCode: string) => Promise<FetchedRate[]>;
};
