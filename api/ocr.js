// 클로바 OCR(General) 프록시 — CRM(mr-crm)의 회전보정 알고리즘을 이식
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // CRM 환경변수 이름 우선, 마일리지 앱 이름 fallback
  const secret = process.env.CLOVA_OCR_SECRET_KEY || process.env.CLOVA_OCR_SECRET;
  const url = process.env.CLOVA_OCR_INVOKE_URL || process.env.CLOVA_OCR_URL;
  if (!secret || !url) return res.status(500).json({ error: 'OCR 서버 환경변수(CLOVA_OCR_SECRET_KEY, CLOVA_OCR_INVOKE_URL)가 설정되지 않았습니다.' });

  const { images } = req.body || {};
  if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: '이미지가 없습니다.' });

  try {
    const body = {
      version: 'V2',
      requestId: String(Date.now()),
      timestamp: Date.now(),
      lang: 'ko',
      images: images.map((img, i) => ({ format: img.format || 'jpg', name: `page${i}`, data: img.data })),
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const json = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: json.message || 'OCR 요청 실패' });

    const text = (json.images || []).map(im => fieldsToText(im.fields || [])).join('\n\n');
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message || 'OCR 처리 중 오류' });
  }
};

// CRM lib/ocr.ts 알고리즘 이식:
// 기울어진 사진은 같은 줄의 글자도 y가 벌어져 행이 섞인다.
// 상단 변의 기울기 중앙값으로 회전각을 구해 좌표만 역회전시킨 뒤 행 병합.
function fieldsToText(fields) {
  if (!fields.length) return '';

  // 회전각 추정 (중앙값)
  const angles = fields
    .map(f => f.boundingPoly.vertices)
    .filter(v => v.length >= 2)
    .map(v => Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x))
    .sort((a, b) => a - b);
  const angle = angles.length >= 3 ? angles[Math.floor(angles.length / 2)] : 0;

  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  function rotate(x, y) {
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  }

  const items = fields.map(f => {
    const pts = f.boundingPoly.vertices.map(v => rotate(v.x, v.y));
    const ys = pts.map(p => p.y);
    const xs = pts.map(p => p.x);
    return {
      text: f.inferText,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      h: Math.max(...ys) - Math.min(...ys),
    };
  });
  items.sort((a, b) => a.y - b.y);

  // 행 병합
  const rows = [];
  for (const it of items) {
    const row = rows.find(r => Math.abs(r.y - it.y) < it.h * 0.6);
    if (row) {
      row.items.push(it);
      row.y = row.items.reduce((s, i) => s + i.y, 0) / row.items.length;
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }

  // 고립된 숫자 토큰(4자리+)을 가장 가까운 행에 흡수
  const merged = [];
  for (const row of rows) {
    const text = row.items.map(i => i.text).join('');
    const isIsolated = row.items.length === 1 && /^\d{4,}$/.test(text);
    if (isIsolated && merged.length) {
      let nearest = merged[0];
      for (const m of merged) {
        if (Math.abs(m.y - row.y) < Math.abs(nearest.y - row.y)) nearest = m;
      }
      nearest.items.push(...row.items);
      nearest.y = nearest.items.reduce((s, i) => s + i.y, 0) / nearest.items.length;
    } else {
      merged.push(row);
    }
  }

  return merged
    .sort((a, b) => a.y - b.y)
    .map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.text).join(' '))
    .join('\n');
}
