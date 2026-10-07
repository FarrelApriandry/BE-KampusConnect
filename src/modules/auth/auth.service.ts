import { sql } from "../../db/client";
import { env } from "../../config/env";
import {
  AuthenticationError,
  BusinessRuleError,
  ConflictError,
} from "../../shared/errors/app-error";

export type SignToken = (payload: { sub: string; role: string }) => Promise<string>;

export interface PublicUser {
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

const PUBLIC_COLUMNS = `id, name, email, student_id, faculty, major, academic_year,
  avatar_url, bio, role, verification_status, account_status, created_at, updated_at`;

function isCampusEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return env.ALLOWED_CAMPUS_DOMAINS.includes(domain);
}

function assertEmailFormat(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BusinessRuleError("Format email tidak valid", "INVALID_EMAIL");
  }
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  student_id?: string;
  faculty?: string;
  major?: string;
  academic_year?: number;
}

export async function register(input: RegisterInput, sign: SignToken) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  assertEmailFormat(email);

  if (!isCampusEmail(email)) {
    throw new BusinessRuleError(
      "Pendaftaran hanya untuk email kampus (@untidar.ac.id / @students.untidar.ac.id)",
      "EMAIL_DOMAIN_NOT_ALLOWED",
    );
  }
  if (name.length < 2) {
    throw new BusinessRuleError("Nama minimal 2 karakter", "INVALID_NAME", 422);
  }
  if (input.password.length < 6) {
    throw new BusinessRuleError("Password minimal 6 karakter", "WEAK_PASSWORD", 422);
  }

  const existing = await sql`select id from users where email = ${email}`;
  if (existing.length > 0) {
    throw new ConflictError("Email sudah terdaftar", "EMAIL_TAKEN");
  }
  if (input.student_id) {
    const sid = await sql`select id from users where student_id = ${input.student_id}`;
    if (sid.length > 0) {
      throw new ConflictError("NIM sudah terdaftar", "STUDENT_ID_TAKEN");
    }
  }

  // Verifikasi kampus = cek domain allowlist (keputusan Sprint 1): domain valid → langsung VERIFIED.
  const password_hash = await Bun.password.hash(input.password, {
    algorithm: "bcrypt",
    cost: 10,
  });

  const rows = await sql`
    insert into users (name, email, password_hash, student_id, faculty, major, academic_year, role, verification_status)
    values (${name}, ${email}, ${password_hash},
      ${input.student_id ?? null}, ${input.faculty ?? null},
      ${input.major ?? null}, ${input.academic_year ?? null},
      'USER', 'VERIFIED')
    returning ${sql.unsafe(PUBLIC_COLUMNS)}`;
  const user = rows[0] as unknown as PublicUser;
  const token = await sign({ sub: user.id, role: user.role });
  return { user, token };
}

export interface LoginInput {
  email: string;
  password: string;
  /** Mode dari login page (pilihan pengguna/admin). Backend tetap memvalidasi role asli. */
  mode?: "USER" | "ADMIN";
}

export async function login(input: LoginInput, sign: SignToken) {
  const email = input.email.trim().toLowerCase();
  const rows = await sql`
    select ${sql.unsafe(PUBLIC_COLUMNS)}, password_hash
    from users where email = ${email}`;
  const row = rows[0] as unknown as (PublicUser & { password_hash: string }) | undefined;

  // Pesan generik agar tidak membocorkan akun mana yang terdaftar.
  if (!row || !(await Bun.password.verify(input.password, row.password_hash))) {
    throw new AuthenticationError("Email atau password salah", "INVALID_CREDENTIALS");
  }
  if (row.account_status === "SUSPENDED") {
    throw new AuthenticationError("Akun ditangguhkan, hubungi admin", "ACCOUNT_SUSPENDED");
  }
  if (input.mode === "ADMIN" && row.role !== "ADMIN") {
    throw new AuthenticationError("Akun ini bukan admin", "NOT_ADMIN");
  }

  const { password_hash: _ph, ...user } = row;
  const token = await sign({ sub: user.id, role: user.role });
  return { user, token };
}

/** Re-check verifikasi untuk akun PENDING (mis. setelah update data). Domain valid → VERIFIED. */
export async function verifyCampus(userId: string): Promise<PublicUser> {
  const rows = await sql`select ${sql.unsafe(PUBLIC_COLUMNS)} from users where id = ${userId}`;
  const user = rows[0] as unknown as PublicUser | undefined;
  if (!user) throw new AuthenticationError("Sesi tidak valid", "SESSION_INVALID");
  if (user.verification_status === "VERIFIED") return user;
  if (!isCampusEmail(user.email)) {
    throw new BusinessRuleError(
      "Email tidak termasuk domain kampus yang diizinkan",
      "EMAIL_DOMAIN_NOT_ALLOWED",
    );
  }
  const updated = await sql`
    update users set verification_status = 'VERIFIED', updated_at = now()
    where id = ${userId}
    returning ${sql.unsafe(PUBLIC_COLUMNS)}`;
  return updated[0] as unknown as PublicUser;
}
