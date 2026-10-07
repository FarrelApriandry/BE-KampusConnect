/**
 * SDD §14 — bobot trust score.
 * Nilai harus tetap configurable di sisi backend (bukan hard-code di client),
 * karena itu semua angka bisa ditimpa lewat environment variable.
 *
 * trustScore = verificationWeight + transactionWeight + reviewWeight
 *            + accountAgeWeight - cancellationPenalty - moderationPenalty
 *
 * Skor maksimum = 100 (20 + 40 + 30 + 10).
 */

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface TrustWeights {
  verified: number;
  perTransaction: number;
  maxTransactions: number;
  perReview: number;
  maxReviews: number;
  perAccountMonth: number;
  maxAccountAge: number;
  perCancellation: number;
  maxCancellation: number;
  perModerationAction: number;
  maxModeration: number;
}

export const TRUST_WEIGHTS: TrustWeights = {
  // Akun terverifikasi kampus.
  verified: num("TRUST_W_VERIFIED", 20),
  // Transaksi COMPLETED sebagai seller: 4 poin masing-masing, batas 40.
  perTransaction: num("TRUST_W_PER_TXN", 4),
  maxTransactions: num("TRUST_W_MAX_TXN", 40),
  // Review positif yang diterima: 3 poin masing-masing, batas 30.
  perReview: num("TRUST_W_PER_REVIEW", 3),
  maxReviews: num("TRUST_W_MAX_REVIEW", 30),
  // Umur akun: 1 poin per bulan, batas 10.
  perAccountMonth: num("TRUST_W_PER_MONTH", 1),
  maxAccountAge: num("TRUST_W_MAX_AGE", 10),
  // Penalti pembatalan: 2 poin per transaksi CANCELLED, batas 10.
  perCancellation: num("TRUST_W_PER_CANCEL", 2),
  maxCancellation: num("TRUST_W_MAX_CANCEL", 10),
  // Penalti moderasi: 10 poin per aksi WARN/SUSPEND_USER, batas 30.
  perModerationAction: num("TRUST_W_PER_MOD", 10),
  maxModeration: num("TRUST_W_MAX_MOD", 30),
};

/** Rentang skor: 0..100. */
export const TRUST_SCORE_MIN = 0;
export const TRUST_SCORE_MAX = 100;

/**
 * Label kualitatif untuk ditampilkan client.
 * Ambang dipakai apa adanya supaya FE tidak perlu tahu formula.
 */
export function trustLabel(score: number): string {
  if (score >= 80) return "SANGAT_TERPERCAYA";
  if (score >= 60) return "TERPERCAYA";
  if (score >= 40) return "CUKUP";
  if (score >= 20) return "RENDAH";
  return "BARU";
}
