# 마일리지 서버 저장 설정

마일리지 앱은 ERP·CRM과 같은 Clerk 인스턴스를 사용하고, CRM과 같은 Supabase 프로젝트의 `mileage_states` 테이블에 로그인 계정별 상태를 저장한다.

## 최초 설정

1. CRM Supabase 프로젝트에서 `supabase/migrations/20260814000000_create_mileage_states.sql`을 실행한다.
2. 마일리지 Vercel 프로젝트에 다음 환경변수를 추가한다.
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Clerk 대시보드에서 Google 로그인과 마일리지 배포 도메인을 같은 Clerk 인스턴스에 등록한다.
4. 로그인 후 첫 화면에서 기존 브라우저 데이터를 서버 DB로 이전한다.

`SUPABASE_SERVICE_ROLE_KEY`는 브라우저에 노출하면 안 되며, Vercel 서버 환경변수로만 저장한다.
