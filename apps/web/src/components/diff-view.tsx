import type { ReviewComment, Severity } from "@coworker/shared";
import { Check, MessageSquarePlus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface DraftComment {
  id: string;
  filePath?: string;
  lineStart?: number;
  side?: "old" | "new";
  severity: Severity;
  body: string;
}

interface DiffLine {
  key: string;
  type: "hunk" | "meta" | "add" | "del" | "ctx";
  text: string;
  oldNo?: number;
  newNo?: number;
}

interface DiffFile {
  key: string;
  oldPath: string;
  newPath: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

interface DiffViewProps {
  patch: string;
  comments: ReviewComment[];
  drafts: DraftComment[];
  onAddDraft: (comment: DraftComment) => void;
  onRemoveDraft: (index: number) => void;
  onToggleResolved: (commentId: string, resolved: boolean) => void;
}

interface Anchor {
  filePath: string;
  lineStart: number;
  side: "old" | "new";
}

export function DiffView({
  patch,
  comments,
  drafts,
  onAddDraft,
  onRemoveDraft,
  onToggleResolved,
}: DiffViewProps) {
  const files = useMemo(() => parseUnifiedDiff(patch), [patch]);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<Severity>("major");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (anchor) commentInputRef.current?.focus();
  }, [anchor]);

  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No diff is recorded for this run.
      </div>
    );
  }

  const submit = () => {
    if (!anchor || !body.trim()) return;
    onAddDraft({ id: crypto.randomUUID(), ...anchor, severity, body: body.trim() });
    setBody("");
    setAnchor(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {files.map((file, fileIndex) => {
        const isCollapsed = collapsed.has(fileIndex);
        return (
          <div key={file.key} className="overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(fileIndex)) next.delete(fileIndex);
                  else next.add(fileIndex);
                  return next;
                })
              }
              className="flex w-full items-center justify-between gap-3 border-b border-border bg-slate-50 px-3 py-2 text-left"
            >
              <span className="truncate font-mono text-xs font-medium text-slate-700">
                {file.newPath || file.oldPath || "(unknown file)"}
              </span>
              <span className="shrink-0 font-mono text-[11px]">
                <span className="text-emerald-600">+{file.additions}</span>{" "}
                <span className="text-rose-600">−{file.deletions}</span>
              </span>
            </button>

            {!isCollapsed && (
              <div className="diff-scroll overflow-x-auto">
                <div className="min-w-[640px] font-mono text-[12px] leading-5">
                  {file.lines.map((line) => {
                    if (line.type === "hunk") {
                      return (
                        <div
                          key={line.key}
                          className="bg-sky-50 px-3 py-0.5 text-[11px] text-sky-700"
                        >
                          {line.text}
                        </div>
                      );
                    }
                    if (line.type === "meta") {
                      return (
                        <div
                          key={line.key}
                          className="bg-slate-50 px-3 py-0.5 text-[11px] text-slate-400"
                        >
                          {line.text}
                        </div>
                      );
                    }

                    const side: "old" | "new" = line.type === "del" ? "old" : "new";
                    const lineNumber = side === "old" ? line.oldNo : line.newNo;
                    const path = file.newPath || file.oldPath;
                    const lineComments = comments.filter(
                      (comment) =>
                        samePath(comment.filePath, path) &&
                        comment.lineStart === lineNumber &&
                        (comment.side ?? "new") === side,
                    );
                    const lineDrafts = drafts
                      .map((draft, draftIndex) => ({ draft, draftIndex }))
                      .filter(
                        ({ draft }) =>
                          samePath(draft.filePath, path) &&
                          draft.lineStart === lineNumber &&
                          (draft.side ?? "new") === side,
                      );
                    const isAnchored =
                      anchor?.filePath === path &&
                      anchor.lineStart === lineNumber &&
                      anchor.side === side;

                    return (
                      <div key={line.key}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!lineNumber) return;
                            setAnchor({ filePath: path, lineStart: lineNumber, side });
                            setBody("");
                          }}
                          className={cn(
                            "group grid w-full grid-cols-[44px_44px_20px_1fr] items-start text-left transition-colors",
                            line.type === "add" && "bg-emerald-50/80 hover:bg-emerald-100",
                            line.type === "del" && "bg-rose-50/80 hover:bg-rose-100",
                            line.type === "ctx" && "hover:bg-slate-100",
                            isAnchored && "ring-1 ring-inset ring-blue-300",
                          )}
                        >
                          <span className="select-none border-r border-slate-100 px-1 py-0.5 text-right text-[11px] text-slate-400">
                            {line.oldNo ?? ""}
                          </span>
                          <span className="select-none border-r border-slate-100 px-1 py-0.5 text-right text-[11px] text-slate-400">
                            {line.newNo ?? ""}
                          </span>
                          <span
                            className={cn(
                              "select-none px-1 py-0.5 text-center",
                              line.type === "add" && "text-emerald-600",
                              line.type === "del" && "text-rose-600",
                              line.type === "ctx" && "text-slate-300",
                            )}
                          >
                            {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                          </span>
                          <span className="whitespace-pre py-0.5 pr-3 text-slate-800">
                            {line.text}
                            {lineNumber && (
                              <MessageSquarePlus className="ml-2 inline size-3 align-middle text-blue-500 opacity-0 transition-opacity group-hover:opacity-100" />
                            )}
                          </span>
                        </button>

                        {lineComments.map((comment) => (
                          <InlineComment
                            key={comment.id}
                            comment={comment}
                            onToggleResolved={onToggleResolved}
                          />
                        ))}

                        {lineDrafts.map(({ draft, draftIndex }) => (
                          <div
                            key={draft.id}
                            className="mx-3 my-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold uppercase tracking-wide text-amber-700">
                                Draft · {draft.severity}
                              </span>
                              <button
                                type="button"
                                className="text-amber-700 hover:text-amber-900"
                                onClick={() => onRemoveDraft(draftIndex)}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-amber-900">{draft.body}</p>
                          </div>
                        ))}

                        {isAnchored && (
                          <div className="mx-3 my-2 rounded-lg border border-blue-200 bg-blue-50 p-2">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[11px] font-medium text-blue-700">
                                Comment on {path}:{lineNumber} ({side})
                              </span>
                              <div className="flex items-center gap-2">
                                <select
                                  value={severity}
                                  onChange={(event) => setSeverity(event.target.value as Severity)}
                                  className="rounded border border-blue-200 bg-white px-1 py-0.5 text-[11px]"
                                >
                                  <option value="blocker">blocker</option>
                                  <option value="major">major</option>
                                  <option value="minor">minor</option>
                                  <option value="nit">nit</option>
                                </select>
                                <button
                                  type="button"
                                  className="text-blue-600 hover:text-blue-800"
                                  onClick={() => setAnchor(null)}
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            </div>
                            <textarea
                              ref={commentInputRef}
                              value={body}
                              onChange={(event) => setBody(event.target.value)}
                              placeholder="What should change?"
                              rows={2}
                              className="w-full resize-y rounded border border-blue-200 bg-white p-2 text-xs outline-none focus:border-blue-400"
                            />
                            <div className="mt-1 flex justify-end">
                              <button
                                type="button"
                                onClick={submit}
                                disabled={!body.trim()}
                                className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                              >
                                Add comment
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InlineComment({
  comment,
  onToggleResolved,
}: {
  comment: ReviewComment;
  onToggleResolved: (commentId: string, resolved: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "mx-3 my-1 rounded border p-2 text-xs",
        comment.resolved
          ? "border-slate-200 bg-slate-50 text-slate-500"
          : "border-amber-200 bg-amber-50 text-amber-950",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide">
          {comment.severity}
          {comment.resolved ? " · resolved" : ""}
        </span>
        <button
          type="button"
          onClick={() => onToggleResolved(comment.id, !comment.resolved)}
          className="inline-flex items-center gap-1 text-[11px] underline decoration-dotted"
        >
          <Check className="size-3" />
          {comment.resolved ? "Reopen" : "Resolve"}
        </button>
      </div>
      <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
    </div>
  );
}

function samePath(candidate: string | null | undefined, path: string): boolean {
  if (!candidate) return false;
  const normalize = (value: string) => value.replace(/^[ab]\//, "");
  return normalize(candidate) === normalize(path);
}

type RawDiffLine = Omit<DiffLine, "key">;
type RawDiffFile = Omit<DiffFile, "key" | "lines"> & { lines: RawDiffLine[] };

export function parseUnifiedDiff(patch: string): DiffFile[] {
  if (!patch.trim()) return [];
  const files: RawDiffFile[] = [];
  let current: RawDiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;

  const ensureFile = (): RawDiffFile => {
    if (!current) {
      current = { oldPath: "", newPath: "", lines: [], additions: 0, deletions: 0 };
    }
    return current;
  };

  for (const rawLine of patch.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      if (current && (current.lines.length > 0 || current.newPath)) files.push(current);
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(rawLine);
      current = {
        oldPath: match?.[1] ?? "",
        newPath: match?.[2] ?? "",
        lines: [],
        additions: 0,
        deletions: 0,
      };
      oldLine = 0;
      newLine = 0;
      continue;
    }

    const file = ensureFile();

    if (rawLine.startsWith("--- ")) {
      file.oldPath = cleanPath(rawLine.slice(4));
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      file.newPath = cleanPath(rawLine.slice(4));
      continue;
    }

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunk) {
      oldLine = Number.parseInt(hunk[1] ?? "0", 10);
      newLine = Number.parseInt(hunk[2] ?? "0", 10);
      file.lines.push({ type: "hunk", text: rawLine });
      continue;
    }

    if (
      rawLine.startsWith("index ") ||
      rawLine.startsWith("new file mode") ||
      rawLine.startsWith("deleted file mode") ||
      rawLine.startsWith("similarity index") ||
      rawLine.startsWith("rename ") ||
      rawLine.startsWith("Binary files") ||
      rawLine.startsWith("GIT binary patch") ||
      rawLine.startsWith("\\ No newline")
    ) {
      file.lines.push({ type: "meta", text: rawLine });
      continue;
    }

    if (rawLine.startsWith("+")) {
      file.lines.push({ type: "add", text: rawLine.slice(1), newNo: newLine });
      newLine += 1;
      file.additions += 1;
      continue;
    }
    if (rawLine.startsWith("-")) {
      file.lines.push({ type: "del", text: rawLine.slice(1), oldNo: oldLine });
      oldLine += 1;
      file.deletions += 1;
      continue;
    }
    if (rawLine.startsWith(" ")) {
      file.lines.push({
        type: "ctx",
        text: rawLine.slice(1),
        oldNo: oldLine,
        newNo: newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  if (current && (current.lines.length > 0 || current.newPath)) files.push(current);
  return files
    .filter((file) => file.lines.length > 0)
    .map((file, fileIndex) => ({
      ...file,
      key: `file-${fileIndex}`,
      lines: file.lines.map((line, lineIndex) => ({
        ...line,
        key: `line-${fileIndex}-${lineIndex}`,
      })),
    }));
}

function cleanPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return "";
  return trimmed.replace(/^[ab]\//, "");
}
