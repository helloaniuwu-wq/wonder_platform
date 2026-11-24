import { describe, expect, it } from "vitest";
import { computeTwrSeries } from "./portfolioMonitor";
import { buildAiaSwitchOrder, buildBrokerEtfOrder, normalizeWrapperPercentages } from "./rebalanceEngine";

describe("computeTwrSeries (Time-Weighted Return drawdown)", () => {
  it("strips external CASH_IN and CASH_OUT flows so deposits/withdrawals never trigger false drawdowns", () => {
    const txs = [
      { date: "2026-01-01", isin: "CASH_USD", type: "CASH_IN", shares: 1, price: 100000 },
      { date: "2026-02-01", isin: "CASH_USD", type: "CASH_IN", shares: 1, price: 50000 },
      { date: "2026-03-01", isin: "CASH_USD", type: "CASH_OUT", shares: 1, price: -40000 },
    ];
    // Market asset grows +10% in Jan (100k -> 110k), +50k deposit in Feb + flat (160k), -40k withdrawal in Mar + +5% (126k)
    const hist = [
      { date: "2026-01-01", value: 100000 },
      { date: "2026-01-31", value: 110000 },
      { date: "2026-02-28", value: 160000 },
      { date: "2026-03-31", value: 126000 },
    ];

    const res = computeTwrSeries(txs, hist);
    expect(res.currentDrawdown).toBe(0);
    expect(res.maxDrawdown).toBe(0);
    expect(res.latestTwrNav).toBeCloseTo(114.125, 3);
  });

  it("captures genuine market drawdown accurately", () => {
    const txs = [{ date: "2026-01-01", isin: "CASH_USD", type: "CASH_IN", shares: 1, price: 100000 }];
    const hist = [
      { date: "2026-01-01", value: 100000 },
      { date: "2026-02-01", value: 120000 },
      { date: "2026-03-01", value: 96000 }, // -20% from peak 120k
    ];

    const res = computeTwrSeries(txs, hist);
    expect(res.currentDrawdown).toBeCloseTo(-0.2, 4);
    expect(res.maxDrawdown).toBeCloseTo(-0.2, 4);
  });
});

describe("buildAiaSwitchOrder (AIA TMP2 5% rule & 0 fee)", () => {
  it("folds sub-5% holdings and enforces 100% sum with 0 switching fee", () => {
    const norm = normalizeWrapperPercentages({ F51: 50, F02: 47, T01: 3 }, 5);
    expect(norm.T01).toBeUndefined();
    expect(norm.F51 + norm.F02).toBe(100);
    expect(norm.F51).toBeGreaterThanOrEqual(5);
    expect(norm.F02).toBeGreaterThanOrEqual(5);

    const order = buildAiaSwitchOrder(
      [
        { isin: "F51", name: "AIA Fidelity Global", market_value: 70000, price: 20 },
        { isin: "F02", name: "AIA JPM Bond", market_value: 30000, price: 10 },
      ],
      { F51: 45, F02: 45, GLD_AIA: 10 },
      100000,
      "USD"
    );
    expect(order.switching_fee).toBe(0);
    const totalPct = Object.values(order.target_allocations_pct).reduce((s, v) => s + v, 0);
    expect(totalPct).toBe(100);
    expect(order.legs[0].action).toBe("SWITCH_OUT");
    expect(order.legs.some((l) => l.isin === "GLD_AIA" && l.action === "SWITCH_IN")).toBe(true);
  });
});

describe("buildBrokerEtfOrder (Cash-first SELL then BUY & HK lot size)", () => {
  it("executes SELL orders before BUY orders, keeps cash buffer, and floors HK ETFs to 100-share lots", () => {
    const order = buildBrokerEtfOrder(
      [
        { isin: "SPY", name: "SPDR S&P 500", shares: 100, market_value: 60000 },
        { isin: "2800.HK", name: "Tracker Fund", shares: 1000, market_value: 2560 },
      ],
      { SPY: 50, "2800.HK": 30, GLD: 20 },
      2000,
      64560,
      "USD",
      { SPY: 600, "2800.HK": 20, GLD: 250 },
      { SPY: "USD", "2800.HK": "HKD", GLD: "USD" },
      { SPY: 1, "2800.HK": 0.128, GLD: 1 },
      { cashBufferPct: 0.015 }
    );

    expect(order.trades.length).toBeGreaterThan(0);
    expect(order.trades[0].action).toBe("SELL");
    const hkTrade = order.trades.find((t) => t.isin === "2800.HK");
    expect(hkTrade).toBeDefined();
    expect(hkTrade!.shares % 100).toBe(0);
    expect(order.cash_buffer_reserved_base).toBeCloseTo(64560 * 0.015, 1);
    expect(order.estimated_remaining_cash_base).toBeGreaterThanOrEqual(order.cash_buffer_reserved_base - 1);
  });
});
