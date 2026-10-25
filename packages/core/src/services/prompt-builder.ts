import type { ReviewComment, Task } from "@coworker/shared";

export interface PromptContext {
  task: Task;
  reviewComments?: ReviewComment[];
  previousSummary?: string | null;
  repoPath?: string | null;
  baseRef?: string | null;
}

export function buildTaskPrompt(context: PromptContext): string {
  const { task, reviewComments = [] } = context;
  const lines: string[] = [];

  lines.push("# Coworker task");
  lines.push("");
  lines.push(`Task: ${task.title}`);
  if (task.description.trim()) {
    lines.push("");
    lines.push(task.description.trim());
  }

  if (context.repoPath) {
    lines.push("");
    lines.push(`Repository: ${context.repoPath}`);
  }
  if (context.baseRef) {
    lines.push(`Base ref: ${context.baseRef}`);
  }

  if (context.previousSummary) {
    lines.push("");
    lines.push("## Previous attempt summary");
    lines.push(context.previousSummary.trim());
  }

  if (reviewComments.length > 0) {
    lines.push("");
    lines.push("## Review feedback to address");
    for (const comment of reviewComments) {
      const location = comment.filePath
        ? `${comment.filePath}${comment.lineStart ? `:${comment.lineStart}` : ""}`
        : "general";
      lines.push(`- [${comment.severity}] ${location}: ${comment.body}`);
    }
    lines.push("");
    lines.push("Address every review comment. Do not discard unrelated changes.");
  }

  lines.push("");
  lines.push("## Working agreement");
  lines.push("- Work only inside the provided workspace.");
  lines.push("- Make the requested change, run relevant tests, and report what you ran.");
  lines.push("- Do not commit unless the task explicitly asks for a commit.");
  lines.push("- End with a concise summary of changed files, tests, and open questions.");

  return lines.join("\n");
}
