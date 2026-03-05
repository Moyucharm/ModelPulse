// Application initialization - Start worker and scheduler

import { startWorker, isWorkerRunning } from "@/lib/queue/worker";
import { startAllCronsWithConfig } from "@/lib/scheduler";

// Persist init state across Next.js route bundles (chunk isolation).
const globalForInit = globalThis as unknown as {
  __servicesInitPromise?: Promise<void>;
};

/**
 * Initialize background services
 * Should be called once on application startup
 */
export async function initializeServices(): Promise<void> {
  if (globalForInit.__servicesInitPromise) {
    return globalForInit.__servicesInitPromise;
  }

  globalForInit.__servicesInitPromise = (async () => {
    // Start worker
    if (!isWorkerRunning()) {
      startWorker();
    }

    // Start cron jobs (load config from database)
    await startAllCronsWithConfig();
  })();

  return globalForInit.__servicesInitPromise;
}

