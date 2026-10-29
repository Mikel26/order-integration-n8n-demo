export interface Config {
 databaseUrl: string; publicOrigin: string; internalSecret: string; erpSecret: string;
 webhookSecret: string; webhookUrl: string; cookieSecure: boolean;
 sessionTtlMs: number; operationDeadlineMs: number; leaseMs: number; maxActive: number;
}
export function configFromEnv(): Config {
 const required = (name:string) => { const v=process.env[name]; if(!v) throw new Error(`Falta ${name}`); return v; };
 return {databaseUrl:required('DATABASE_URL'),publicOrigin:process.env.PUBLIC_ORIGIN ?? 'http://localhost:4200',
 internalSecret:required('INTERNAL_SECRET'),erpSecret:required('ERP_SECRET'),webhookSecret:required('WEBHOOK_SECRET'),
 webhookUrl:process.env.N8N_WEBHOOK_URL ?? 'http://localhost:5678/webhook/order-import',cookieSecure:process.env.COOKIE_SECURE === 'true',
 sessionTtlMs:30*60_000,operationDeadlineMs:120_000,leaseMs:30_000,maxActive:10};
}
