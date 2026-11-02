import {ActionStore} from './store.ts';
import type {Action} from './store.ts';

// Safety: this is intentionally a SIMULATOR. It never sends mail or issues refunds.
export function simulateTool(a:Action): {ok:boolean;error?:string;result?:unknown} {
  const payload=JSON.parse(a.payload_json);
  if(payload.simulateFailure===true) return {ok:false,error:'Simulated upstream provider timeout'};
  switch(a.tool){
    case 'lookup_customer': return {ok:true,result:{customerId:payload.customerId??'sample-customer',found:true}};
    case 'issue_refund': return {ok:true,result:{simulated:true,refundCents:payload.amountCents}};
    case 'send_email': return {ok:true,result:{simulated:true,to:payload.to}};
    default: return {ok:false,error:'No adapter for tool'};
  }
}
export function runOnce(store:ActionStore, now=Date.now()):{processed:boolean;action?:Action} {
  const a=store.claimReady(now);if(!a)return {processed:false};
  const result=simulateTool(a);
  return {processed:true,action:store.complete(a.id,result.ok?undefined:result.error,now)};
}
