/** Absolute paths of the files in `test/integration/fixtures`. */

import { fileURLToPath } from 'node:url';

function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export const FIXTURES = {
  /** start → user task "Review order" → external task topic `charge-card` → end */
  orderProcess: fixture('order-process.bpmn'),
  /** decision `approval`: amount (integer) <= 1000 → approved true, else false */
  approvalDecision: fixture('approval.dmn'),
  /** small text file used as a binary (Bytes) variable */
  attachment: fixture('attachment.txt'),
} as const;

export const PROCESS_KEY = 'order-process';
export const DECISION_KEY = 'approval';
export const USER_TASK_NAME = 'Review order';
export const EXTERNAL_TOPIC = 'charge-card';
