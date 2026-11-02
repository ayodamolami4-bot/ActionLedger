import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {stableStringify} from './policy.ts';

export type Receipt = {actionId: number; sequence: number; actor: string; from: string | null; to: string; timestamp: string; detailHash: string; signature: string};
export function sha(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
export function signReceipt(unsigned: Omit<Receipt,'signature'>, secret: string): string {
  return createHmac('sha256', secret).update(stableStringify(unsigned)).digest('hex');
}
export function verifyReceipt(r: Receipt, secret: string): boolean {
  const {signature: _ignored, ...fields} = r;
  const expected = Buffer.from(signReceipt(fields, secret), 'hex');
  const actual = Buffer.from(r.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
