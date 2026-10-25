import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installCodexHooks } from "@coworker/adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "coworker-hooks-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function hooksFile() {
  return JSON.parse(readFileSync(path.join(home, "hooks.json"), "utf8")) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
}

describe("installCodexHooks", () => {
  it("creates the Codex home and installs each lifecycle hook", () => {
    const result = installCodexHooks(home, "coworker hook codex");
    expect(result.changed).toBe(true);
    const hooks = hooksFile().hooks;
    for (const event of ["SessionStart", "Stop", "SessionEnd"]) {
      expect(hooks[event]?.[0]?.hooks[0]?.command).toBe("coworker hook codex");
    }
  });

  it("is idempotent", () => {
    installCodexHooks(home, "coworker hook codex");
    const result = installCodexHooks(home, "coworker hook codex");
    expect(result.changed).toBe(false);
    expect(hooksFile().hooks.Stop).toHaveLength(1);
  });

  it("updates an earlier command instead of duplicating the hook", () => {
    installCodexHooks(home, "coworker hook codex");
    installCodexHooks(home, "/usr/local/bin/node /app/index.js hook codex --home /tmp/x");
    const stop = hooksFile().hooks.Stop;
    expect(stop).toHaveLength(1);
    expect(stop?.[0]?.hooks[0]?.command).toContain("/usr/local/bin/node");
  });

  it("preserves unrelated hooks", () => {
    writeFileSync(
      path.join(home, "hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "other-tool stop" }] }],
        },
      }),
    );
    installCodexHooks(home, "coworker hook codex");
    const stop = hooksFile().hooks.Stop;
    expect(stop).toHaveLength(2);
    expect(JSON.stringify(stop)).toContain("other-tool stop");
  });
});
