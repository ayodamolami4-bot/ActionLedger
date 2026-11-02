import {DatabaseSync} from 'node:sqlite';
import {initialStatus, retryDelayMs, stableStringify} from './policy.ts';
import type {ActionInput, ActionStatus} from './policy.ts';
import {sha, signReceipt, verifyReceipt} from './receipts.ts';
import type {Receipt} from './receipts.ts';

export type Action = {id: number; request_id: string; requested_by: string; tool: string; payload_json: string; fingerprint: string; status: ActionStatus; attempts: number; next_attempt_at: number | null; reviewer: string | null; error: string | null; created_at: string; updated_at: string};
export class Conflict extends Error {}
export class NotFound extends Error {}
export class Denied extends Error {}
const MAX_ATTEMPTS = 3;

export class ActionStore {
  db: DatabaseSync;
  private secret: string;
  constructor(path: string, secret: string) {
    this.secret = secret;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE, requested_by TEXT NOT NULL, tool TEXT NOT NULL,
      payload_json TEXT NOT NULL, fingerprint TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER, reviewer TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      action_id INTEGER NOT NULL REFERENCES actions(id), sequence INTEGER NOT NULL,
      actor TEXT NOT NULL, previous_status TEXT, next_status TEXT NOT NULL,
      timestamp TEXT NOT NULL, detail_hash TEXT NOT NULL, signature TEXT NOT NULL,
      PRIMARY KEY(action_id, sequence)
    );`);
  }
  close(): void {this.db.close();}
  get(id: number): Action {const a=this.db.prepare('SELECT * FROM actions WHERE id=?').get(id) as Action | undefined;if(!a) throw new NotFound('Action not found');return a;}
  list(): Action[] {return this.db.prepare('SELECT * FROM actions ORDER BY id DESC LIMIT 100').all() as Action[];}
  getByRequestId(id:string): Action|undefined {return this.db.prepare('SELECT * FROM actions WHERE request_id=?').get(id) as Action | undefined;}
  receipts(id:number): Receipt[] {
    return (this.db.prepare('SELECT * FROM receipts WHERE action_id=? ORDER BY sequence').all(id) as any[]).map(r=>({actionId:r.action_id,sequence:r.sequence,actor:r.actor,from:r.previous_status,to:r.next_status,timestamp:r.timestamp,detailHash:r.detail_hash,signature:r.signature}));
  }
  verify(id:number): boolean {this.get(id);return this.receipts(id).every(r=>verifyReceipt(r,this.secret));}
  private record(id:number, actor:string, from:ActionStatus|null, to:ActionStatus, details:unknown) {
    const sequence=(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 as n FROM receipts WHERE action_id=?').get(id) as {n:number}).n;
    const fields={actionId:id,sequence,actor,from,to,timestamp:new Date().toISOString(),detailHash:sha(details)};
    const signature=signReceipt(fields,this.secret);
    this.db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?,?,?,?)').run(id,sequence,actor,from,to,fields.timestamp,fields.detailHash,signature);
  }
  // Atomic database constraints prevent duplicate logical requests, even when the API is retried.
  create(input:ActionInput): {action:Action; replay:boolean} {
    const fingerprint=sha(input);const payloadJson=stableStringify(input.payload);
    const existing=this.getByRequestId(input.requestId);
    if(existing) {if(existing.fingerprint!==fingerprint)throw new Conflict('Idempotency key reused for a different action');return {action:existing,replay:true};}
    const now=new Date().toISOString();const status=initialStatus(input.tool);
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result=this.db.prepare('INSERT INTO actions (request_id, requested_by, tool, payload_json, fingerprint, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(input.requestId,input.requestedBy,input.tool,payloadJson,fingerprint,status,now,now);
      const id=Number(result.lastInsertRowid);this.record(id,input.requestedBy,null,status,{tool:input.tool,payload:input.payload});
      this.db.exec('COMMIT');return {action:this.get(id),replay:false};
    } catch(e) {try{this.db.exec('ROLLBACK');}catch{}; const found=this.getByRequestId(input.requestId);if(found){if(found.fingerprint!==fingerprint)throw new Conflict('Idempotency key reused for a different action');return {action:found,replay:true};}throw e;}
  }
  decide(id:number,reviewer:string,approved:boolean): Action {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const a=this.get(id);
      if(a.status!=='pending_approval')throw new Conflict('Action is not awaiting approval');
      if(!reviewer || reviewer===a.requested_by)throw new Denied('Requester cannot approve or reject their own action');
      const status=approved?'ready':'rejected';
      this.db.prepare('UPDATE actions SET status=?, reviewer=?, updated_at=? WHERE id=?').run(status,reviewer,new Date().toISOString(),id);
      this.record(id,reviewer,a.status,status,{approved});this.db.exec('COMMIT');return this.get(id);
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  claimReady(now=Date.now()): Action|undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const candidate=this.db.prepare('SELECT * FROM actions WHERE status=? OR (status=? AND next_attempt_at<=?) ORDER BY id LIMIT 1').get('ready','retrying',now) as Action|undefined;
      if(!candidate){this.db.exec('COMMIT');return undefined;}
      const attempts=candidate.attempts+1;
      this.db.prepare('UPDATE actions SET status=?, attempts=?, next_attempt_at=NULL, updated_at=? WHERE id=?').run('running',attempts,new Date().toISOString(),candidate.id);
      this.record(candidate.id,'worker',candidate.status,'running',{attempts});
      this.db.exec('COMMIT');return this.get(candidate.id);
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  complete(id:number,error?:string,now=Date.now()):Action {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const a=this.get(id);
      if(a.status!=='running')throw new Conflict('Action not running');
      const status:ActionStatus=error?(a.attempts>=MAX_ATTEMPTS?'dead_letter':'retrying'):'succeeded';
      const next=error&&status==='retrying'?now+retryDelayMs(a.attempts):null;
      this.db.prepare('UPDATE actions SET status=?, error=?, next_attempt_at=?, updated_at=? WHERE id=?').run(status,error||null,next,new Date().toISOString(),id);
      this.record(id,'worker','running',status,{attempts:a.attempts,error:error||null});this.db.exec('COMMIT');return this.get(id);
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  counts(): Record<string,number> {
    const rows=this.db.prepare('SELECT status,COUNT(*) AS n FROM actions GROUP BY status').all() as {status:string,n:number}[];
    return Object.fromEntries(rows.map(x=>[x.status,x.n]));
  }
}
