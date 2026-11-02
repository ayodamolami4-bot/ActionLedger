import {createServer} from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, dirname} from 'node:path';
import {ActionStore, Conflict, Denied, NotFound} from './store.ts';
import {validateInput} from './policy.ts';
import {runOnce} from './executor.ts';

const port=Number(process.env.PORT??4400);
const projectRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const staticFiles=new Map([
  ['/console',{path:'standalone.html',type:'text/html; charset=utf-8'}],
  ['/console.css',{path:'src/styles.css',type:'text/css; charset=utf-8'}],
  ['/console.js',{path:'standalone.js',type:'text/javascript; charset=utf-8'}]
]);
const secret=process.env.RECEIPT_SECRET??randomBytes(32).toString('hex');
const store=new ActionStore(process.env.DB_PATH??'./actions.sqlite',secret);
if(!process.env.RECEIPT_SECRET)console.warn('Using an ephemeral receipt key. Set RECEIPT_SECRET to verify receipts across restarts.');
function respond(res:ServerResponse,code:number,data:unknown){res.writeHead(code,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'http://localhost:5173','access-control-allow-headers':'content-type,x-demo-role,x-demo-actor','access-control-allow-methods':'GET,POST,OPTIONS','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function body(req:IncomingMessage):Promise<unknown>{
  let size=0;const parts:Buffer[]=[];
  for await(const chunk of req){size+=chunk.length;if(size>16_384)throw new Error('Payload exceeds 16 KB');parts.push(chunk);}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
function actor(req:IncomingMessage,role:'agent'|'reviewer'){
  // This header is for local demonstrations only, NOT production authentication.
  if(req.headers['x-demo-role']!==role)throw new Denied(`Expected x-demo-role: ${role}`);
  const v=req.headers['x-demo-actor'];if(typeof v!=='string'||!v.trim())throw new Denied('Missing x-demo-actor');return v;
}
const server=createServer(async(req,res)=>{
  if(req.method==='OPTIONS')return respond(res,204,{});
  try{
    const path=new URL(req.url??'/',`http://localhost:${port}`).pathname;
    if(req.method==='GET' && path==='/'){res.writeHead(302,{location:'/console','cache-control':'no-store'});res.end();return;}
    if(req.method==='GET' && staticFiles.has(path)){
      const item=staticFiles.get(path)!;
      res.writeHead(200,{'content-type':item.type,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'"});
      res.end(readFileSync(join(projectRoot,'web',item.path)));
      return;
    }
    if(req.method==='GET' && path==='/health')return respond(res,200,{ok:true,service:'actionledger',mode:'simulation'});
    if(req.method==='GET' && path==='/metrics')return respond(res,200,{byStatus:store.counts()});
    if(req.method==='GET' && path==='/actions')return respond(res,200,{actions:store.list()});
    if(req.method==='POST' && path==='/actions'){
      const requester=actor(req,'agent'); const input=validateInput(await body(req));
      if(input.requestedBy!==requester)throw new Denied('Actor does not match requestedBy');
      const {action,replay}=store.create(input);return respond(res,replay?200:201,{action,replay});
    }
    const m=path.match(/^\/actions\/(\d+)(?:\/(approve|reject|receipts))?$/);
    if(m){const id=Number(m[1]),op=m[2];
      if(req.method==='GET'&&!op)return respond(res,200,{action:store.get(id)});
      if(req.method==='GET'&&op==='receipts')return respond(res,200,{receipts:store.receipts(id),validSignatures:store.verify(id)});
      if(req.method==='POST'&&(op==='approve'||op==='reject'))return respond(res,200,{action:store.decide(id,actor(req,'reviewer'),op==='approve')});
    }
    if(req.method==='POST' && path==='/worker/run-once')return respond(res,200,runOnce(store));
    return respond(res,404,{error:'Route not found'});
  }catch(e){const msg=e instanceof Error?e.message:'Unknown error';const status=e instanceof Conflict?409:e instanceof Denied?403:e instanceof NotFound?404:400;return respond(res,status,{error:msg});}
});
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
server.listen(port,'127.0.0.1',()=>console.log(`ActionLedger demo API: http://127.0.0.1:${port}`));
process.on('SIGINT',()=>{server.close();store.close();process.exit(0);});
