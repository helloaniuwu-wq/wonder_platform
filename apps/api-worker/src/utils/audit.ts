export interface AuditLogEntry {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  detail?: Record<string, unknown>;
}

/**
 * 記錄關鍵操作審計日誌（寫入失敗不阻斷主流程）。
 */
export async function writeAuditLog(db: D1Database, entry: AuditLogEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.userId ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId != null ? String(entry.resourceId) : null,
        entry.detail ? JSON.stringify(entry.detail) : null,
        new Date().toISOString()
      )
      .run();
  } catch (err) {
    console.warn("[audit] failed to write audit log:", err);
  }
}
