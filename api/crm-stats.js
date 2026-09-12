// 거래처 한 곳의 월별 자사 품목 처방량을 mr-crm 처방통계 시트에서 읽어 온다(읽기 전용). 마일리지 적립 입력의 수량 자동 채우기용.
import { db, getUser, isConfigured } from './_auth.js';

const MAX_MONTHS = 4;

function crmConfig() {
  const base = String(process.env.MR_CRM_BASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.MR_CRM_SYNC_KEY || '').trim();
  return base && key ? { base, key } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isConfigured()) return res.status(503).json({ error: 'CRM 연동이 설정되지 않았습니다.' });
  const crm = crmConfig();
  if (!crm) return res.status(503).json({ error: '처방통계 연동이 설정되지 않았습니다. (MR_CRM_BASE_URL·MR_CRM_SYNC_KEY)' });

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    if (!user.mrName) return res.status(409).json({ error: 'CRM에 담당자 프로필이 없어 처방통계를 불러올 수 없습니다.' });

    const url = new URL(req.url, 'http://localhost');
    const clientCode = String(url.searchParams.get('clientCode') || '').trim();
    const months = String(url.searchParams.get('months') || '')
      .split(',').map((m) => m.trim()).filter((m) => /^([1-9]|1[0-2])월$/.test(m)).slice(0, MAX_MONTHS);
    if (!clientCode) return res.status(400).json({ error: '거래처코드가 필요합니다. 먼저 CRM 대조로 코드를 붙여 주세요.' });
    if (!months.length) return res.status(400).json({ error: '조회할 월이 필요합니다. (예: 6월,7월)' });

    // 남의 거래처 통계를 못 읽게, 요청한 코드가 내 담당인지 공유 Supabase에서 먼저 확인한다.
    const { data: owned, error: ownedError } = await db()
      .from('clients').select('name,client_code').eq('mr_name', user.mrName).eq('client_code', clientCode).maybeSingle();
    if (ownedError) throw ownedError;
    if (!owned) return res.status(403).json({ error: '내 담당 거래처가 아닙니다.' });

    const target = new URL(`${crm.base}/api/sheets/collected`);
    target.searchParams.set('months', months.join(','));
    target.searchParams.set('clientCode', clientCode);
    target.searchParams.set('clientName', String(owned.name || ''));

    const response = await fetch(target, { headers: { 'x-sync-key': crm.key } });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: json?.error || `처방통계 조회 실패 (${response.status})` });
    }

    // 시트에 그 달 행이 없으면 빈 배열이다. 조회 실패(502)와 구별되어야 하므로 빈 배열을 에러로 바꾸지 않는다.
    return res.status(200).json({
      clientCode,
      clientName: owned.name || '',
      months,
      monthlyOwnProducts: Array.isArray(json.monthlyOwnProducts) ? json.monthlyOwnProducts : [],
    });
  } catch (error) {
    console.error('[crm-stats]', error);
    return res.status(500).json({ error: error?.message || '처방통계를 불러오지 못했습니다.' });
  }
}
