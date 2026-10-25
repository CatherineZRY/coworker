import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  codexHome,
  commandExists,
  ensureHome,
  ensureToken,
  getPaths,
  installCodexHooks,
  writeDefaultConfig,
} from "@coworker/adapters";
import { parse, stringify } from "smol-toml";

export interface InstallOptions {
  home?: string;
  skipHooks?: boolean;
  skipMcp?: boolean;
  skipPlugin?: boolean;
}

export interface PluginInstallResult {
  marketplacePath: string;
  marketplaceSource: string;
  configChanged: boolean;
}

export interface InstallResult {
  home: string;
  tokenPath: string;
  hooks: { path: string; changed: boolean; backupPath: string | null } | null;
  mcpConfigPath: string;
  mcpChanged: boolean;
  mcpCommand: string;
  mcpArgs: string[];
  plugin: PluginInstallResult | null;
}

export async function installIntegration(options: InstallOptions = {}): Promise<InstallResult> {
  const paths = ensureHome(getPaths(options.home));
  writeDefaultConfig(paths);
  ensureToken(paths);

  const mcp = await resolveMcpCommand();
  const hooks = options.skipHooks
    ? null
    : installCodexHooks(codexHome(), hookCommand(mcp, paths.home));
  const plugin = options.skipPlugin ? null : installPluginMarketplace(paths.home, mcp);
  const mcpConfigPath = path.join(codexHome(), "config.toml");
  const config = updateCodexConfig(mcpConfigPath, {
    mcp: options.skipMcp ? null : mcp,
    pluginMarketplace: plugin?.marketplacePath ?? null,
  });
  if (plugin) plugin.configChanged = config.pluginChanged;

  return {
    home: paths.home,
    tokenPath: paths.tokenPath,
    hooks,
    mcpConfigPath,
    mcpChanged: config.mcpChanged,
    mcpCommand: mcp.command,
    mcpArgs: mcp.args,
    plugin,
  };
}

export function hookCommand(mcp: { command: string; args: string[] }, home: string): string {
  const parts = mcp.command === "coworker" ? ["coworker"] : [mcp.command, ...mcp.args.slice(0, -1)];
  parts.push("hook", "codex", "--home", home);
  return parts.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export async function resolveMcpCommand(): Promise<{ command: string; args: string[] }> {
  if (await commandExists("coworker")) {
    return { command: "coworker", args: ["mcp"] };
  }
  const entry = process.argv[1];
  if (entry?.endsWith(".js")) {
    return { command: process.execPath, args: [path.resolve(entry), "mcp"] };
  }
  throw new Error(
    "Could not find a `coworker` executable on PATH. Build the CLI (`pnpm build`) and either link it (`pnpm link --global --filter @coworker/cli`) or run `coworker install` from the built CLI.",
  );
}

/**
 * Copies the bundled Codex plugin into coworker's home and registers a local
 * marketplace in ~/.codex/config.toml. The MCP command is rewritten to the
 * absolute command we resolved, so the plugin works even when `coworker` is
 * not on PATH when Codex starts.
 */
function installPluginMarketplace(
  home: string,
  mcp: { command: string; args: string[] },
): PluginInstallResult | null {
  const source = resolvePluginSource();
  if (!source) return null;

  const marketplacePath = path.join(home, "plugin-marketplace");
  rmSync(marketplacePath, { recursive: true, force: true });
  cpSync(source, marketplacePath, {
    recursive: true,
    filter: (from) => {
      const name = path.basename(from);
      return name !== "node_modules" && name !== "dist" && name !== ".git";
    },
  });

  const pluginMcpPath = path.join(marketplacePath, "plugins", "coworker", ".mcp.json");
  if (existsSync(pluginMcpPath)) {
    try {
      const parsed = JSON.parse(readFileSync(pluginMcpPath, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      };
      parsed.mcpServers = parsed.mcpServers ?? {};
      parsed.mcpServers.coworker = {
        command: mcp.command,
        args: mcp.args,
        startup_timeout_sec: 30,
        tool_timeout_sec: 300,
      };
      writeFileSync(pluginMcpPath, `${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
      // Keep the shipped .mcp.json if it cannot be rewritten.
    }
  }

  return { marketplacePath, marketplaceSource: source, configChanged: false };
}

function resolvePluginSource(): string | null {
  const candidates: string[] = [];
  if (process.env.COWORKER_PLUGIN_DIR) candidates.push(process.env.COWORKER_PLUGIN_DIR);

  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, "../../../packages/codex-plugin"));
  } catch {
    // import.meta.url is unavailable in some bundlers; fall through
  }

  const entry = process.argv[1];
  if (entry) {
    try {
      candidates.push(
        path.resolve(path.dirname(realpathSync(entry)), "../../../packages/codex-plugin"),
      );
    } catch {
      // entry may no longer exist; fall through
    }
  }
  candidates.push(path.resolve(process.cwd(), "packages/codex-plugin"));

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (existsSync(path.join(candidate, ".agents", "plugins", "marketplace.json"))) {
      return candidate;
    }
  }
  return null;
}

function updateCodexConfig(
  configPath: string,
  options: {
    mcp: { command: string; args: string[] } | null;
    pluginMarketplace: string | null;
  },
): { mcpChanged: boolean; pluginChanged: boolean } {
  mkdirSync(path.dirname(configPath), { recursive: true });
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Could not parse ${configPath}. Fix the TOML manually or move the file aside. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let mcpChanged = false;
  if (options.mcp) {
    const servers = isRecord(config.mcp_servers) ? config.mcp_servers : {};
    const next = {
      command: options.mcp.command,
      args: options.mcp.args,
      startup_timeout_sec: 30,
      tool_timeout_sec: 300,
    };
    if (JSON.stringify(servers.coworker) !== JSON.stringify(next)) {
      servers.coworker = next;
      config.mcp_servers = servers;
      mcpChanged = true;
    }
  }

  let pluginChanged = false;
  if (options.pluginMarketplace) {
    const marketplaces = isRecord(config.marketplaces) ? config.marketplaces : {};
    const previousMarketplace = marketplaces["coworker-local"];
    const nextMarketplace = {
      source_type: "local",
      source: options.pluginMarketplace,
    };
    if (JSON.stringify(previousMarketplace) !== JSON.stringify(nextMarketplace)) {
      marketplaces["coworker-local"] = nextMarketplace;
      config.marketplaces = marketplaces;
      pluginChanged = true;
    }

    const plugins = isRecord(config.plugins) ? config.plugins : {};
    const pluginKey = "coworker@coworker-local";
    if (JSON.stringify(plugins[pluginKey]) !== JSON.stringify({ enabled: true })) {
      plugins[pluginKey] = { enabled: true };
      config.plugins = plugins;
      pluginChanged = true;
    }
  }

  if (mcpChanged || pluginChanged) {
    if (existsSync(configPath)) {
      copyFileSync(configPath, `${configPath}.coworker-backup-${Date.now()}`);
    }
    writeFileSync(configPath, stringify(config), { mode: 0o600 });
  }

  return { mcpChanged, pluginChanged };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
