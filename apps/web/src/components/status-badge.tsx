import type { AgentId, ReviewVerdict, RunStatus, Severity, TaskStatus } from "@coworker/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TASK_STYLES: Record<TaskStatus, string> = {
  backlog: "border-slate-200 bg-slate-50 text-slate-600",
  ready: "border-slate-300 bg-white text-slate-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  review: "border-amber-200 bg-amber-50 text-amber-700",
  changes_requested: "border-rose-200 bg-rose-50 text-rose-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-stone-200 bg-stone-50 text-stone-600",
};

const RUN_STYLES: Record<RunStatus, string> = {
  queued: "border-slate-200 bg-slate-50 text-slate-600",
  starting: "border-blue-200 bg-blue-50 text-blue-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-stone-200 bg-stone-50 text-stone-600",
  timed_out: "border-orange-200 bg-orange-50 text-orange-700",
};

const AGENT_STYLES: Record<AgentId, string> = {
  "claude-code": "border-violet-200 bg-violet-50 text-violet-700",
  codex: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cursor: "border-sky-200 bg-sky-50 text-sky-700",
  fake: "border-slate-200 bg-slate-50 text-slate-600",
};

const VERDICT_STYLES: Record<ReviewVerdict, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  changes_requested: "border-amber-200 bg-amber-50 text-amber-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
};

const SEVERITY_STYLES: Record<Severity, string> = {
  blocker: "border-red-300 bg-red-50 text-red-700",
  major: "border-amber-300 bg-amber-50 text-amber-700",
  minor: "border-blue-200 bg-blue-50 text-blue-700",
  nit: "border-slate-200 bg-slate-50 text-slate-600",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge className={cn(TASK_STYLES[status] ?? TASK_STYLES.backlog, "capitalize")}>
      {status === "running" && (
        <span className="live-dot size-1.5 rounded-full bg-blue-500" aria-hidden />
      )}
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge className={cn(RUN_STYLES[status] ?? RUN_STYLES.queued, "capitalize")}>
      {status === "running" && (
        <span className="live-dot size-1.5 rounded-full bg-blue-500" aria-hidden />
      )}
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

export function AgentBadge({ agent }: { agent: AgentId }) {
  return (
    <Badge className={cn(AGENT_STYLES[agent] ?? AGENT_STYLES.fake, "font-mono")}>{agent}</Badge>
  );
}

export function VerdictBadge({ verdict }: { verdict: ReviewVerdict }) {
  return (
    <Badge className={cn(VERDICT_STYLES[verdict] ?? VERDICT_STYLES.rejected, "capitalize")}>
      {verdict.replaceAll("_", " ")}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge className={cn(SEVERITY_STYLES[severity], "uppercase tracking-wide")}>{severity}</Badge>
  );
}
