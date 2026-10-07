/** Standard JSON envelope (SRS §12). */
export function ok<T>(data: T, requestId?: string) {
  return { success: true as const, data, ...(requestId ? { requestId } : {}) };
}

export function fail(code: string, message: string, requestId: string, details: unknown = null) {
  return {
    success: false as const,
    error: { code, message, details },
    requestId,
  };
}
