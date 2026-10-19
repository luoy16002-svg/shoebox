// The night shift, as Temporal workflows. Workflow code only decides what happens next; every step that touches
// the world (reading a photo, moving a file) is an activity, so Temporal can retry it and, if the computer sleeps or
// the worker is killed halfway, pick up at the receipt where it stopped.
import { executeChild, proxyActivities, workflowInfo } from '@temporalio/workflow';
import type * as acts from './activities.ts';

const quick = proxyActivities<typeof acts>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5, initialInterval: '5 seconds', backoffCoefficient: 2 },
});

// Reading runs a vision model on a CPU: minutes, not seconds. It heartbeats while it waits, so a dead worker is
// noticed within a minute and the read starts again elsewhere instead of waiting out the whole timeout.
const slow = proxyActivities<typeof acts>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '1 minute',
  retry: { maximumAttempts: 4, initialInterval: '30 seconds', backoffCoefficient: 2 },
});

export type ShiftInput = { folder: string };
export type ShiftResult = { filed: number; flagged: number; failed: number; note: string };

/** One receipt: read it, put it in a category, file it (or put it aside for a human). */
export async function fileReceipt(input: { folder: string; file: string }): Promise<acts.Filed> {
  const reading = await slow.readReceiptActivity(input.file);
  const category = reading.check.ok ? await quick.categorize(reading.copied) : 'Unsorted';
  return await quick.fileIt(input.folder, input.file, reading, category);
}

/** Every new receipt in the inbox, one at a time (a laptop's CPU, not a data centre), then the books. */
export async function nightShift(input: ShiftInput): Promise<ShiftResult> {
  const files = await quick.listNew(input.folder);
  let filed = 0;
  let flagged = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const r = await executeChild(fileReceipt, {
        args: [{ folder: input.folder, file }],
        workflowId: `${workflowInfo().workflowId}/${file.split(/[\\/]/).pop()}`,
      });
      if (r.flagged) flagged++;
      else filed++;
    } catch {
      failed++;
    }
  }
  const note = await quick.closeBooks(input.folder, { filed, flagged, failed });
  return { filed, flagged, failed, note };
}
