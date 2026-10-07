import { AppError } from "../shared/errors/app-error";
import { fail } from "../shared/utils/respond";

/**
 * Map every error to the SRS §12 JSON envelope.
 * IMPORTANT: attach DIRECTLY with `.onError(mapError)` on each Elysia
 * instance (main app + every router). Mounting via `.use(errorPlugin)`
 * does not reliably propagate error hooks in this Elysia version.
 */
export function mapError({ code, error, set, requestId }: any) {
  const rid = (requestId as string | undefined) ?? crypto.randomUUID();

  if (error instanceof AppError) {
    set.status = error.status;
    return fail(error.code, error.message, rid, error.details);
  }

  if (code === "VALIDATION") {
    set.status = 422;
    const details = (error as any)?.all ?? (error as any)?.message ?? null;
    return fail("VALIDATION_ERROR", "Validasi gagal", rid, details);
  }

  if (code === "NOT_FOUND") {
    set.status = 404;
    return fail("ROUTE_NOT_FOUND", "Route tidak ditemukan", rid);
  }

  console.error(`[${rid}]`, error);
  set.status = 500;
  return fail("INTERNAL_ERROR", "Terjadi kesalahan server", rid);
}
