import type { Artifact, ArtifactKind } from "@coworker/shared";
import { asc, eq } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { artifactFromRow } from "../db/mappers.js";
import { artifacts } from "../db/schema.js";
import { newId } from "../domain/ids.js";

export interface CreateArtifactRecord {
  runId: string;
  kind: ArtifactKind;
  name: string;
  path: string;
  mime?: string | null;
  sizeBytes?: number | null;
}

export class ArtifactRepository {
  constructor(private readonly ctx: DbContext) {}

  create(input: CreateArtifactRecord): Artifact {
    const id = newId("art");
    this.ctx.db
      .insert(artifacts)
      .values({
        id,
        runId: input.runId,
        kind: input.kind,
        name: input.name,
        path: input.path,
        mime: input.mime ?? null,
        sizeBytes: input.sizeBytes ?? null,
        createdAt: Date.now(),
      })
      .run();
    const row = this.ctx.db.select().from(artifacts).where(eq(artifacts.id, id)).get();
    if (!row) throw new Error("Artifact disappeared after creation");
    return artifactFromRow(row);
  }

  listByRun(runId: string): Artifact[] {
    return this.ctx.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.runId, runId))
      .orderBy(asc(artifacts.createdAt))
      .all()
      .map(artifactFromRow);
  }
}
