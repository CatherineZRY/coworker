import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync as Database } from "node:sqlite";
import { readCodexThreads } from "@coworker/adapters";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(modern: boolean) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "coworker-state-"));
  dirs.push(dir);
  const file = path.join(dir, "state.sqlite");
  const db = new Database(file);
  db.exec(`CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT${modern ? ", name TEXT" : ""})`);
  return { file, db };
}
describe("Codex display names", () => {
  it("prefers name over the original message and follows renames", () => {
    const { file, db } = fixture(true);
    db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?)").run(
      "main",
      "/project",
      "Original prompt",
      "Kitchen project",
    );
    expect(readCodexThreads(file)[0]?.title).toBe("Kitchen project");
    db.prepare("UPDATE threads SET name = ?").run("Renamed kitchen");
    expect(readCodexThreads(file)[0]?.title).toBe("Renamed kitchen");
    db.close();
  });
  it("falls back for blank names and older databases", () => {
    const modern = fixture(true);
    modern.db.exec("INSERT INTO threads VALUES ('main','/project','Legacy title','  ')");
    expect(readCodexThreads(modern.file)[0]?.title).toBe("Legacy title");
    modern.db.close();
    const legacy = fixture(false);
    legacy.db.exec("INSERT INTO threads VALUES ('old','/project','Old version')");
    expect(readCodexThreads(legacy.file)[0]?.title).toBe("Old version");
    legacy.db.close();
  });
});
