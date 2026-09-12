// Clerk 토큰 검증과 공유 Supabase 클라이언트 — mileage-state·crm-clients·crm-stats가 같은 신원 판정을 쓴다.
// 파일명이 `_`로 시작하므로 Vercel이 서버리스 함수로 배포하지 않는다.
import { createClerkClient, verifyToken } from '@clerk/backend';
import { createClient } from '@supabase/supabase-js';

export function db() {
  return createClient(
    String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim(),
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    { auth: { persistSession: false } },
  );
}

export function isConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// mr_profiles에 이메일이 없으면 mrName이 ''이다. 담당자 필터가 ''로 돌면 남의 거래처가 보일 수 있으므로,
// 부르는 쪽은 반드시 빈 mrName을 거절해야 한다(mr-crm CLAUDE.md의 "MR 스코핑은 mr_name" 규약).
export async function getUser(req) {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token || !process.env.CLERK_SECRET_KEY) return null;

  const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  const userId = String(claims.sub || '').trim();
  if (!userId) return null;

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const user = await clerk.users.getUser(userId);
  const email = String(user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress || '').trim();
  const name = String(user.fullName || user.firstName || '').trim();
  const profile = email
    ? await db().from('mr_profiles').select('mr_name').eq('email', email).maybeSingle()
    : { data: null };

  return { userId, email, name, mrName: String(profile.data?.mr_name || '').trim() };
}
