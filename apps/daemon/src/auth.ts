import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const TOKEN_COOKIE = "coworker_token";

const PUBLIC_PATHS = new Set(["/api/health"]);

export function tokenEquals(expected: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  const cookie = request.cookies?.[TOKEN_COOKIE];
  if (cookie) return cookie;
  const query = request.query as Record<string, unknown> | undefined;
  if (query && typeof query.token === "string") return query.token;
  return null;
}

export function installAuth(app: FastifyInstance, token: string): void {
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_PATHS.has(request.url.split("?")[0] ?? request.url)) return;

    const candidate = extractToken(request);
    if (!tokenEquals(token, candidate)) {
      reply.code(401).send({
        error: "unauthorized",
        message:
          "Missing or invalid coworker token. Run `coworker open` or use the URL printed by `coworker start`.",
      });
      return;
    }

    if (candidate && request.query && typeof request.query === "object") {
      const query = request.query as Record<string, unknown>;
      if (typeof query.token === "string") {
        reply.setCookie(TOKEN_COOKIE, token, {
          path: "/",
          httpOnly: true,
          sameSite: "strict",
          maxAge: 60 * 60 * 24 * 365,
        });
      }
    }
  });
}
