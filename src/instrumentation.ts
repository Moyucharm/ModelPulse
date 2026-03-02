// Next.js Instrumentation - Auto-start background services

export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const enableDevServices = process.env.ENABLE_DEV_SERVICES === "true";
    if (process.env.NODE_ENV === "development" && !enableDevServices) {
      return;
    }

    const { initializeServices } = await import("@/lib/init");
    await initializeServices();
  }
}
