import { eq } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { settings } from "../db/schema.js";

export class SettingsRepository {
  constructor(private readonly ctx: DbContext) {}

  get<T>(key: string, fallback: T): T {
    const row = this.ctx.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return fallback;
    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.ctx.db
      .insert(settings)
      .values({ key, valueJson: JSON.stringify(value) })
      .onConflictDoUpdate({ target: settings.key, set: { valueJson: JSON.stringify(value) } })
      .run();
  }

  all(): Record<string, unknown> {
    const rows = this.ctx.db.select().from(settings).all();
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.valueJson);
      } catch {
        result[row.key] = row.valueJson;
      }
    }
    return result;
  }
}
