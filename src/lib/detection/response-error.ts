/**
 * Check if response body contains error indicators.
 * Some API gateways/proxies return HTTP 200 but with error payload.
 */
export function checkResponseBodyForError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const obj = body as Record<string, unknown>;

  // Pattern 1: { error: "message" } or { error: { message: "..." } }
  if (obj.error) {
    if (typeof obj.error === "string") {
      return obj.error;
    }
    if (typeof obj.error === "object" && obj.error !== null) {
      const errObj = obj.error as Record<string, unknown>;
      if (typeof errObj.message === "string") {
        return errObj.message;
      }
      return JSON.stringify(obj.error).slice(0, 500);
    }
  }

  // Pattern 2: { success: false, message: "..." }
  if (obj.success === false && typeof obj.message === "string") {
    return obj.message;
  }

  // Pattern 3: { code: non-zero, message: "..." }
  if (typeof obj.code === "number" && obj.code !== 0 && typeof obj.message === "string") {
    return `[${obj.code}] ${obj.message}`;
  }

  // Pattern 4: { status: "error", ... }
  if (obj.status === "error" || obj.status === "fail" || obj.status === "failed") {
    if (typeof obj.message === "string") {
      return obj.message;
    }
    return `Status: ${obj.status}`;
  }

  return null;
}
