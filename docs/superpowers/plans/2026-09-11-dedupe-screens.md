# 중복 화면 제거 Implementation Plan

**Goal:** 거래처 원스톱 화면만 남기고 중복 화면 6개를 지우되, 기능과 데이터는 하나도 잃지 않는다.

**남길 화면:** `page-dashboard`, `page-clinic-hub`, `page-settings`
**지울 화면:** `page-clinics`, `page-prescriptions`, `page-redeem`, `page-rx-history`, `page-history`, `page-promo-track`

**Spec:** `docs/superpowers/specs/2026-09-11-clinic-hub-design.md` (범위 변경분은 이 문서가 상위)

## Global Constraints

- 대상은 `index.html` 단일 파일. 빌드 도구·프레임워크 없음. 새 의존성 금지
- **데이터 계층 절대 불가침**: `DB`, `save()`, 마이그레이션 3종, `exportData`/`importData`, Clerk/Supabase 동기화
- **계산 함수 불가침**: `getClinicBalance`, `getReportData`, `getClinicTotalRx`, `getClinicLastUpdated`, `buildClinicTimeline`
- 기능 소실 금지. 진입점이 사라지는 기능은 허브에 새 진입점을 만든다
- 커밋 메시지 `<type>: <한국어 설명>`, 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 조사로 확정된 사실 (에이전트 9, 전수 grep 대조)

- 삭제되는 함수 16개를 남는 코드가 부르는 곳은 정확히 9줄: 2695, 2727, 5029, 5172, 2444, 2699, 4824, 5501, 3347
- 사라지는 id 22개를 남는 코드가 참조하는 곳은 3180 하나
- 데이터 계층은 어느 삭제 구간에도 걸리지 않는다 (1253-1443, 4456-4493 전부 밖)

---

### Stage A: 허브 패널을 정적 뼈대로 바꾸고 폼 3개를 영구 이사

**문제:** `renderClinicPanel`이 `#hub-panel`을 통째로 `innerHTML`로 다시 그린다. 폼이 그 안에 영구히 살면 매 렌더마다 입력 중이던 처방 품목·OCR 사진·선택한 판촉물이 날아간다.

- [ ] `#hub-panel`을 정적 뼈대로 바꾼다: `#hub-panel-empty`, `#hub-panel-head`, `#hub-tab-body`(안에 `#hub-pane-summary` + workarea 3개)
- [ ] `renderClinicPanel`은 `#hub-panel-head`에만 `innerHTML`을 쓴다. 미선택 분기는 `#hub-panel-empty` 표시 토글로
- [ ] 요약 탭은 `#hub-pane-summary`에 쓴다
- [ ] `rx-workarea`(435-525), `redeem-workarea`(550-619)를 `#hub-tab-body` 안으로 **마크업째 이동**
- [ ] `report-workarea`(1029-1055)도 이동. `class="modal"`·인라인 `max-width:720px` 제거하고 `class="card"`로. 오버레이 `#report-modal`(1028,1056)·`openReportModal`/`closeReportModal`은 삭제
- [ ] rx-workarea의 "보고서 열기"(518) → `showHubTab('report')`
- [ ] **인라인 `display:grid` 함정**: workarea 두 개의 인라인 `style="display:grid;..."`를 `.workarea-2col` CSS 클래스로 뺀다. 탭 전환은 `.hub-pane` / `.hub-pane.active` 클래스 토글 (`style.display=''`로 되돌리면 grid가 풀린다)
- [ ] 탭 버튼 onclick을 `renderClinicPanel(...)` 재호출에서 `showHubTab('...')`로
- [ ] `mountTab`/`restoreTabs`/`hubMoved` 삭제. `navigate()`의 `restoreTabs()` 호출도 삭제
- [ ] `HUB_TABS`의 `onMount`와 select 값 동기화는 **남긴다** — 탭·거래처가 바뀔 때 폼을 해당 거래처로 맞추는 일은 여전히 필요하다
- [ ] rx-clinic 숨김 범위를 `.form-group` 전체(439-455)가 아니라 label(440)+select 줄(441-446)로 좁힌다. 안 그러면 "+ 신규 등록"·"CRM에서 처방량 불러오기"가 허브에서 영영 사라진다
- [ ] 검증: 탭 4개 왕복, 처방 품목 입력 중 탭 전환·거래처 전환해도 입력이 유지되는지, 2단 grid가 유지되는지

### Stage B: 사라질 진입점을 허브에 만들고 남는 참조를 고친다

- [ ] 허브 좌측 목록 상단에 `+ 거래처 추가` 버튼 → `openClinicModal()`
- [ ] 허브 패널 헤더 `수정` 옆에 `삭제` → `deleteClinic(id)`
- [ ] `saveClinic`의 `renderClinics();`(2695) → `renderClinicList(); renderClinicPanel(hubState.clinicId);`
- [ ] `deleteClinic`의 `renderClinics();`(2727) → 앞에 `if (hubState.clinicId === id) hubState.clinicId = null;` 넣고 같은 두 줄
- [ ] `saveSpendEdit`(5167-5173): `_spendEditCallback`은 `closeSpendEditModal`이 먼저 null로 지워 **항상** else로 떨어진다(기존 버그). 콜백 분기를 없애고 허브 갱신 한 줄로
- [ ] `saveRx`의 `renderRxHistory('all');`(3347) 삭제 — 갱신은 `refreshHubAfterSave()`가 한다
- [ ] 대시보드 '시트 확인 필요' 카드의 `action: navigate('promo-track')`(2357) → `openClinicModalWithName(거래처명)`. 이름에 따옴표가 들어갈 수 있으니 이스케이프
- [ ] `deleteTx`(5018-5032) 진입점 확인 — `editSpendTx` 모달에 삭제가 있으면 그걸로 충분. 없으면 허브 요약 행에 추가
- [ ] `openChecklistSendModal`(4751-4763): 유일 진입점이 사라진다. 대체 진입점을 만들지, 기능을 접을지 보고서에 명시하고 결정을 기록
- [ ] 붙여넣기 OCR 게이트(3180) `page-prescriptions` 참조 → `rx-workarea`가 허브에 보이는지로 교체
- [ ] 검증: 거래처 추가·수정·삭제, 차감 수정 저장, 처방 저장, 대시보드 '확인' 버튼

### Stage C: 화면 6개와 nav·navigate 분기 삭제

- [ ] 사이드바 nav 항목 삭제: clinics, mileage(prescriptions), rx-history, dispatch(promo-track). 남는 건 대시보드·거래처·설정
- [ ] 화면 마크업 삭제: page-clinics(388-424), page-prescriptions 래퍼+헤더(426-434, 526), page-redeem 래퍼+헤더, page-rx-history, page-history, page-promo-track
- [ ] `navigate()`의 해당 분기와 section 매핑 정리
- [ ] **PROMO TRACK 구역은 연속으로 지우지 마라.** `syncSheetSpends`와 그 의존(`getLinkedSheetRows`, `findPromoItemByName`, `isRegularPromoForClinic`)은 `loadDispatchStatus`가 쓰는 데이터 계층이다. 여덟 조각으로 끊어 지운다: 4496-4511, 4557-4577, 4579-4603, 4605-4629, 4631-4747, 4832-4873, 4875-4891, 4893-4916
- [ ] 시작 화면을 `page-clinic-hub`로. nav active도 이동. INIT에 `renderClinicHub()` 추가 (`renderDashboard()`는 남긴다)
- [ ] CSS 정리 시 주의: `.search-input`(140-141)은 설정 화면 주소 필터(753)가 쓴다. 남긴다
- [ ] 기존 dead code(`parseQuickInput` 등)는 건드리지 않는다 — 내가 만든 고아만 치운다
- [ ] 검증: **대시보드 종이컵 카드 부제가 "연동 오류"가 아닌 정상 동기화 문구인지 반드시 확인** (syncSheetSpends 소실은 조용히 위장된다). 남은 메뉴 3개 전수 클릭, 콘솔 에러 0

### Stage D: 전수 검증

- [ ] `node scripts/validate-ocr.mjs && node scripts/validate-clinic-panel.mjs`
- [ ] 브라우저에서 실제 데이터로 전 기능 왕복
- [ ] 워크플로 리뷰 (기능 소실·고아 함수·조용한 고장 집중)
