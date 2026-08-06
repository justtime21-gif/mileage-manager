const crypto = require('crypto');

const REQUIRED_HEADERS = {
  clinic: ['거래처', '거래선', '요양기관명', '병원', '치과', 'clinic', 'account'],
  item: ['품목', '발송품목', '상품', '항목', 'item', 'product'],
  quantity: ['수량', '발주수량', 'qty', 'quantity'],
  status: ['발송상태', '배송상태', '출고상황', '상태', 'status'],
  applicant: ['신청인', '담당자'],
};

const OPTIONAL_HEADERS = {
  sentDate: ['발송일', '출고일', '배송일', 'date', 'sentdate'],
  requestMonth: ['월', '신청월', '발송월', 'month'],
  branch: ['영업본부', '본부', '지점'],
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 담당자가 본인 구글 계정으로 연결했으면 그 토큰으로 본인 시트를 읽는다.
    // 토큰이 없으면 종전대로 서버 서비스 계정이 공용 시트를 읽는다.
    const userConfig = getUserConfig(req);
    const config = userConfig || getConfig();
    const accessToken = userConfig ? userConfig.accessToken : await getAccessToken(config);
    const values = await readSheet(config, accessToken);
    const result = filterByApplicant(normalizeSheetRows(values), config.applicantName);
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

// 브라우저가 보낸 담당자 본인 구글 토큰과 시트 설정. 토큰이 없으면 null.
// 토큰은 저장하지 않고 이 요청에서 구글 호출에만 쓴다.
function getUserConfig(req) {
  const accessToken = String(req.headers['x-sheet-token'] || '').trim();
  if (!accessToken) return null;
  const spreadsheetId = String(req.headers['x-sheet-id'] || '').trim();
  const range = decodeHeader(req.headers['x-sheet-range']);
  if (!spreadsheetId || !range) {
    const error = new Error('User sheet configuration is missing');
    error.statusCode = 400;
    error.publicMessage = '설정에서 본인 구글시트 주소와 탭 범위를 먼저 저장하세요.';
    throw error;
  }
  return { accessToken, spreadsheetId, range, applicantName: decodeHeader(req.headers['x-sheet-applicant']) };
}

// 시트 탭명·신청인은 한글이라 헤더에 그대로 실으면 깨진다. 클라이언트가 encodeURIComponent로 보낸다.
function decodeHeader(value) {
  try {
    return decodeURIComponent(String(value || '')).trim();
  } catch {
    return '';
  }
}

function getConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const applicantName = process.env.GOOGLE_SHEETS_APPLICANT_NAME?.trim();
  if (!spreadsheetId || !range || !clientEmail || !privateKey || !applicantName) {
    const error = new Error('Google Sheets configuration is missing');
    error.statusCode = 503;
    error.publicMessage = '구글시트 연동 설정이 아직 완료되지 않았습니다.';
    throw error;
  }
  return { spreadsheetId, range, clientEmail, privateKey, applicantName };
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
  const headerRowIndex = findHeaderRow(values);
  if (headerRowIndex < 0) {
    const error = new Error('Dispatch sheet header row not found');
    error.statusCode = 422;
    error.publicMessage = '시트에서 요양기관명·항목·발주수량·출고 상황 헤더를 찾지 못했습니다.';
    throw error;
  }
  const headers = values[headerRowIndex].map(normalizeHeader);
  const indexes = Object.fromEntries(Object.entries(REQUIRED_HEADERS).map(([key, aliases]) => [
    key,
    headers.findIndex(header => aliases.includes(header)),
  ]));
  Object.entries(OPTIONAL_HEADERS).forEach(([key, aliases]) => {
    indexes[key] = headers.findIndex(header => aliases.includes(header));
  });
  const missing = Object.keys(REQUIRED_HEADERS).filter(key => indexes[key] < 0);
  if (missing.length) {
    const error = new Error(`Missing headers: ${missing.join(', ')}`);
    error.statusCode = 422;
    error.publicMessage = `시트 필수 열이 없습니다: ${missing.map(displayHeader).join(', ')}`;
    throw error;
  }

  const records = [];
  const unmatchedRecords = [];
  values.slice(headerRowIndex + 1).forEach((row, rowIndex) => {
    const value = key => indexes[key] >= 0 ? String(row[indexes[key]] || '').trim() : '';
    const dispatch = parseDispatchStatus(value('status'));
    const record = {
      row: headerRowIndex + rowIndex + 2,
      clinicName: value('clinic'),
      item: value('item'),
      quantity: parseQuantity(value('quantity')),
      applicant: value('applicant'),
      branch: value('branch'),
      rawStatus: value('status'),
      sentDate: normalizeDate(value('sentDate')) || dispatch.date,
      requestMonth: normalizeMonth(value('requestMonth')),
    };
    record.status = dispatch.status;
    record.isPaperCup = normalizeHeader(record.item).includes('종이컵');
    if (!record.clinicName && !record.item && !record.rawStatus && !record.sentDate) return;
    const completedWithoutDate = record.status === 'completed' && !record.sentDate;
    if (!record.clinicName || !record.item || !record.rawStatus || completedWithoutDate || record.status === 'review') {
      record.status = 'review';
      record.reviewReason = getReviewReason(record);
      unmatchedRecords.push(record);
    }
    records.push(record);
  });

  return {
    records,
    unmatchedRecords,
    summary: buildSummary(records, unmatchedRecords),
  };
}

function filterByApplicant(result, applicantName) {
  const normalizedApplicant = normalizeApplicant(applicantName);
  // 본인 시트에 본인 행만 있으면 신청인을 비워두고 전체를 쓴다.
  if (!normalizedApplicant) return { ...result, summary: buildSummary(result.records, result.unmatchedRecords) };
  const records = result.records.filter(record => normalizeApplicant(record.applicant) === normalizedApplicant);
  const unmatchedRecords = result.unmatchedRecords.filter(record => normalizeApplicant(record.applicant) === normalizedApplicant);
  return { records, unmatchedRecords, summary: buildSummary(records, unmatchedRecords) };
}

function normalizeApplicant(value) {
  return String(value || '').replace(/\s/g, '').toLowerCase();
}

function buildSummary(records, unmatchedRecords) {
  const paperCupRecords = records.filter(record => record.isPaperCup);
  return {
    total: records.length,
    paperCupPending: paperCupRecords.filter(record => record.status === 'pending').length,
    paperCupCompleted: paperCupRecords.filter(record => record.status === 'completed').length,
    review: unmatchedRecords.length,
  };
}

function findHeaderRow(values) {
  return values.findIndex(row => {
    const headers = row.map(normalizeHeader);
    return Object.values(REQUIRED_HEADERS).filter(aliases => headers.some(header => aliases.includes(header))).length >= 3;
  });
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[\s_\-()]/g, '');
}

function normalizeStatus(value) {
  const status = normalizeHeader(value);
  if (['대기', '신청', '미발송'].includes(status) || status.includes('미출고') || status.includes('출고예정')) return 'pending';
  if (['완료', '발송완료', '발송'].includes(status) || status.includes('출고')) return 'completed';
  return 'review';
}

function parseDispatchStatus(value) {
  return { status: normalizeStatus(value), date: normalizeDate(value) };
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/(?:(\d{4})[.\-/년\s]+)?(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return '';
  const year = match[1] || String(new Date().getFullYear());
  return `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function normalizeMonth(value) {
  const match = String(value || '').match(/(?:^|\s)(1[0-2]|[1-9])\s*월?/);
  return match ? Number(match[1]) : 0;
}

function parseQuantity(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function getReviewReason(record) {
  if (!record.clinicName) return '거래처명이 비어 있습니다.';
  if (!record.item) return '품목이 비어 있습니다.';
  if (!record.rawStatus) return '출고 상황이 비어 있습니다.';
  if (record.status === 'completed' && !record.sentDate) return '출고일 형식을 확인하세요.';
  return `발송상태 '${record.rawStatus}'을(를) 해석할 수 없습니다.`;
}

function displayHeader(key) {
  return { clinic: '요양기관명', item: '항목', quantity: '발주수량', status: '출고 상황', applicant: '신청인' }[key];
}

function emptySummary() {
  return { total: 0, paperCupPending: 0, paperCupCompleted: 0, review: 0 };
}

module.exports._test = { normalizeSheetRows, normalizeStatus, normalizeDate, normalizeMonth, findHeaderRow, filterByApplicant };
