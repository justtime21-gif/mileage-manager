// 로그인 계정별 마일리지 상태를 공유 Supabase(mileage_states)에 저장·조회한다.
import { db, getUser, isConfigured } from './_auth.js';

const STATE_KEYS = ['clinics', 'transactions', 'rxDrugs', 'promoItems', 'appSettings', 'reportSnapshots'];
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function normalizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('state must be an object');
  const state = {};
  for (const key of STATE_KEYS) {
    if (!(key in input)) continue;
    const value = input[key];
    if (key === 'appSettings' || key === 'reportSnapshots') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${key} must be an object`);
      state[key] = value;
    } else {
      if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
      state[key] = value;
    }
  }
  if (!Array.isArray(state.clinics) || !Array.isArray(state.transactions)) {
    throw new Error('clinics and transactions are required');
  }
  return state;
}


export default async function handler(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!isConfigured()) return res.status(503).json({ error: 'Mileage server storage is not configured' });

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const client = db();
    if (req.method === 'GET') {
      const { data, error } = await client
        .from('mileage_states')
        .select('state,updated_at,mr_name')
        .eq('owner_user_id', user.userId)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({ state: data?.state || null, updatedAt: data?.updated_at || null, user });
    }

    const raw = JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return res.status(413).json({ error: '저장 데이터가 너무 큽니다.' });
    const state = normalizeState(req.body);
    const { data, error } = await client
      .from('mileage_states')
      .upsert({
        owner_user_id: user.userId,
        owner_email: user.email || null,
        mr_name: user.mrName || null,
        state,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_user_id' })
      .select('updated_at')
      .single();
    if (error) throw error;
    return res.status(200).json({ ok: true, updatedAt: data.updated_at });
  } catch (error) {
    console.error('[mileage-state]', error);
    return res.status(500).json({ error: error?.message || '마일리지 데이터를 저장하지 못했습니다.' });
  }
}
