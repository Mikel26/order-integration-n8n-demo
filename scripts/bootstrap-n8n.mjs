import {writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const marker='/home/node/.n8n/demo-bootstrap-v1';
if(existsSync(marker) && process.env.FORCE_BOOTSTRAP!=='true'){console.log('Demo n8n ya inicializada; se conservan workflows y credenciales.');process.exit(0);}
const credentials=[
 {id:'demo-webhook-header',name:'Demo Webhook',type:'httpHeaderAuth',data:{name:'x-webhook-secret',value:process.env.WEBHOOK_SECRET}},
 {id:'demo-internal-header',name:'Demo Internal API',type:'httpHeaderAuth',data:{name:'x-internal-secret',value:process.env.INTERNAL_SECRET}},
 {id:'demo-erp-header',name:'Demo ERP API',type:'httpHeaderAuth',data:{name:'x-erp-secret',value:process.env.ERP_SECRET}},
];
if(credentials.some(c=>!c.data.value))throw new Error('Faltan secretos para las credenciales de n8n');
const path='/tmp/demo-credentials.json';writeFileSync(path,JSON.stringify(credentials),{mode:0o600});
function run(args){const result=spawnSync('n8n',args,{stdio:'inherit'});if(result.status!==0)throw new Error(`n8n ${args[0]} falló`);}
try{
 run(['import:credentials',`--input=${path}`]);
 run(['import:workflow','--input=/opt/demo/workflows/order-import-error-handler.json']);
 run(['import:workflow','--input=/opt/demo/workflows/order-import-main.json']);
 run(['publish:workflow','--id=orderImportErrors']);
 run(['publish:workflow','--id=orderImportMain']);
 writeFileSync(marker,new Date().toISOString(),{mode:0o600});
}finally{unlinkSync(path);}
