// Dependency-free, same-origin workbench. Kept separate from the React/Vite UI.
const $ = id => document.getElementById(id);
const states={ready:'Ready',pending_approval:'Needs review',rejected:'Rejected',running:'Running',succeeded:'Completed',retrying:'Retry scheduled',dead_letter:'Dead letter'};
const agentHeaders={'content-type':'application/json','x-demo-role':'agent','x-demo-actor':'agent-a'};
const reviewerHeaders={'x-demo-role':'reviewer','x-demo-actor':'reviewer-b'};
let actions=[];let selected=null;let busy=false;
const el=(tag,cls='',text='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n};
function note(message){$('notice').textContent=message;$('notice').hidden=!message}
async function api(path, init){const res=await fetch(path,init);const data=await res.json();if(!res.ok)throw Error(data.error||`HTTP ${res.status}`);return data}
function setBusy(next){busy=next;for(const id of ['create','run','refresh'])$(id).disabled=next}
function createState(s){return el('span',`state ${s}`,states[s]||s)}
async function refresh(){
  const data=await api('/actions');actions=data.actions;
  $('total').textContent=String(actions.length);
  $('pending').textContent=String(actions.filter(a=>a.status==='pending_approval').length);
  $('failed').textContent=String(actions.filter(a=>a.status==='dead_letter').length);
  const list=$('actions');list.replaceChildren();
  if(!actions.length){const empty=el('div','empty');empty.append(el('strong','','No actions yet'),el('p','','Create a test request from the control panel.'));list.append(empty)}
  for(const a of actions){
    const b=el('button','action'+(selected===a.id?' selected':''));b.type='button';b.dataset.actionId=String(a.id);
    const info=el('div');info.append(el('strong','',a.tool.replaceAll('_',' ')),el('small','',`#${a.id} · ${a.requested_by} · ${new Date(a.created_at).toLocaleString()}`));
    b.append(info,createState(a.status));b.addEventListener('click',()=>select(a.id));list.append(b)
  }
  if(selected!==null){if(actions.some(a=>a.id===selected))await renderDetail(selected);else selected=null}
}
async function select(id){selected=id;await refresh()}
function addRow(dl,key,value){dl.append(el('dt','',key),el('dd','',String(value)))}
async function renderDetail(id){
  const data=await api(`/actions/${id}/receipts`);const a=actions.find(x=>x.id===id);if(!a)return;
  const d=$('detail');d.replaceChildren();d.append(createState(a.status));
  const dl=el('dl');addRow(dl,'Request ID',a.request_id);addRow(dl,'Attempts',a.attempts);if(a.reviewer)addRow(dl,'Reviewer',a.reviewer);if(a.error)addRow(dl,'Last error',a.error);d.append(dl);
  if(a.status==='pending_approval'){
    const buttons=el('div','buttons');
    for(const [label,decision] of [['Approve','approve'],['Reject','reject']]){
      const b=el('button',decision==='reject'?'secondary':'',label);b.type='button';b.disabled=busy;b.addEventListener('click',()=>operate(`/actions/${id}/${decision}`,reviewerHeaders));buttons.append(b)
    }d.append(buttons)
  }
  const r=el('div','receipts');const head=el('div','receipt-head','Signed transitions');const ver=el('span','',data.validSignatures?'✓ Verified':'⚠ Invalid');head.append(ver);r.append(head);
  for(const item of data.receipts){const x=el('div','receipt');x.append(el('b','',`#${item.sequence} · ${item.to}`),el('small','',`${item.actor} · ${new Date(item.timestamp).toLocaleTimeString()}`),el('code','',`${item.signature.slice(0,17)}…`));r.append(x)}
  d.append(r)
}
async function operate(path,headers={},body){if(busy)return;setBusy(true);note('');try{const d=await api(path,{method:'POST',headers,body:body?JSON.stringify(body):undefined});if(d.action?.id)selected=d.action.id;await refresh();note(d.replay?'Idempotent replay: no duplicate action was created.':d.processed===false?'No action is ready for execution.':'Operation recorded.')}catch(e){note(e.message)}finally{setBusy(false)}}
$('create').addEventListener('click',()=>{
  const tool=$('tool').value;
  const payload=tool==='issue_refund'?{amountCents:1200,orderId:'order-123'}:tool==='send_email'?{to:'sample@example.com',subject:'Demo'}:{customerId:'customer-42'};
  if($('failure').checked)payload.simulateFailure=true;
  const requestId=$('request-id').value.trim()||`demo-${Date.now()}-${Math.floor(Math.random()*100000)}`;
  operate('/actions',agentHeaders,{requestId,requestedBy:'agent-a',tool,payload});
});
$('run').addEventListener('click',()=>operate('/worker/run-once'));
$('refresh').addEventListener('click',()=>{refresh().catch(e=>note(e.message))});
refresh().catch(e=>note(e.message));
