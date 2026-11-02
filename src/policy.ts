export const TOOLS = {
  lookup_customer: {risk: 'low', requiresApproval: false},
  send_email: {risk: 'high', requiresApproval: true},
  issue_refund: {risk: 'high', requiresApproval: true}
} as const;
export type ToolName = keyof typeof TOOLS;
export type ActionStatus = 'ready' | 'pending_approval' | 'rejected' | 'running' | 'succeeded' | 'retrying' | 'dead_letter';

export type ActionInput = {requestId: string; requestedBy: string; tool: ToolName; payload: Record<string, unknown>};
export function validateInput(value: unknown): ActionInput {
  if (!value || typeof value !== 'object') throw new Error('Expected an object');
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== 'string' || !/^[A-Za-z0-9:_-]{8,100}$/.test(v.requestId)) throw new Error('requestId must be 8-100 safe characters');
  if (typeof v.requestedBy !== 'string' || !/^[A-Za-z0-9._@-]{3,100}$/.test(v.requestedBy)) throw new Error('requestedBy must identify an actor');
  if (typeof v.tool !== 'string' || !(v.tool in TOOLS)) throw new Error('Unknown tool');
  if (!v.payload || typeof v.payload !== 'object' || Array.isArray(v.payload)) throw new Error('payload must be an object');
  const payload=v.payload as Record<string, unknown>;
  if (v.tool === 'issue_refund' && (typeof payload.amountCents !== 'number' || !Number.isInteger(payload.amountCents) || payload.amountCents <= 0 || payload.amountCents > 100_000_00)) throw new Error('refund amountCents must be a positive integer <= 10000000');
  if (v.tool === 'send_email' && (typeof payload.to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.to))) throw new Error('email recipient is invalid');
  return {requestId: v.requestId, requestedBy: v.requestedBy, tool:v.tool as ToolName, payload};
}
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v as Record<string,unknown>).sort().map(k=>JSON.stringify(k)+':'+stableStringify((v as Record<string,unknown>)[k])).join(',')}}`;
}
export function initialStatus(tool: ToolName): ActionStatus {
  return TOOLS[tool].requiresApproval ? 'pending_approval' : 'ready';
}
export function retryDelayMs(attempt: number): number {
  // Deterministic backoff so behavior can be tested and demonstrated; add jitter for a real external worker.
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
}
