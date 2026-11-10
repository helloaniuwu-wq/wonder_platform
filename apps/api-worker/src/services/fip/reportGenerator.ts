import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { Env } from "../../types";

export interface ReportData {
  clientName?: string;
  advisorName?: string;
  portfolioName?: string;
  totalNav?: number;
  currency?: string;
  expectedReturn?: number;
  volatility?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  holdings?: { isin: string; name: string; weight: number; sector: string }[];
  mcPercentiles?: { p10: number; p50: number; p90: number; years: number };
}

export async function generateWealthReportDocx(data: ReportData, env: Env): Promise<Uint8Array> {
  const currency = data.currency || "USD";
  const nowStr = new Date().toISOString().slice(0, 10);

  // 1. Optional LLM analysis
  let aiNarrative =
    "本投資組合基於現代資產配置理論構建，綜合考量風險收益比、資產相關性與長期現金流需求。回測顯示在不同的宏觀經濟週期下均展現出良好的韌性。";

  if (env.OPENROUTER_API_KEY || env.DEEPSEEK_API_KEY) {
    try {
      const apiKey = env.DEEPSEEK_API_KEY || env.OPENROUTER_API_KEY;
      const baseUrl = env.DEEPSEEK_API_KEY
        ? env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
        : env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
      const model = env.DEEPSEEK_API_KEY
        ? env.DEEPSEEK_MODEL || "deepseek-chat"
        : env.OPENROUTER_DEEPSEEK_MODEL || "deepseek/deepseek-chat";

      const prompt = `你是頂級私人財富管理投資顧問。請為客戶【${data.clientName || "貴賓客戶"}】的投資組合寫一份簡明專業的配置點評（200字左右）：
預期年化收益: ${data.expectedReturn || 8}%，年化波動率: ${data.volatility || 12}%，夏普比率: ${data.sharpeRatio || 0.6}，最大回撤: ${data.maxDrawdown || 15}%。
請給出核心配置邏輯與長期持有建議。請直接輸出文字。`;

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (resp.ok) {
        const json = await resp.json<any>();
        const content = json.choices?.[0]?.message?.content?.trim();
        if (content) aiNarrative = content;
      }
    } catch (e) {
      console.warn("LLM generation skipped:", e);
    }
  }

  // 2. Build Document
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Title
          new Paragraph({
            text: "WONDER 私人財富管理",
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          }),
          new Paragraph({
            text: "全球資產配置與推演分析報告",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
          }),

          // Metadata Table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "客戶姓名: ", bold: true }), new TextRun(data.clientName || "貴賓客戶")] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "顧問姓名: ", bold: true }), new TextRun(data.advisorName || "WONDER 智庫團隊")] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "基準貨幣: ", bold: true }), new TextRun(currency)] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "報告日期: ", bold: true }), new TextRun(nowStr)] })] }),
                ],
              }),
            ],
          }),

          new Paragraph({ text: "", spacing: { after: 200 } }),

          // Performance Metrics
          new Paragraph({
            text: "一、組合核心風險收益特徵",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "指標名稱", alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ text: "數值", alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ text: "指標意義說明", alignment: AlignmentType.CENTER })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("預期年化回報率")] }),
                  new TableCell({ children: [new Paragraph(`${data.expectedReturn || 0}%`)] }),
                  new TableCell({ children: [new Paragraph("基於歷史數據加權年化收益")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("年化波動率")] }),
                  new TableCell({ children: [new Paragraph(`${data.volatility || 0}%`)] }),
                  new TableCell({ children: [new Paragraph("衡量資產價格波動幅度風險")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("夏普比率 (Sharpe Ratio)")] }),
                  new TableCell({ children: [new Paragraph(`${data.sharpeRatio || 0}`)] }),
                  new TableCell({ children: [new Paragraph("每承受一單位風險獲取的超額回報")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("歷史最大回撤 (Max Drawdown)")] }),
                  new TableCell({ children: [new Paragraph(`${data.maxDrawdown || 0}%`)] }),
                  new TableCell({ children: [new Paragraph("歷史最極端回調幅度")] }),
                ],
              }),
            ],
          }),

          new Paragraph({ text: "", spacing: { after: 200 } }),

          // Holdings
          new Paragraph({
            text: "二、目標資產配置權重",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("代碼 / ISIN")] }),
                  new TableCell({ children: [new Paragraph("資產名稱")] }),
                  new TableCell({ children: [new Paragraph("所屬板塊/類別")] }),
                  new TableCell({ children: [new Paragraph("配置權重 (%)")] }),
                ],
              }),
              ...(data.holdings || []).map(
                (h) =>
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph(h.isin)] }),
                      new TableCell({ children: [new Paragraph(h.name)] }),
                      new TableCell({ children: [new Paragraph(h.sector)] }),
                      new TableCell({ children: [new Paragraph(`${h.weight}%`)] }),
                    ],
                  })
              ),
            ],
          }),

          new Paragraph({ text: "", spacing: { after: 200 } }),

          // AI Narrative
          new Paragraph({
            text: "三、專業顧問點評與配置洞察",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
          }),
          new Paragraph({
            text: aiNarrative,
            spacing: { after: 200 },
          }),

          // Disclaimer
          new Paragraph({
            text: "免責聲明：本報告所載資料僅供參考與探討配置邏輯之用，不構成任何投資建議、邀約或承諾。歷史業績不預示未來回報。",
            spacing: { before: 300 },
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
