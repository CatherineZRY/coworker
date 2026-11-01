import { isInternalCodexSource } from "@coworker/shared";

export function selectSessionBoard(
  selected: string,
  sessions: Array<{ boardId: string; source: string | null }>,
  boardIds: string[],
  defaultId: string,
): string {
  const internal = new Set(
    sessions.filter((s) => isInternalCodexSource(s.source)).map((s) => s.boardId),
  );
  if (boardIds.includes(selected) && !internal.has(selected)) return selected;
  return sessions.find((s) => !internal.has(s.boardId))?.boardId ?? defaultId;
}
