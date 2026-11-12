import { NextRequest, NextResponse } from "next/server"

const MIDDLE_EAST = ["AE","SA","QA","KW","BH","OM","JO","EG","LB","IQ","YE","SY","LY","TN","MA","DZ"]
const CHINESE = ["CN","HK","MO","TW"]

export async function GET(req: NextRequest) {
  const country =
    req.headers.get("cf-ipcountry") ||
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("x-country") ||
    ""

  let lang: "zh" | "en" | "ar" = "en"
  if (CHINESE.includes(country.toUpperCase())) lang = "zh"
  else if (MIDDLE_EAST.includes(country.toUpperCase())) lang = "ar"

  return NextResponse.json({ lang, country })
}
