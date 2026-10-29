import {Database} from '../../../packages/core/src/db.js';
import {Domain} from '../../../packages/core/src/domain.js';
import {configFromEnv} from '../../../packages/core/src/config.js';
import {publicApp,internalApp} from './app.js';
const cfg=configFromEnv(),db=new Database(cfg.databaseUrl),domain=new Domain(db,cfg);
const api=await publicApp(domain),internal=await internalApp(domain);
await api.listen({host:'0.0.0.0',port:Number(process.env.API_PORT??3000)});
await internal.listen({host:'0.0.0.0',port:Number(process.env.INTERNAL_PORT??3001)});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await Promise.all([api.close(),internal.close()]);await db.close();process.exit(0);});
