import pg from 'pg';
export type Tx = pg.PoolClient;
export class Database {
 readonly pool: pg.Pool;
 constructor(url: string) { this.pool=new pg.Pool({connectionString:url,max:5,connectionTimeoutMillis:3000}); this.pool.on('error',error=>console.error(JSON.stringify({event:'database_idle_connection_error',code:(error as {code?:string}).code??'CONNECTION_ERROR'}))); }
 async tx<T>(fn:(tx:Tx)=>Promise<T>):Promise<T> {
  const client=await this.pool.connect();
  try { await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='2000ms'"); await client.query("SET LOCAL lock_timeout='1000ms'");
   const result=await fn(client); await client.query('COMMIT'); return result;
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
 }
 async close() {await this.pool.end();}
}
export class AppError extends Error { constructor(public statusCode:number,public code:string,message:string) {super(message);} }
export const missing = () => new AppError(404,'NOT_FOUND','Recurso no encontrado');
