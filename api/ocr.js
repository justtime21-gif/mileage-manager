// 클로바 OCR(General) 프록시 — 시크릿 키를 클라이언트에 노출하지 않기 위해 서버에서 호출
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.CLOVA_OCR_SECRET;
  const url = process.env.CLOVA_OCR_URL;
  if (!secret || !url) return res.status(500).json({ error: 'OCR 서버 환경변수(CLOVA_OCR_SECRET, CLOVA_OCR_URL)가 설정되지 않았습니다.' });

  const { images } = req.body || {};
  if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: '이미지가 없습니다.' });

  try {
    const body = {
      version: 'V2',
      requestId: String(Date.now()),
      timestamp: Date.now(),
      images: images.map((img, i) => ({ format: img.format || 'jpg', name: `page${i}`, data: img.data })),
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': secret },
      body: JSON.stringify(body),
    });
    const json = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: json.message || 'OCR 요청 실패' });

    const text = (json.images || []).map(im => fieldsToText(im.fields || [])).join('\n\n');
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message || 'OCR 처리 중 오류' });
  }
};

// 필드(단어) 목록을 y좌표 기준으로 줄 단위로 묶고, 줄 안에서는 x좌표 순으로 정렬해 텍스트로 재구성
function fieldsToText(fields) {
  if (!fields.length) return '';
  const items = fields.map(f => {
    const ys = f.boundingPoly.vertices.map(v => v.y);
    const xs = f.boundingPoly.vertices.map(v => v.x);
    return { text: f.inferText, y: (Math.min(...ys) + Math.max(...ys)) / 2, x: Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  });
  const avgH = items.reduce((s, i) => s + i.h, 0) / items.length;
  const tol = Math.max(avgH * 0.6, 5);
  items.sort((a, b) => a.y - b.y);
  const lines = [];
  items.forEach(it => {
    let line = lines.find(l => Math.abs(l.y - it.y) <= tol);
    if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
    line.items.push(it);
    line.y = line.items.reduce((s, i) => s + i.y, 0) / line.items.length;
  });
  lines.sort((a, b) => a.y - b.y);
  return lines.map(l => l.items.sort((a, b) => a.x - b.x).map(i => i.text).join(' ')).join('\n');
}
