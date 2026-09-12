# mr-crm·ERP 거래처 연동

마일리지 앱과 mr-crm(및 같은 Supabase를 읽는 mr-team-erp)을 **읽기 전용**으로 잇는다.
앱은 CRM에 아무것도 쓰지 않는다.

## 무엇이 오가나

| 기능 | 경로 | 출처 |
|---|---|---|
| 내 담당 거래처 목록 | `GET /api/crm-clients` | 공유 Supabase `clients` (mr-crm·ERP 정본) |
| 거래처 월별 자사 처방량 | `GET /api/crm-stats` | mr-crm `GET /api/sheets/collected` (구글시트 처방통계) |

두 경로 모두 **Clerk 로그인 토큰**을 요구하고, 신원은 `api/_auth.js` 한 곳에서 판정한다.
mr-crm과 같은 Clerk 앱이라 어느 쪽에서 로그인해도 세션이 이어진다.

## 담당자 스코핑 — `mr_name`이다

mr-crm 규약과 같다. 로그인 이메일 → Supabase `mr_profiles.mr_name` → `clients.mr_name` 필터.

**`mr_name`이 비면 거절한다(409).** 빈 문자열로 조회하면 필터가 풀려 남의 거래처가 나간다.
`mr_profiles`에 이메일이 없는 담당자는 mr-crm 쪽에 등록을 요청해야 한다.
(제주 이동현은 mr-crm에서 의도적으로 `mr_profiles`에 없다 — 그 계정은 이 앱도 쓰지 않는다.)

`/api/crm-stats`는 요청한 거래처코드가 **내 담당인지 Supabase에서 한 번 더 확인**한 뒤에만
mr-crm을 호출한다. 코드를 알면 남의 거래처 통계를 읽는 길을 막는다.

## 반영은 사람이 한다

설정 → 🔗 CRM 연동에서 「CRM 거래처 불러오기」를 누르면 대조 결과만 보여준다.
체크한 항목을 눌러야 앱 데이터가 바뀐다. 자동 반영은 하지 않는다 — CRM의 오타·중복이
그대로 들어오는 것을 막기 위해서다.

대조 규칙(`matchCrmClients`):

1. 앱 거래선에 `clientCode`가 이미 있으면 **코드로** 짝짓는다. 상호가 바뀌어도 따라간다
2. 코드가 없으면 정규화한 이름(`crmNameKey`)이 **양쪽에서 각각 한 곳뿐일 때만** 짝짓는다
3. 같은 이름이 여럿이면 짝짓지 않고 「직접 고르세요」로 남긴다

**주소는 대조 대상이 아니다.** 앱의 `address`는 판촉물 **수령지**라 CRM 소재지와 다를 수 있고,
덮어쓰면 구글시트 발송 주소가 에러 없이 바뀐다. 신규로 추가할 때만 초깃값으로 넣는다.

## 처방통계 자동 채우기

처방 입력 화면의 「🔗 CRM 처방통계 불러오기」가 그 거래처의 그 달 **자사 품목 처방량**을 채운다.

- 월 후보는 처방 기간이 걸친 달에서 만든다(`crmMonthsForPeriod`) — 5.26~6.27이면 5월·6월
- 시트 열 이름 → 앱 처방약품 매칭은 OCR과 **같은 `OCR_KEYWORDS` 표**를 쓴다. 사전이 두 벌로 갈리지 않게
- **앱 약품에 없는 시트 열은 버리지 않고 화면에 적는다.** 조용히 빠지면 처방액이 소리 없이 작아진다
- 금액은 앱 처방약품의 **단가**로 계산한다. 시트에는 수량만 있다
- 저장은 사람이 확인 후 누른다. OCR과 같은 취급이다

## 환경변수

| 변수 | 쓰는 곳 |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`·`CLERK_SECRET_KEY` | 로그인 (mr-crm과 같은 Clerk 앱) |
| `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY` | 공유 Supabase 읽기 (mr-crm과 같은 프로젝트) |
| `MR_CRM_BASE_URL` | mr-crm 배포 주소 |
| `MR_CRM_SYNC_KEY` | mr-crm의 `SYNC_API_KEY`와 같은 값 |

**서비스 롤 키와 sync 키는 서버리스 함수 환경변수에만 둔다.** 브라우저로 내려보내지 않는다.

## 사내 ERP와는 다르다

`docs/erp-clinic-sync-request.md`의 문의서는 **오스템 사내 ERP**(전산팀) 연동 건이고 아직 대기 중이다.
이 문서는 사장이 만든 mr-crm·mr-team-erp와의 연동이라 별개다.

## 검증

`npm run validate:crm-sync` — 대조 규칙·품목 매칭·월 후보. `npm test`가 함께 부른다.
