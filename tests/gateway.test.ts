import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ActionStore, Conflict, Denied} from '../src/store.ts';
import {validateInput} from '../src/policy.ts';
import {runOnce} from '../src/executor.ts';
import {verifyReceipt} from '../src/receipts.ts';

const key='0123456789abcdef0123456789abcdef';
const newStore=()=>new ActionStore(':memory:',key);
const input=(id='request-0001',tool:'lookup_customer'|'issue_refund'|'send_email'='lookup_customer',payload:Record<string,unknown>={customerId:'abc'})=>validateInput({requestId:id,requestedBy:'agent-a',tool,payload});

test('duplicate request ID replays existing action instead of creating another',()=>{
 const s=newStore();const first=s.create(input());const second=s.create(input());assert.equal(first.replay,false);assert.equal(second.replay,true);assert.equal(first.action.id,second.action.id);assert.equal(s.list().length,1);s.close();
});
test('reusing an idempotency key with a different payload returns conflict',()=>{
 const s=newStore();s.create(input());assert.throws(()=>s.create(input('request-0001','lookup_customer',{customerId:'different'})),Conflict);s.close();
});
test('a risky action requires independent review',()=>{
 const s=newStore();const a=s.create(input('refund-0001','issue_refund',{amountCents:5000})).action;
 assert.equal(a.status,'pending_approval');assert.throws(()=>s.decide(a.id,'agent-a',true),Denied);
 assert.equal(runOnce(s).processed,false);const approved=s.decide(a.id,'reviewer-b',true);assert.equal(approved.status,'ready');
 assert.equal(runOnce(s).action?.status,'succeeded');assert.equal(s.receipts(a.id).length,4);s.close();
});
test('rejection is terminal and does not execute a sensitive operation',()=>{
 const s=newStore();const a=s.create(input('refund-0002','issue_refund',{amountCents:100})).action;
 assert.equal(s.decide(a.id,'reviewer-b',false).status,'rejected');assert.equal(runOnce(s).processed,false);s.close();
});
test('simulated upstream timeout backs off and reaches a dead letter after 3 attempts',()=>{
 const s=newStore();const a=s.create(input('lookup-0003','lookup_customer',{simulateFailure:true})).action;
 let current=10000;let result=runOnce(s,current).action!;assert.equal(result.status,'retrying');assert.equal(result.next_attempt_at,11000);
 assert.equal(runOnce(s,10500).processed,false);
 result=runOnce(s,11000).action!;assert.equal(result.attempts,2);assert.equal(result.next_attempt_at,13000);
 result=runOnce(s,13000).action!;assert.equal(result.status,'dead_letter');assert.equal(result.attempts,3);s.close();
});
test('signed audit receipts verify; modified fields do not',()=>{
 const s=newStore();const a=s.create(input('audit-0001')).action;runOnce(s);
 assert.equal(s.verify(a.id),true);const receipt=s.receipts(a.id)[0];assert.equal(verifyReceipt({...receipt,actor:'intruder'},key),false);s.close();
});
test('status transitions are guarded against double approval',()=>{
 const s=newStore();const a=s.create(input('email-0001','send_email',{to:'example@example.com'})).action;
 s.decide(a.id,'reviewer-b',true);assert.throws(()=>s.decide(a.id,'reviewer-c',true),Conflict);s.close();
});
test('validation rejects unknown tool and malformed refund amount',()=>{
 assert.throws(()=>validateInput({requestId:'request-0001',requestedBy:'agent-a',tool:'delete_everything',payload:{}}));
 assert.throws(()=>input('refund-0001','issue_refund',{amountCents:0}));
});
