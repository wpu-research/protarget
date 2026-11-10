import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES, type QueueName } from '@protarget/shared';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6390', { maxRetriesPerRequest: null });

const log = (level: string, msg: string, extra: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ level, msg, ...extra }));

/**
 * Periyodik işler (Spec v2 §36). Sıklıklar ileride settings tablosundan okunacak.
 * İşleyiciler henüz yazılmadı: her iş alındığında "not implemented" loglanır ve başarısız sayılmaz.
 */
const REPEATABLE: Partial<Record<QueueName, number>> = {
  [QUEUES.OFFLINE_SCREEN_DETECTOR]: 60_000,
  [QUEUES.CAMPAIGN_COMPLETER]: 60_000,
  [QUEUES.PACING_CALCULATOR]: 10 * 60_000,
  [QUEUES.DEAL_SYNC]: 10 * 60_000,
  [QUEUES.DAILY_AGGREGATION]: 60 * 60_000,
  [QUEUES.CREATIVE_CLEANUP]: 24 * 60 * 60_000,
};

async function main(): Promise<void> {
  const workers: Worker[] = [];

  for (const name of Object.values(QUEUES)) {
    const every = REPEATABLE[name];
    if (every) {
      const queue = new Queue(name, { connection });
      await queue.upsertJobScheduler(`${name}:tick`, { every }, { name: 'tick' });
      await queue.close();
    }

    workers.push(
      new Worker(
        name,
        async (job: Job) => {
          log('warn', 'job handler not implemented', { queue: name, job: job.name, id: job.id });
        },
        { connection },
      ),
    );
  }

  log('info', 'worker started', { queues: Object.values(QUEUES) });

  const shutdown = async (): Promise<void> => {
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
