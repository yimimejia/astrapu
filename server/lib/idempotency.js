import { get, run } from '../db/connection.js';

export async function withIdempotency({ scope, key, refId = null, work }) {
  if (!key) return work();
  const existing = await get('SELECT response_payload FROM idempotency_keys WHERE id = ? AND scope = ?', [key, scope]);
  if (existing) return JSON.parse(existing.response_payload);
  const result = await work();
  await run('INSERT INTO idempotency_keys(id, scope, ref_id, response_payload) VALUES(?,?,?,?)', [key, scope, refId, JSON.stringify(result)]);
  return result;
}
