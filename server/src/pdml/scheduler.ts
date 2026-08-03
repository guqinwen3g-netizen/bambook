import type { PrismaClient } from '@prisma/client';
import { syncPdmlRawFabricCache } from './route';
import { logger } from '../lib/logger';

interface PdmlSyncSchedulerOptions {
  prisma: PrismaClient;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

const minutes = (value: number) => value * 60 * 1000;

const parseIntervalMs = () => {
  const raw = process.env.PDML_SYNC_INTERVAL_MS || process.env.PDML_SYNC_INTERVAL_MINUTES;
  if (!raw) return minutes(15);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return minutes(15);
  return process.env.PDML_SYNC_INTERVAL_MINUTES ? minutes(parsed) : parsed;
};

export function startPdmlSyncScheduler(opts: PdmlSyncSchedulerOptions) {
  if (process.env.PDML_SYNC_DISABLED === 'true') {
    logger.info('[pdml-sync] disabled by PDML_SYNC_DISABLED=true');
    return;
  }
  if (process.env.NODE_ENV !== 'production' && process.env.PDML_SYNC_ENABLED !== 'true') {
    logger.info('[pdml-sync] skipped outside production; set PDML_SYNC_ENABLED=true to enable locally');
    return;
  }

  const intervalMs = parseIntervalMs();
  let running = false;

  const run = async (reason: string) => {
    if (running) {
      logger.debug(`[pdml-sync] skipped ${reason}; previous sync still running`);
      return;
    }
    running = true;
    const started = Date.now();
    try {
      const result = await syncPdmlRawFabricCache({
        prisma: opts.prisma,
        pageSize: Number(process.env.PDML_SYNC_PAGE_SIZE || 500),
        onDataChange: opts.onDataChange,
      });
      logger.info(
        `[pdml-sync] ${reason} ok: fetched=${result.fetched} created=${result.created} updated=${result.updated} unchanged=${result.unchanged} ms=${Date.now() - started}`,
      );
    } catch (error: any) {
      logger.error(`[pdml-sync] ${reason} failed`, { error: error?.message || String(error) });
    } finally {
      running = false;
    }
  };

  logger.info(`[pdml-sync] scheduler enabled; interval=${Math.round(intervalMs / 1000)}s`);
  setTimeout(() => void run('startup'), minutes(1));
  setInterval(() => void run('interval'), intervalMs);
}
