import { describe, expect, it } from "vitest";
import { selectSessionBoard } from "../apps/web/src/lib/session-selection.js";

describe("persisted board selection", () => {
  const sessions = [
    { boardId: "review", source: '{"subagent":{"other":"guardian"}}' },
    { boardId: "main", source: "vscode" },
  ];
  it("replaces a saved internal board with a primary board", () => {
    expect(selectSessionBoard("review", sessions, ["review", "main", "local"], "local")).toBe(
      "main",
    );
  });
  it("preserves an explicitly chosen primary or local board", () => {
    expect(selectSessionBoard("main", sessions, ["review", "main", "local"], "local")).toBe("main");
    expect(selectSessionBoard("local", sessions, ["review", "main", "local"], "local")).toBe(
      "local",
    );
  });
});
