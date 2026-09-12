// mr-crm·ERP가 공유하는 Supabase `clients`에서 로그인 담당자의 거래처만 읽어 내려준다. 읽기 전용 — CRM에 아무것도 쓰지 않는다.
import { db, getUser, isConfigured } from './_auth.js';

const COLUMNS = 'id,name,client_code,branch,region,address,phone,mr_name,type';
const PAGE = 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isConfigured()) return res.status(503).json({ error: 'CRM 연동이 설정되지 않았습니다.' });

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    // mr_profiles에 이메일이 없으면 담당자명을 모른다. 빈 문자열로 조회하면 필터가 풀려 남의 거래처가 나가므로 여기서 막는다.
    if (!user.mrName) {
      return res.status(409).json({ error: 'CRM에 담당자 프로필이 없어 거래처를 불러올 수 없습니다. mr-crm 관리자에게 mr_profiles 등록을 요청하세요.', user });
    }

    const client = db();
    const items = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('clients')
        .select(COLUMNS)
        .eq('mr_name', user.mrName)
        .order('name')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      items.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE) break;
    }

    return res.status(200).json({ items, mrName: user.mrName, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[crm-clients]', error);
    return res.status(500).json({ error: error?.message || 'CRM 거래처를 불러오지 못했습니다.' });
  }
}
