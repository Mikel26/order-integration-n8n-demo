import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.DEMO_API_URL??'http://localhost:3000';
const origin=process.env.PUBLIC_ORIGIN??'http://localhost:4200';
const session=await fetch(`${base}/api/demo-sessions`,{method:'POST',headers:{origin}});
assert.ok(session.ok,`Sesión: ${session.status}`);
const cookie=session.headers.getSetCookie()[0].split(';')[0];
const headers={origin,cookie,'content-type':'application/json'};
async function send(body,key=randomUUID()) {
 const response=await fetch(`${base}/api/orders`,{method:'POST',headers:{...headers,'idempotency-key':key},body:JSON.stringify(body)});
 assert.equal(response.status,202);const accepted=await response.json();
 for(let i=0;i<60;i++){
  const r=await fetch(`${base}${accepted.statusUrl}`,{headers:{cookie}});assert.ok(r.ok,`Polling: ${r.status}`);const operation=await r.json();
  if(['SUCCEEDED','REJECTED','DUPLICATE','FAILED_TECHNICAL'].includes(operation.status))return operation;
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
 throw new Error('La operación no terminó a tiempo');
}
const body={clientOrderId:'WEB-SMOKE',items:[{sku:'DEMO-001',quantity:2},{sku:'DEMO-002',quantity:1}]};
const valid=await send(body);assert.equal(valid.status,'SUCCEEDED');
const insufficient=await send({clientOrderId:'WEB-STOCK',items:[{sku:'DEMO-003',quantity:3}]});assert.equal(insufficient.status,'REJECTED');assert.equal(insufficient.result.code,'INSUFFICIENT_STOCK');
const duplicate=await send(body);assert.equal(duplicate.status,'DUPLICATE');assert.equal(duplicate.result.orderId,valid.result.orderId);
const stock=await (await fetch(`${base}/api/stock`,{headers:{cookie}})).json();assert.deepEqual(stock.items.map(i=>i.available),[3,2,2]);
console.log(JSON.stringify({scenarios:[valid.status,insufficient.status,duplicate.status],stock:stock.items.map(i=>({sku:i.sku,available:i.available})),workflow:'n8n real'},null,2));
