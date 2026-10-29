import {Domain} from '../../../packages/core/src/domain.js';
import {server,authorize,uuidSchema,idParams} from '../../../packages/core/src/http.js';
import {PRODUCTS} from '../../../packages/contracts/src/index.js';
import {missing} from '../../../packages/core/src/db.js';
export async function erpApp(domain:Domain,logger=true) {
 const app=server(logger);app.addHook('onRequest',async req=>authorize(req.headers['x-erp-secret'],domain.cfg.erpSecret));
 app.get('/health',async()=>{await domain.db.pool.query('SELECT 1');return {status:'ok'};});
 app.post<{Body:{schemaVersion:1;operationId:string;attemptToken:string;externalOrderId:string;source:'PORTFOLIO_WEB';lines:{productCode:string;units:number}[]}}>('/internal/erp/order-imports',{schema:{body:{type:'object',additionalProperties:false,required:['schemaVersion','operationId','attemptToken','externalOrderId','source','lines'],properties:{schemaVersion:{const:1},operationId:uuidSchema,attemptToken:uuidSchema,externalOrderId:{type:'string',minLength:1,maxLength:64},source:{const:'PORTFOLIO_WEB'},lines:{type:'array',minItems:1,maxItems:3,items:{type:'object',additionalProperties:false,required:['productCode','units'],properties:{productCode:{type:'string',enum:PRODUCTS.map(p=>p.sku)},units:{type:'integer',minimum:1,maximum:10}}}}}}}},async(req,reply)=>{
  const b=req.body;const result=await domain.processErp(b.operationId,b.attemptToken,{clientOrderId:b.externalOrderId,items:b.lines.map(l=>({sku:l.productCode,quantity:l.units}))});
  return reply.code(result.created?201:200).send(result.receipt);
 });
 app.get<{Params:{id:string}}>('/internal/erp/order-imports/by-operation/:id',{schema:{params:idParams}},async req=>{const r=(await domain.db.pool.query('SELECT * FROM erp_receipts WHERE operation_id=$1',[req.params.id])).rows[0];if(!r)throw missing();return domain.receiptJson(r);});
 return app;
}
