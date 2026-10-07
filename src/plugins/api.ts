import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { env } from "../config/env";
import { sql } from "../db/client";
import { AuthenticationError, AuthorizationError } from "../shared/errors/app-error";

export interface JwtPayload {
  sub: string;
  role: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  student_id: string | null;
  faculty: string | null;
  major: string | null;
  academic_year: number | null;
  avatar_url: string | null;
  bio: string | null;
  role: string;
  verification_status: string;
  account_status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Shared API plugin: JWT + per-request ID.
 * Auth reads the token inside each handler via tokenFromContext()
 * (a .derive that decodes the token proved unreliable in this Elysia
 * version — derive state was not visible inside mounted sub-routers).
 */
export const apiPlugin = new Elysia({ name: "kampusconnect-api" })
  .use(jwt({ name: "jwt", secret: env.JWT_SECRET, exp: env.JWT_EXPIRES_IN }))
  .derive(() => ({ requestId: crypto.randomUUID() }));

export async function verifyToken(ctx: any): Promise<JwtPayload | null> {
  const header = ctx?.request?.headers?.get("authorization") as string | undefined;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const payload = (await ctx.jwt.verify(header.slice(7))) as unknown as JwtPayload | false;
    if (!payload || typeof payload !== "object" || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireUser(ctxOrPayload: any): Promise<CurrentUser> {
  const tokenUser: JwtPayload | null =
    ctxOrPayload && typeof ctxOrPayload === "object" && "request" in ctxOrPayload
      ? await verifyToken(ctxOrPayload)
      : (ctxOrPayload as JwtPayload | null);
  if (!tokenUser) throw new AuthenticationError("Login diperlukan");
  const rows = await sql`
    select id, name, email, student_id, faculty, major, academic_year,
           avatar_url, bio, role, verification_status, account_status,
           created_at, updated_at
    from users where id = ${tokenUser.sub}`;
  const user = rows[0] as unknown as CurrentUser | undefined;
  if (!user) throw new AuthenticationError("Sesi tidak valid", "SESSION_INVALID");
  if (user.account_status === "SUSPENDED") {
    throw new AuthorizationError("Akun ditangguhkan", "ACCOUNT_SUSPENDED");
  }
  return user;
}

export async function requireAdmin(ctxOrPayload: any): Promise<CurrentUser> {
  const user = await requireUser(ctxOrPayload);
  if (user.role !== "ADMIN") {
    throw new AuthorizationError("Hanya admin", "ADMIN_ONLY");
  }
  return user;
}

export function requireVerified(user: CurrentUser): void {
  if (user.verification_status !== "VERIFIED") {
    throw new AuthorizationError("Verifikasi kampus diperlukan", "NOT_VERIFIED");
  }
}
