// 판촉물 신청 행을 공용 구글시트에 덧붙인다. 읽기(dispatch-status.js)와 짝이다.
//
// 공용 시트라 잘못 쓰면 다른 담당자에게도 보인다. 그래서 두 가지를 지킨다.
// 1) 헤더를 읽어 열 위치를 찾는다. 열 순서가 바뀌어도 엉뚱한 칸에 안 들어간다.
// 2) 같은 월·거래처·항목·신청인 행이 이미 있으면 건너뛴다. 두 번 눌러도 중복이 안 생긴다.
import crypto from 'node:crypto';

// 시트 헤더 이름 후보. 읽기 쪽과 같은 표기를 쓰되 이 엔드포인트가 쓰는 칸만 둔다.
const COLUMNS = {
  month: ['월', '신청월', '발송월'],
  branch: ['영업본부', '본부'],
  clinic: ['요양기관명', '거래처', '거래선', '병원', '치과'],
  applicant: ['신청인', '담당자'],
  item: ['항목', '품목', '발송품목', '상품'],
  quantity: ['발주수량', '수량'],
  destination: ['수령지', '수령지(출고지점)', '출고지점'],
  address: ['주소', '배송주소', '수령지주소'],
};

const norm = v => String(v ?? '').replace(/\s|\(|\)|:/g, '').toLowerCase();

function getConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!spreadsheetId || !range || !clientEmail || !privateKey) {
    const e = new Error('config missing');
    e.statusCode = 503;
    e.publicMessage = '구글시트 연동 설정이 아직 완료되지 않았습니다.';
    throw e;
  }
  return { spreadsheetId, range, clientEmail, privateKey };
}

async function getAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: config.clientEmail,
    // 읽기 전용이 아니라 쓰기 스코프다. 서비스 계정이 시트에 '편집자'로 공유돼 있어야 한다.
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(config.privateKey, 'base64url')}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!r.ok) {
    const e = new Error('token failed');
    e.statusCode = 502;
    e.publicMessage = '구글시트 인증에 실패했습니다. 서비스 계정 권한을 확인하세요.';
    throw e;
  }
  return (await r.json()).access_token;
}

async function readValues(config, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(config.range)}?majorDimension=ROWS`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const e = new Error('read failed');
    e.statusCode = 502;
    e.publicMessage = '구글시트를 읽지 못했습니다. 공유 권한과 범위를 확인하세요.';
    throw e;
  }
  return (await r.json()).values || [];
}

// 안내 문구가 위에 몇 줄 깔려 있어 헤더 행 위치를 찾아야 한다. 읽기 쪽과 같은 문제다.
export function findHeader(values) {
  for (let i = 0; i < Math.min(values.length, 15); i++) {
    const row = values[i] || [];
    const idx = {};
    Object.entries(COLUMNS).forEach(([key, names]) => {
      const want = names.map(norm);
      const at = row.findIndex(cell => want.includes(norm(cell)));
      if (at >= 0) idx[key] = at;
    });
    // 이 네 칸을 못 찾으면 헤더 행이 아니다
    if (['clinic', 'item', 'quantity', 'applicant'].every(k => idx[k] !== undefined)) {
      return { headerRow: i, idx };
    }
  }
  return null;
}

// 이미 들어간 신청인지 본다. 월·거래처·항목·신청인이 모두 같으면 중복으로 친다.
export function buildDuplicateKeys(values, headerRow, idx) {
  const keys = new Set();
  for (let i = headerRow + 1; i < values.length; i++) {
    const row = values[i] || [];
    const key = ['month', 'clinic', 'item', 'applicant']
      .map(k => norm(row[idx[k]])).join('|');
    if (key.replace(/\|/g, '')) keys.add(key);
  }
  return keys;
}

// 앱이 보낸 신청을 시트 행(배열)으로 만든다. 헤더에 없는 칸은 건드리지 않는다.
export function toSheetRows(entries, idx, existingKeys) {
  const width = Math.max(...Object.values(idx)) + 1;
  const skipped = [];
  const rows = [];
  entries.forEach(entry => {
    const key = ['month', 'clinic', 'item', 'applicant']
      .map(k => norm(entry[k])).join('|');
    if (existingKeys.has(key)) { skipped.push(entry); return; }
    existingKeys.add(key);                       // 같은 요청 안의 중복도 막는다
    const row = new Array(width).fill('');
    Object.entries(idx).forEach(([k, at]) => {
      if (entry[k] !== undefined && entry[k] !== null) row[at] = entry[k];
    });
    rows.push(row);
  });
  return { rows, skipped };
}

export default async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { entries } = req.body || {};
    if (!Array.isArray(entries) || !entries.length) {
      return res.status(400).json({ error: '보낼 신청 내역이 없습니다.' });
    }

    const config = getConfig();
    const token = await getAccessToken(config);
    const values = await readValues(config, token);

    const header = findHeader(values);
    if (!header) {
      return res.status(422).json({ error: '시트에서 헤더(요양기관명·항목·발주수량·신청인)를 찾지 못했습니다.' });
    }

    const { rows, skipped } = toSheetRows(entries, header.idx, buildDuplicateKeys(values, header.headerRow, header.idx));
    if (!rows.length) {
      return res.status(200).json({ appended: 0, skipped: skipped.length, message: '이미 신청된 건이라 추가하지 않았습니다.' });
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(config.range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    });
    if (!r.ok) {
      const detail = await r.text();
      // 권한 부족이 가장 흔한 실패다. 무엇을 고쳐야 하는지 바로 알려준다.
      const publicMessage = r.status === 403
        ? `시트에 쓸 권한이 없습니다. 구글시트 공유에서 서비스 계정(${config.clientEmail})을 '편집자'로 바꿔 주세요.`
        : '구글시트에 쓰지 못했습니다.';
      return res.status(502).json({ error: publicMessage, detail: detail.slice(0, 300) });
    }

    res.status(200).json({ appended: rows.length, skipped: skipped.length });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.publicMessage || e.message || '신청 전송 중 오류' });
  }
};
