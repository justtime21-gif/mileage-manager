const crypto = require('crypto');

const REQUIRED_HEADERS = {
  clinic: ['거래처', '거래선', '병원', '치과', 'clinic', 'account'],
  item: ['품목', '발송품목', '상품', 'item', 'product'],
  quantity: ['수량', 'qty', 'quantity'],
  status: ['발송상태', '배송상태', '상태', 'status'],
  sentDate: ['발송일', '출고일', '배송일', 'date', 'sentdate'],
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const config = getConfig();
    const accessToken = await getAccessToken(config);
    const values = await readSheet(config, accessToken);
    const result = normalizeSheetRows(values);
    return res.status(200).json({
      syncedAt: new Date().toISOString(),
      records: result.records,
      summary: result.summary,
      unmatchedRecords: result.unmatchedRecords,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    // Never return provider responses or environment values to the browser.
    return res.status(status).json({ error: error.publicMessage || '발송 시트 데이터를 불러오지 못했습니다.' });
  }
};

function getConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!spreadsheetId || !range || !clientEmail || !privateKey) {
    const error = new Error('Google Sheets configuration is missing');
    error.statusCode = 503;
    error.publicMessage = '구글시트 연동 설정이 아직 완료되지 않았습니다.';
    throw error;
  }
  return { spreadsheetId, range, clientEmail, privateKey };
}

async function getAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const claim = encode({
    iss: config.clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const unsignedToken = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${signer.sign(config.privateKey, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) {
    const error = new Error('Token request failed');
    error.statusCode = 502;
    error.publicMessage = '구글시트 인증에 실패했습니다. 서비스 계정 권한을 확인하세요.';
    throw error;
  }
  const data = await response.json();
  if (!data.access_token) throw new Error('Token response did not include an access token');
  return data.access_token;
}

async function readSheet(config, accessToken) {
  const path = encodeURIComponent(config.range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${path}?majorDimension=ROWS`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const error = new Error('Sheet read failed');
    error.statusCode = 502;
    error.publicMessage = '구글시트를 읽지 못했습니다. 시트 공유 권한과 범위를 확인하세요.';
    throw error;
  }
  return (await response.json()).values || [];
}

function normalizeSheetRows(values) {
  if (!values.length) return { records: [], summary: emptySummary(), unmatchedRecords: [] };
  const headers = values[0].map(normalizeHeader);
  const indexes = Object.fromEntries(Object.entries(REQUIRED_HEADERS).map(([key, aliases]) => [
    key,
    headers.findIndex(header => aliases.includes(header)),
  ]));
  const missing = Object.entries(indexes).filter(([, index]) => index < 0).map(([key]) => key);
  if (missing.length) {
    const error = new Error(`Missing headers: ${missing.join(', ')}`);
    error.statusCode = 422;
    error.publicMessage = `시트 필수 열이 없습니다: ${missing.map(displayHeader).join(', ')}`;
    throw error;
  }

  const records = [];
  const unmatchedRecords = [];
  values.slice(1).forEach((row, rowIndex) => {
    const value = key => String(row[indexes[key]] || '').trim();
    const record = {
      row: rowIndex + 2,
      clinicName: value('clinic'),
      item: value('item'),
      quantity: parseQuantity(value('quantity')),
      rawStatus: value('status'),
      sentDate: normalizeDate(value('sentDate')),
    };
    record.status = normalizeStatus(record.rawStatus);
    record.isPaperCup = normalizeHeader(record.item).includes('종이컵');
    if (!record.clinicName && !record.item && !record.rawStatus && !record.sentDate) return;
    if (!record.clinicName || !record.item || !record.rawStatus || !record.sentDate || record.status === 'review') {
      record.status = 'review';
      record.reviewReason = getReviewReason(record);
      unmatchedRecords.push(record);
    }
    records.push(record);
  });

  const paperCupRecords = records.filter(record => record.isPaperCup);
  return {
    records,
    unmatchedRecords,
    summary: {
      total: records.length,
      paperCupPending: paperCupRecords.filter(record => record.status === 'pending').length,
      paperCupCompleted: paperCupRecords.filter(record => record.status === 'completed').length,
      review: unmatchedRecords.length,
    },
  };
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[\s_\-()]/g, '');
}

function normalizeStatus(value) {
  const status = normalizeHeader(value);
  if (['완료', '발송완료', '발송'].includes(status)) return 'completed';
  if (['대기', '신청', '미발송'].includes(status)) return 'pending';
  return 'review';
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/(?:(\d{4})[.\-/년\s]+)?(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return '';
  const year = match[1] || String(new Date().getFullYear());
  return `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function parseQuantity(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function getReviewReason(record) {
  if (!record.clinicName) return '거래처명이 비어 있습니다.';
  if (!record.item) return '품목이 비어 있습니다.';
  if (!record.rawStatus) return '발송상태가 비어 있습니다.';
  if (!record.sentDate) return '발송일 형식을 확인하세요.';
  return `발송상태 '${record.rawStatus}'을(를) 해석할 수 없습니다.`;
}

function displayHeader(key) {
  return { clinic: '거래처', item: '품목', quantity: '수량', status: '발송상태', sentDate: '발송일' }[key];
}

function emptySummary() {
  return { total: 0, paperCupPending: 0, paperCupCompleted: 0, review: 0 };
}

module.exports._test = { normalizeSheetRows, normalizeStatus, normalizeDate };
