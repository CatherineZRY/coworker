import type { Review, ReviewCommentInput, ReviewerType, ReviewVerdict } from "@coworker/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { reviewFromRow } from "../db/mappers.js";
import { reviewComments, reviews } from "../db/schema.js";
import { newId } from "../domain/ids.js";

export interface CreateReviewRecord {
  runId: string;
  reviewerType: ReviewerType;
  reviewerName?: string | null;
  verdict: ReviewVerdict;
  summary?: string | null;
  comments?: ReviewCommentInput[];
}

export class ReviewRepository {
  constructor(private readonly ctx: DbContext) {}

  create(input: CreateReviewRecord): Review {
    const id = newId("rev");
    const now = Date.now();
    const comments = input.comments ?? [];

    this.ctx.db.transaction((tx) => {
      tx.insert(reviews)
        .values({
          id,
          runId: input.runId,
          reviewerType: input.reviewerType,
          reviewerName: input.reviewerName ?? null,
          verdict: input.verdict,
          summary: input.summary ?? null,
          createdAt: now,
        })
        .run();
      for (const comment of comments) {
        tx.insert(reviewComments)
          .values({
            id: newId("cmt"),
            reviewId: id,
            filePath: comment.filePath ?? null,
            lineStart: comment.lineStart ?? null,
            lineEnd: comment.lineEnd ?? null,
            side: comment.side ?? null,
            severity: comment.severity ?? "major",
            body: comment.body,
            resolved: false,
            createdAt: now,
          })
          .run();
      }
    });

    const review = this.get(id);
    if (!review) throw new Error("Review disappeared after creation");
    return review;
  }

  get(id: string): Review | null {
    const row = this.ctx.db.select().from(reviews).where(eq(reviews.id, id)).get();
    if (!row) return null;
    const comments = this.ctx.db
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.reviewId, id))
      .orderBy(asc(reviewComments.createdAt))
      .all();
    return reviewFromRow(row, comments);
  }

  listByRun(runId: string): Review[] {
    const rows = this.ctx.db
      .select()
      .from(reviews)
      .where(eq(reviews.runId, runId))
      .orderBy(asc(reviews.createdAt))
      .all();
    if (rows.length === 0) return [];
    const comments = this.ctx.db
      .select()
      .from(reviewComments)
      .where(
        inArray(
          reviewComments.reviewId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(reviewComments.createdAt))
      .all();

    return rows.map((row) =>
      reviewFromRow(
        row,
        comments.filter((comment) => comment.reviewId === row.id),
      ),
    );
  }

  setCommentResolved(commentId: string, resolved: boolean): void {
    this.ctx.db
      .update(reviewComments)
      .set({ resolved })
      .where(eq(reviewComments.id, commentId))
      .run();
  }

  /** Approval means the feedback on earlier attempts has been addressed. */
  resolveForTask(taskId: string): void {
    this.ctx.sqlite
      .prepare(
        `UPDATE review_comments SET resolved = 1
         WHERE resolved = 0 AND review_id IN (
           SELECT rv.id FROM reviews rv JOIN runs r ON r.id = rv.run_id WHERE r.task_id = ?
         )`,
      )
      .run(taskId);
  }
}
