import { describe, expect, it } from "vitest";
import { parseTopHoldingsText, parseYahooTopHoldings } from "./fundHoldings";

describe("fundHoldings parsers", () => {
  it("parses Yahoo Finance topHoldings payload", () => {
    const payload = {
      quoteSummary: {
        result: [
          {
            topHoldings: {
              holdings: [
                { symbol: "AAPL", holdingName: "Apple Inc", holdingPercent: { raw: 0.0712 } },
                { symbol: "MSFT", holdingName: "Microsoft Corp", holdingPercent: { raw: 0.0655 } },
              ],
            },
          },
        ],
      },
    };
    const res = parseYahooTopHoldings(payload);
    expect(res).not.toBeNull();
    expect(res?.source).toBe("Yahoo Finance");
    expect(res?.holdings).toEqual([
      { name: "Apple Inc", symbol: "AAPL", weight_pct: 7.12 },
      { name: "Microsoft Corp", symbol: "MSFT", weight_pct: 6.55 },
    ]);
    expect(res?.top10_total_pct).toBeCloseTo(13.67, 2);
  });

  it("parses slash-delimited top holdings text from vault commentary", () => {
    const text = "騰訊 9.5% / 阿里 6.5% / 建行 4.6%（前十大占 20.6%）";
    const items = parseTopHoldingsText(text);
    expect(items).toEqual([
      { name: "騰訊", weight_pct: 9.5 },
      { name: "阿里", weight_pct: 6.5 },
      { name: "建行", weight_pct: 4.6 },
    ]);
  });
});
