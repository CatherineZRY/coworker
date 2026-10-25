import { z } from "zod";
import {
  AGENT_IDS,
  ARTIFACT_KINDS,
  REVIEW_VERDICTS,
  REVIEWER_TYPES,
  SEVERITIES,
  TASK_STATUSES,
} from "./domain.js";

export const agentIdSchema = z.enum(AGENT_IDS);
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const reviewVerdictSchema = z.enum(REVIEW_VERDICTS);
export const reviewerTypeSchema = z.enum(REVIEWER_TYPES);
export const severitySchema = z.enum(SEVERITIES);
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);

export const createTaskSchema = z.object({
  boardId: z.string().min(1).optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).optional().default(""),
  agent: agentIdSchema.optional(),
  priority: z.number().int().min(0).max(100).optional().default(0),
  labels: z.array(z.string().max(60)).max(20).optional().default([]),
});

export const patchTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  status: taskStatusSchema.optional(),
  priority: z.number().int().min(0).max(100).optional(),
  labels: z.array(z.string().max(60)).max(20).optional(),
});

export const dispatchTaskSchema = z.object({
  boardId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(200_000).optional(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  agent: agentIdSchema,
  repo: z.string().min(1).optional(),
  baseRef: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  timeoutSec: z.number().int().min(10).max(86_400).optional(),
});

export const reviewCommentInputSchema = z.object({
  filePath: z.string().max(1000).optional(),
  lineStart: z.number().int().min(1).optional(),
  lineEnd: z.number().int().min(1).optional(),
  side: z.enum(["old", "new"]).optional(),
  severity: severitySchema.optional().default("major"),
  body: z.string().min(1).max(10_000),
});

export const submitReviewSchema = z.object({
  runId: z.string().min(1),
  verdict: reviewVerdictSchema,
  summary: z.string().max(10_000).optional(),
  comments: z.array(reviewCommentInputSchema).max(200).optional().default([]),
  reviewerType: reviewerTypeSchema.optional().default("codex"),
  reviewerName: z.string().max(200).optional(),
});

export const requestChangesSchema = z.object({
  runId: z.string().min(1),
  comments: z.array(reviewCommentInputSchema).min(1).max(200),
  summary: z.string().max(10_000).optional(),
  agent: agentIdSchema.optional(),
  reviewerType: reviewerTypeSchema.optional().default("codex"),
  reviewerName: z.string().max(200).optional(),
});

export const waitForBoardSchema = z.object({
  boardId: z.string().min(1),
  afterEventId: z.number().int().min(0).optional().default(0),
  timeoutSec: z.number().int().min(1).max(300).optional().default(240),
});

export const createTaskInputSchema = createTaskSchema;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;
export type DispatchTaskInput = z.infer<typeof dispatchTaskSchema>;
export type SubmitReviewSchemaInput = z.infer<typeof submitReviewSchema>;
export type RequestChangesSchemaInput = z.infer<typeof requestChangesSchema>;
export type WaitForBoardInput = z.infer<typeof waitForBoardSchema>;
