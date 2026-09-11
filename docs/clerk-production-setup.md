# Clerk 운영 인스턴스 전환 절차

## 왜 바꿔야 하나

현재 배포된 키는 `pk_test_...`(개발 인스턴스)다. 확인 방법:

```bash
curl -s https://mileage-manager.vercel.app/api/clerk-config
```

개발 인스턴스는 세션을 `*.clerk.accounts.dev` 도메인에 물린다. 이건 우리 앱 도메인에서
보면 서드파티 도메인이라, Safari(ITP)와 서드파티 쿠키를 막은 Chrome/Edge에서 세션이
유지되지 않는다. "이 PC에선 로그인이 되는데 저 PC에선 안 된다"가 정확히 이 증상이다.
개발 인스턴스는 사용자 수 상한도 있어 운영에 쓰라고 만든 것이 아니다.

## 절차

이 작업은 Clerk 대시보드와 도메인 DNS 접근이 필요해서 직접 해야 한다.

### 1. Clerk 운영 인스턴스 생성

1. https://dashboard.clerk.com 접속
2. 현재 앱 선택 → 좌상단 인스턴스 선택기에서 **Production** 선택 (없으면 `Create production instance`)
3. 개발 인스턴스의 설정(소셜 로그인 제공자 등)을 그대로 쓸지 묻는다. Google 로그인을 쓰고 있으니 **Google을 켠다**

### 2. 도메인 연결

운영 인스턴스는 우리 도메인에 세션을 물리므로 도메인 인증이 필요하다.

1. Clerk 대시보드 → **Domains** → 앱 도메인 입력 (예: `mileage-manager.vercel.app`)
2. Clerk가 요구하는 CNAME 레코드를 DNS에 추가
   - `vercel.app` 하위 도메인은 DNS를 우리가 못 건드린다. 이 경우 **자체 도메인이 필요하다**
   - 자체 도메인이 없으면 Vercel에서 도메인을 하나 붙이고(Settings → Domains) 그 도메인으로 진행한다
3. 인증이 끝날 때까지 기다린다 (보통 몇 분, DNS 전파가 늦으면 더 걸림)

### 3. Google OAuth 자격 증명 등록

개발 인스턴스는 Clerk의 공유 OAuth 앱을 쓰지만 운영 인스턴스는 자체 자격 증명이 필요하다.

1. https://console.cloud.google.com → **API 및 서비스 → 사용자 인증 정보**
2. **OAuth 2.0 클라이언트 ID** 생성 (웹 애플리케이션)
3. 승인된 리디렉션 URI에 Clerk 대시보드가 알려주는 주소를 그대로 붙여넣는다
4. 발급된 Client ID / Client Secret을 Clerk 대시보드의 Google 제공자 설정에 입력

### 4. Vercel 환경변수 교체

Clerk 대시보드 → **API Keys**에서 운영 키를 복사해 Vercel에 넣는다.

| 환경변수 | 값 |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | `pk_live_...` |
| `CLERK_SECRET_KEY` | `sk_live_...` |

- Vercel → 프로젝트 → Settings → Environment Variables
- **Production 환경**에 설정한다
- 따옴표·앞뒤 공백·줄바꿈이 섞이지 않게 값만 붙여넣는다 (OCR 시크릿에서 같은 실수로 한 번 겪었다)
- 저장 후 반드시 **Redeploy** 한다 — 환경변수는 재배포해야 반영된다

### 5. 확인

```bash
curl -s https://<도메인>/api/clerk-config
```

`pk_live_...`가 나오면 전환된 것이다. 그다음 실제로 두 PC에서 로그인해 보고, 양쪽이
같은 데이터를 보는지 확인한다.

## 전환 전에 반드시 할 것

**두 PC 모두에서 설정 → 데이터 내보내기로 JSON 백업을 받아 둔다.**
지금 두 PC 데이터가 갈라져 있다. 앱은 로그인 시 자동으로 합치고(어느 쪽도 지우지 않음)
합치기 직전 로컬 상태를 `mileage_premergeBackup` 키에 백업하지만, 앱 바깥의 백업이
하나 더 있는 편이 안전하다.

## 참고

- `api/clerk-config.js` — 퍼블리셔블 키를 브라우저에 내려주는 엔드포인트
- `api/mileage-state.js` — Clerk 토큰을 검증하고 Supabase `mileage_states`에 읽고 쓴다
- `index.html`의 `hydrateMileageState()` — 로그인 시 서버 데이터와 로컬을 합친다
