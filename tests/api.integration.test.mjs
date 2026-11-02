import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';

async function freePort(){
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

// A Windows process can hold the SQLite WAL -shm file until the child has exited.
// Wait for process termination before removing the temporary database directory.
async function stopAndClean(proc,tmp){
  if(proc.exitCode===null && proc.signalCode===null){
    const closed=once(proc,'close');
    proc.kill();
    await closed;
  }
  rmSync(tmp,{recursive:true,force:true,maxRetries:15,retryDelay:100});
}

async function launch(){
  const tmp=mkdtempSync(join(tmpdir(),'actionledger-api-'));
  const port=await freePort();
  const proc=spawn(process.execPath,['--no-warnings','--experimental-strip-types','src/server.ts'],{
    cwd:process.cwd(), env:{...process.env,PORT:String(port),DB_PATH:join(tmp,'demo.sqlite'),RECEIPT_SECRET:'api-test-secret'},stdio:'ignore'
  });
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;attempt<120;attempt++){
    if(proc.exitCode!==null)throw Error(`Server exited: ${proc.exitCode}`);
    try{const r=await fetch(base+'/health');if(r.ok)return {proc,tmp,base}}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  await stopAndClean(proc,tmp);throw Error('Server did not become ready');
}
async function call(base,path,{method='GET',role,actor,body}={}){
  const headers={};if(role)headers['x-demo-role']=role;if(actor)headers['x-demo-actor']=actor;
  if(body!==undefined)headers['content-type']='application/json';
  const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}

test('HTTP lifecycle: create, independent approve, simulate execution, receipts, dedupe, conflict, rejection',async()=>{
  const {proc,tmp,base}=await launch();
  try{
    const landing=await fetch(base+'/');assert.equal(landing.status,200);assert.equal(new URL(landing.url).pathname,'/console');
    const html=await fetch(base+'/console');assert.equal(html.status,200);assert.match(await html.text(),/Every action has a boundary/);
    const js=await fetch(base+'/console.js');assert.equal(js.status,200);assert.match(await js.text(),/Idempotent replay/);
    const css=await fetch(base+'/console.css');assert.equal(css.status,200);assert.match(await css.text(),/\.sidebar/);
    const input={requestId:'demo-refund-0001',requestedBy:'agent-a',tool:'issue_refund',payload:{amountCents:1200,orderId:'demo-order'}};
    assert.equal((await call(base,'/actions',{method:'POST',body:input})).status,403);
    const made=await call(base,'/actions',{method:'POST',role:'agent',actor:'agent-a',body:input});
    assert.equal(made.status,201);assert.equal(made.data.action.status,'pending_approval');
    const id=made.data.action.id;
    const self=await call(base,`/actions/${id}/approve`,{method:'POST',role:'reviewer',actor:'agent-a'});assert.equal(self.status,403);
    const approval=await call(base,`/actions/${id}/approve`,{method:'POST',role:'reviewer',actor:'reviewer-b'});assert.equal(approval.status,200);assert.equal(approval.data.action.status,'ready');
    const run=await call(base,'/worker/run-once',{method:'POST'});assert.equal(run.status,200);assert.equal(run.data.action.status,'succeeded');
    const receipt=await call(base,`/actions/${id}/receipts`);assert.equal(receipt.status,200);assert.equal(receipt.data.validSignatures,true);assert.equal(receipt.data.receipts.length,4);
    const replay=await call(base,'/actions',{method:'POST',role:'agent',actor:'agent-a',body:input});assert.equal(replay.status,200);assert.equal(replay.data.replay,true);assert.equal(replay.data.action.id,id);
    const conflict=await call(base,'/actions',{method:'POST',role:'agent',actor:'agent-a',body:{...input,payload:{amountCents:1300,orderId:'demo-order'}}});assert.equal(conflict.status,409);
    const rejected=await call(base,'/actions',{method:'POST',role:'agent',actor:'agent-a',body:{...input,requestId:'demo-refund-0002'}});
    const denial=await call(base,`/actions/${rejected.data.action.id}/reject`,{method:'POST',role:'reviewer',actor:'reviewer-b'});assert.equal(denial.data.action.status,'rejected');
    const list=await call(base,'/actions');assert.equal(list.data.actions.length,2);
    const metrics=await call(base,'/metrics');assert.equal(metrics.data.byStatus.succeeded,1);assert.equal(metrics.data.byStatus.rejected,1);
  }finally{await stopAndClean(proc,tmp)}
});
