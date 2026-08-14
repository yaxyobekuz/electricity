import { pool } from '../src/db/pool.ts';
const r = await pool.query(
  `SELECT id, status, title_uz, left(coalesce(description,''), 70) d FROM fact.work ORDER BY status, id`);
for (const x of r.rows) console.log(`${String(x.id).padStart(4)} ${x.status.padEnd(10)} ${x.title_uz.slice(0,42).padEnd(44)} ${x.d}`);
await pool.end();
