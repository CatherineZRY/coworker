import { eq } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import type { AgentSessionRow } from "../db/schema.js";
import { agentSessions } from "../db/schema.js";

export interface SessionUpsertInput {
  ppid: number;
  codexThreadId?: string | null;
  sessionId?: string | null;
  cwd?: string | null;
}

export class SessionRepository {
  constructor(private readonly ctx: DbContext) {}

  upsert(input: SessionUpsertInput): void {
    this.ctx.db
      .insert(agentSessions)
      .values({
        ppid: input.ppid,
        codexThreadId: input.codexThreadId ?? null,
        sessionId: input.sessionId ?? null,
        cwd: input.cwd ?? null,
        lastSeenAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: agentSessions.ppid,
        set: {
          codexThreadId: input.codexThreadId ?? null,
          sessionId: input.sessionId ?? null,
          cwd: input.cwd ?? null,
          lastSeenAt: Date.now(),
        },
      })
      .run();
  }

  get(ppid: number): AgentSessionRow | null {
    return (
      this.ctx.db.select().from(agentSessions).where(eq(agentSessions.ppid, ppid)).get() ?? null
    );
  }
}
