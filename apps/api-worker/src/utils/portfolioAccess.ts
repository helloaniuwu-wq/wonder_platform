import { AppContext, HttpError, requireUser } from "./auth";

export async function hasPortfolioAccess(
  db: D1Database,
  user: { id: string; role: string },
  ownerUserId: string | null
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (ownerUserId && ownerUserId === user.id) return true;
  if (user.role === "advisor" && ownerUserId) {
    const link = await db
      .prepare("SELECT 1 FROM advisor_clients WHERE advisor_id = ? AND client_id = ? AND is_active = 1")
      .bind(user.id, ownerUserId)
      .first();
    if (link) return true;
  }
  return false;
}

export async function assertPortfolioRead(c: AppContext, portfolioId: number) {
  const row = await c.env.DB.prepare("SELECT * FROM portfolios WHERE id = ?")
    .bind(portfolioId)
    .first<any>();
  if (!row) throw new HttpError(404, "組合不存在");
  if (Boolean(row.is_public)) return row;

  const user = await requireUser(c);
  if (!(await hasPortfolioAccess(c.env.DB, user, row.user_id ?? null))) {
    throw new HttpError(403, "無權訪問該組合");
  }
  return row;
}

export async function assertPortfolioWrite(
  c: AppContext,
  user: { id: string; role: string },
  portfolioId: number
) {
  const row = await c.env.DB.prepare("SELECT id, user_id FROM portfolios WHERE id = ?")
    .bind(portfolioId)
    .first<{ id: number; user_id: string | null }>();
  if (!row) throw new HttpError(404, "組合不存在");
  if (!(await hasPortfolioAccess(c.env.DB, user, row.user_id ?? null))) {
    throw new HttpError(403, "無權修改該組合");
  }
  return row;
}
