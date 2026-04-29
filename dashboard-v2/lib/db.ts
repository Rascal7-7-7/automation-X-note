import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sql: NeonQueryFunction<false, false> | null = null;

function init(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _sql = neon(url);
  }
  return _sql;
}

// Proxy preserves neon's overload signatures while deferring connection until first query
export const sql: NeonQueryFunction<false, false> = new Proxy(init, {
  apply: (_t, _th, args: [TemplateStringsArray, ...unknown[]]) => init()(...args),
}) as unknown as NeonQueryFunction<false, false>;
