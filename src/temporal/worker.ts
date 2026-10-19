// The worker: the process on this computer that does the night shift's steps. One activity at a time, because
// the model shares the machine with everything else the person runs.
import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import * as activities from './activities.ts';

export const TASK_QUEUE = 'shoebox';

export async function runWorker(address: string): Promise<void> {
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
    activities,
    maxConcurrentActivityTaskExecutions: 1,
  });
  await worker.run();
}
