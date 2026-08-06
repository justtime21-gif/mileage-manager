// 브라우저 구글 로그인에 필요한 OAuth Client ID를 내려준다.
// Client ID는 공개값이라 노출돼도 안전하다 — Client Secret은 이 흐름에 쓰지 않는다.
module.exports = (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  res.status(200).json({ clientId });
};
