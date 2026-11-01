/** Non-interactive worker and internal review sessions are not user boards. */
export function isInternalCodexSource(source: string | null | undefined): boolean {
  if (source === "exec") return true;
  if (!source) return false;
  try {
    const value: unknown = JSON.parse(source);
    return typeof value === "object" && value !== null && "subagent" in value;
  } catch {
    return false;
  }
}
