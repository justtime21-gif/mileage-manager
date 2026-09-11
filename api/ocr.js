// 클로바 OCR(General) 프록시 — CRM(mr-crm)의 회전보정 알고리즘을 이식
export default async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // CRM 환경변수 이름 우선, 마일리지 앱 이름 fallback
  const rawSecret = process.env.CLOVA_OCR_SECRET_KEY || process.env.CLOVA_OCR_SECRET;
  const rawUrl = process.env.CLOVA_OCR_INVOKE_URL || process.env.CLOVA_OCR_URL;
  if (!rawSecret || !rawUrl) return res.status(500).json({ error: 'OCR 서버 환경변수(CLOVA_OCR_SECRET_KEY, CLOVA_OCR_INVOKE_URL)가 설정되지 않았습니다.' });

  // 시크릿에 따옴표·줄바꿈·공백이 섞이면 fetch 헤더 검증이 실패하며
  // "The string did not match the expected pattern"만 던진다. URL과 동일하게 정리·검증한다.
  const secret = String(rawSecret).trim().replace(/^['"]|['"]$/g, '');
  if (!/^[\x21-\x7e]+$/.test(secret)) {
    return res.status(500).json({
      error: 'OCR 시크릿 설정이 올바르지 않습니다. Vercel의 CLOVA_OCR_SECRET_KEY에 Secret Key만 따옴표·줄바꿈 없이 다시 저장해 주세요.',
    });
  }

  // Vercel 환경변수에 따옴표, 공백 또는 안내 문구가 함께 저장되면 fetch가
  // "The string did not match the expected pattern"만 반환한다. 실제 주소는
  // 절대 응답에 포함하지 않고, 관리자에게 수정할 항목만 안내한다.
  const url = String(rawUrl).trim().replace(/^['\"]|['\"]$/g, '');
  try {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:') throw new Error('non-https');
  } catch {
    return res.status(500).json({
      error: 'OCR 호출 주소 설정이 올바르지 않습니다. Vercel의 CLOVA_OCR_INVOKE_URL에 CLOVA OCR Invoke URL 전체(https://로 시작)를 따옴표 없이 다시 저장해 주세요.',
    });
  }

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

    const pages = (json.images || []).map(im => fieldsToRows(im.fields || []));
    const lines = pages.flat();
    res.status(200).json({ text: pages.map(rows => rows.join('\n')).join('\n\n'), lines });
  } catch (e) {
    // fetch가 헤더/URL 형식으로 실패하면 원인 없는 짧은 메시지만 남는다.
    // 실제 값은 노출하지 않고 어느 환경변수를 고쳐야 하는지만 안내한다.
    const msg = e.message || 'OCR 처리 중 오류';
    if (/did not match|Invalid|Failed to parse/i.test(msg)) {
      return res.status(500).json({
        error: `OCR 호출 설정이 올바르지 않습니다 (${msg}). Vercel의 CLOVA_OCR_INVOKE_URL과 CLOVA_OCR_SECRET_KEY를 따옴표·줄바꿈·앞뒤 공백 없이 다시 저장한 뒤 Redeploy 해주세요.`,
      });
    }
    res.status(500).json({ error: msg });
  }
};

// mr-crm `src/lib/ocr.ts`의 analyzeImageRows 이식.
function fieldsToRows(fields) {
  if (!fields.length) return [];

  // 사진이 기울어 찍히면 같은 줄의 글자도 오른쪽으로 갈수록 y가 벌어져 옆 줄과 섞인다.
  // Clova는 글자마다 4개 꼭짓점(시계방향 TL,TR,BR,BL)을 주므로, 상단 변의 기울기 중앙값으로
  // 페이지 회전각을 구해 좌표만 역회전시킨다 — 이미지 자체를 돌리는 것보다 가볍다.
  const angles = fields
    .map(f => f.boundingPoly.vertices)
    .filter(v => v.length >= 2)
    .map(v => Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x))
    .sort((a, b) => a - b);
  const angle = fields.length >= 3 && angles.length ? angles[Math.floor(angles.length / 2)] : 0;
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const rotate = (x, y) => ({ x: x * cos - y * sin, y: x * sin + y * cos });

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

  // 종이를 비스듬히 찍으면 역회전만으로는 안 펴지는 원근 왜곡(행이 부채꼴로 벌어짐)이
  // 남는다. 이때 행 '평균 y'와 비교하면 오른쪽 끝 숫자 열이 아랫행에 붙어, 품목이 아래 행의
  // 수량을 갖게 된다. 그래서 행에서 x가 가장 가까운 글자의 y와 비교해 기울어진 baseline을
  // 따라간다 — 행마다 기울기를 따로 추정하지 않아도 국소적으로 맞다.
  const rows = [];
  for (const it of items) {
    const row = rows.find(r => {
      const near = r.items.reduce((best, i) => (Math.abs(i.x - it.x) < Math.abs(best.x - it.x) ? i : best));
      return Math.abs(near.y - it.y) < it.h * 0.6;
    });
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
      for (const m of merged) if (Math.abs(m.y - row.y) < Math.abs(nearest.y - row.y)) nearest = m;
      nearest.items.push(...row.items);
      nearest.y = nearest.items.reduce((s, i) => s + i.y, 0) / nearest.items.length;
    } else {
      merged.push(row);
    }
  }

  const texts = merged
    .sort((a, b) => a.y - b.y)
    .map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.text).join(' '));

  return mergeFoldedRows(texts);
}

// 인쇄 통계표는 약제명이 두 줄로 접혀서, 보험코드가 있는 줄에 숫자 열이 하나도 안 붙는 일이
// 많다 ("053500040 세파클리캡슐(세파클러수화물)_" / "(0.25g/1캡슐) 372 41 789 ...").
// 코드 줄에 숫자가 없으면 총처방량을 뽑을 수 없으므로 이웃 줄의 숫자를 이어 붙인다.
// 앞뒤 중 어느 쪽인지는 코드 뒤 텍스트로 가른다 — "물)_(5.29mg/1정)"처럼 닫는 괄호로
// 시작하면 이름 꼬리이므로 숫자는 앞 줄에, "세파클리캡슐("처럼 이름 머리면 뒷 줄에 있다.
function mergeFoldedRows(rows) {
  const CODE = /\d{8,}/;
  const numCount = s => (s.match(/\d[\d,]*(?:\.\d+)?%?/g) || []).length;
  return rows.map((text, i) => {
    if (!CODE.test(text)) return text;
    const after = text.slice(text.search(CODE)).replace(/^\d+\s*/, '');
    // 이미 자기 수량 열을 갖춘 행은 이웃을 붙이지 않는다 — 안 막으면 아랫 행(경쟁품) 숫자까지
    // 삼켜 한 행처럼 보인다 (알마펜+알마겔 사례). 용량 괄호는 수량이 아니므로 세기 전에 뺀다.
    if (numCount(after.replace(/\([^)]*\)/g, '')) >= 3) return text;
    const close = after.indexOf(')');
    const open = after.indexOf('(');
    const isTail = close >= 0 && (open < 0 || close < open);
    for (const j of isTail ? [i - 1, i + 1] : [i + 1, i - 1]) {
      const neighbor = rows[j];
      if (neighbor && !CODE.test(neighbor) && numCount(neighbor) >= 3) return `${text} ${neighbor}`;
    }
    return text;
  });
}
