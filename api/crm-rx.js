// CRM(mr-crm)의 거래처별 처방량을 가져오는 프록시.
// SYNC_API_KEY는 공유 시크릿이라 브라우저에 노출할 수 없고, CRM에는 CORS 설정이 없어
// 다른 도메인에서 직접 호출도 막힌다. 그래서 이 서버를 경유한다 (api/ocr.js와 같은 구조).

// 시트 헤더 문자열 → 보험코드. 원본: mr-crm/src/components/OcrSheetEntry.tsx의 DRUG_COLS.
// 공백을 지운 뒤 부분 포함으로 찾으므로 긴 키를 먼저 둔다 (클로르헥시딘 15/100 구분).
const COL_TO_CODE = [
  ['클로르헥시딘100', '053500191'],
  ['클로르헥시딘15', '053500193'],
  ['에스오메프라졸', '053500210'],
  ['아세클로페낙', '053500180'],
  ['아세클로페나', '053500180'],
  ['아목시클라', '053500060'],
  ['아목시스', '053500080'],
  ['세파클리', '053500040'],
  ['록소리펜', '053500050'],
  ['나프록소', '053500020'],
  ['모사프리', '053500100'],
  ['알마펜', '053500090'],
];

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const syncKey = String(process.env.SYNC_API_KEY || '').trim();
  const crmUrl = String(process.env.CRM_URL || 'https://mr-crm-hq8c.vercel.app').trim().replace(/\/+$/, '');
  if (!syncKey) {
    return res.status(503).json({ error: 'CRM 연동 설정(SYNC_API_KEY)이 서버에 없습니다. Vercel 환경변수를 확인하세요.' });
  }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const clinicName = String(params.get('clinicName') || '').trim();
  // CRM은 "5월,6월" 형식만 받고 최대 4개까지 쓴다.
  const months = String(params.get('months') || '')
    .split(',').map(m => m.trim()).filter(m => /^([1-9]|1[0-2])월$/.test(m)).slice(0, 4);
  if (!clinicName) return res.status(400).json({ error: '거래선을 선택하세요.' });
  if (!months.length) return res.status(400).json({ error: '처방 기간을 먼저 입력하세요.' });

  try {
    const query = new URLSearchParams({ months: months.join(','), clientName: clinicName });
    const r = await fetch(`${crmUrl}/api/sheets/collected?${query}`, {
      headers: { 'x-sync-key': syncKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const message = r.status === 401
        ? 'CRM 인증에 실패했습니다. SYNC_API_KEY가 CRM과 같은 값인지 확인하세요.'
        : json.error || 'CRM에서 처방량을 불러오지 못했습니다.';
      return res.status(r.status).json({ error: message });
    }
    return res.status(200).json(summarize(json.monthlyOwnProducts || [], months));
  } catch (e) {
    const message = e.name === 'TimeoutError'
      ? 'CRM 응답이 너무 늦습니다. 잠시 후 다시 시도하세요.'
      : e.message || 'CRM 조회 중 오류';
    return res.status(502).json({ error: message });
  }
};

// 월별 자사품목 수량을 보험코드 기준으로 합산한다.
// 매핑하지 못한 컬럼은 버리지 않고 unmatched로 돌려준다 — 조용히 빠지면 처방량이
// 실제보다 적게 들어가고 아무도 알아채지 못한다.
function summarize(monthlyOwnProducts, requestedMonths) {
  const totals = new Map();   // code → { code, label, qty }
  const byMonth = {};
  const unmatched = new Map();
  const foundMonths = new Set();

  monthlyOwnProducts.forEach(entry => {
    const month = String(entry.month || '');
    (entry.products || []).forEach(product => {
      const name = String(product.name || '').trim();
      const qty = Number(product.quantity) || 0;
      if (!name || qty <= 0) return;
      const code = codeFromHeader(name);
      if (!code) {
        unmatched.set(name, (unmatched.get(name) || 0) + qty);
        return;
      }
      foundMonths.add(month);
      const prev = totals.get(code);
      if (prev) prev.qty += qty;
      else totals.set(code, { code, label: name, qty });
      byMonth[month] = byMonth[month] || {};
      byMonth[month][code] = (byMonth[month][code] || 0) + qty;
    });
  });

  return {
    requestedMonths,
    months: [...foundMonths],
    items: [...totals.values()].sort((a, b) => b.qty - a.qty),
    byMonth,
    unmatched: [...unmatched.entries()].map(([name, quantity]) => ({ name, quantity })),
  };
}

function codeFromHeader(header) {
  const normalized = header.replace(/\s+/g, '');
  const hit = COL_TO_CODE.find(([keyword]) => normalized.includes(keyword));
  return hit ? hit[1] : '';
}

module.exports.summarize = summarize;
