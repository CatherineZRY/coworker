import { useMutation } from "@tanstack/react-query";
import { ListPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import type { Notify } from "@/lib/types";

interface NewTaskDialogProps {
  open: boolean;
  boardId: string;
  boardTitle: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
  notify: Notify;
}

export function NewTaskDialog({
  open,
  boardId,
  boardTitle,
  onClose,
  onCreated,
  notify,
}: NewTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("0");
  const [labels, setLabels] = useState("");
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setPriority("0");
    setLabels("");
    const timer = window.setTimeout(() => titleRef.current?.focus(), 50);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const createTask = useMutation({
    mutationFn: () =>
      api.createTask({
        boardId,
        title: title.trim(),
        description,
        priority: Number.parseInt(priority, 10) || 0,
        labels: labels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
      }),
    onSuccess: (task) => {
      notify("success", "Task created");
      onCreated(task.id);
      onClose();
    },
    onError: (error) => {
      notify(
        "error",
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      );
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default bg-slate-900/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                <ListPlus className="size-4" />
              </span>
              <h2 className="text-sm font-semibold text-slate-900">New task</h2>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Added to <span className="font-medium text-slate-600">{boardTitle}</span> as Ready.
              You can dispatch a worker from the task panel.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex flex-col gap-3 p-5">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">Title</span>
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What should the worker accomplish?"
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (title.trim()) createTask.mutate();
                }
              }}
            />
          </label>

          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              placeholder="Context, acceptance criteria, files to look at…"
              className="w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-600">Priority (0–100)</span>
              <input
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                inputMode="numeric"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-xs outline-none focus:border-blue-400"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-600">
                Labels (comma separated)
              </span>
              <input
                value={labels}
                onChange={(event) => setLabels(event.target.value)}
                placeholder="frontend, bug"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-xs outline-none focus:border-blue-400"
              />
            </label>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-[10px] text-muted-foreground">⌘/Ctrl + Enter to create</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => createTask.mutate()}
              disabled={!title.trim() || createTask.isPending}
            >
              Create task
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
