# CLAUDE.md — 거래선 마일리지 관리 앱

## 앱 개요

치과 거래선(병·의원)의 **처방 마일리지 적립 및 판촉물 차감**을 관리하는 단일 파일 웹앱.
영업사원이 거래처별 마일리지 잔액, 처방 이력, 판촉물 발송 현황을 추적한다.

## 실행 방법

```bash
cd '/Users/yunapapa/거래선 마일리지 관리'
python3 -m http.server 3456
# → http://localhost:3456 에서 확인
```

## 파일 구조

```
index.html          앱 전체 (HTML + CSS + JS, 약 2,400줄)
.claude/
  launch.json       로컬 서버 실행 설정 (port 3456)
  settings.local.json  퍼미션 설정
```

## 데이터 구조 (localStorage)

| 키 | 타입 | 설명 |
|----|------|------|
| `mileage_clinics` | Clinic[] | 거래선 목록 |
| `mileage_transactions` | Transaction[] | 적립/차감 전체 이력 |
| `mileage_rxDrugs` | RxDrug[] | 처방약품 목록 (단가 포함) |
| `mileage_promoItems` | PromoItem[] | 판촉물 목록 (가격 포함) |

### Clinic 객체
```js
{
  id,           // uid()로 생성
  name,         // 거래선명 (예: "미소진치과")
  branch,       // 담당 지점
  rate,         // 마일리지 적립률 (%)
  initialBalance, // 앱 사용 전 이전 누적 잔액
  regularPromos,  // 정기 발송 품목명 배열
  noMileage,    // true면 발송 기록만 (마일리지 차감 없음)
  dualTrack,    // true면 마일리지 + 정기 발송 병행
  startYm,      // 거래 시작 연월 (예: "2025-03")
}
```

### Transaction 객체
```js
{
  id,
  clinicId,
  type,         // 'earn'(적립) | 'spend'(차감)
  amount,       // 마일리지 금액 (원)
  // type='earn' 전용
  rxTotal,      // 처방액 합계
  rate,         // 적립률
  rxStart,      // 처방 시작일 (예: "2026-05-01")
  rxEnd,        // 처방 종료일
  items,        // [{drugId, name, qty, price}]
  // type='spend' 전용
  items,        // [{name, qty, price, amount}]
  date,         // 차감일 (예: "2026-06-18")
  memo,
  createdAt,    // Date.now()
}
```

## 핵심 함수 위치 가이드

| 함수 | 역할 |
|------|------|
| `getClinicBalance(id)` | 거래선 현재 잔액 계산 (초기잔액 + 적립 - 차감) |
| `saveRx()` | 처방 입력 저장 → transactions에 type:'earn' 추가 |
| `saveRedeem()` | 판촉물 차감 저장 → transactions에 type:'spend' 추가 |
| `parseKakaoOrder()` | 카톡 주문 텍스트 파싱 → 판촉물 자동 선택 |
| `applyOcrResult(text)` | OCR 결과 파싱 → 처방 품목 자동 입력 |
| `renderReport()` | Canvas API로 카톡 전송용 보고서 이미지 생성 |
| `exportData()` / `importData()` | JSON 백업 내보내기/가져오기 |
| `parseDispatchText(text)` | 구글시트·자유형식 발송 텍스트 파싱 |
| `loadDispatchStatus()` | 읽기 전용 구글시트에서 종이컵 발송 상태를 동기화 |
| `migrateBrochureDrugs()` | 처방약품 데이터 마이그레이션 (앱 로드 시 1회) |
| `migrateCombinedPromoItems()` | 판촉물 데이터 마이그레이션 (앱 로드 시 1회) |
| `save()` | 모든 데이터를 localStorage에 일괄 저장 |

## 화면 목록

| 화면 ID | 메뉴 | 역할 |
|---------|------|------|
| `dashboard` | 대시보드 | 마일리지 정리 필요 및 종이컵 발송 업무 목록 |
| `clinics` | 거래선 관리 | CRUD + 보고서 생성 |
| `prescriptions` / `history` | 마일리지 | 처방 입력 및 적립·차감 이력 조회 |
| `redeem` / `promo-track` | 발송 관리 | 카톡 파싱, 판촉물 차감 및 발송 현황 |
| `rx-drugs` | 처방약품 관리 | 약품명/보험코드/단가 관리 |
| `promo-items` | 판촉물 목록 | 품목/가격 관리 + 이미지 내보내기 |
| `history` | 이력 조회 | 거래선·유형·월별 필터 |
| `promo-track` | 발송 현황 | 연간 체크리스트 + 거래선별 이력 |

## 자주 하는 작업 패턴

### 새 처방약품 추가
`getDefaultRxDrugs()` 함수 내 배열에 객체 추가:
```js
{ id: uid(), name: '약품명(성분명)', price: 단가, code: '보험코드', category: '분류' }
```
`migrateBrochureDrugs()`의 `canonical` 배열에도 동일하게 추가해야 마이그레이션 대상이 됨.

### 새 판촉물 추가
`getDefaultPromoItems()` 함수 내 배열에 객체 추가:
```js
{ id: uid(), name: '품목명 (규격)', price: 가격, category: '카테고리' }
```

### 스타일 변수
CSS 변수는 `:root`에 정의됨:
- `--primary: #1a6b3c` (초록 계열 메인)
- `--danger: #e53e3e` (빨강, 차감 표시)
- `--accent: #f0a500` (주황, 강조)

## 주의사항

- 데이터는 **브라우저 localStorage에만 저장**됨. 다른 기기/브라우저에서 보려면 내보내기/가져오기 필수.
- OCR은 **네이버 클로바 OCR**을 사용 (`api/ocr.js` 서버리스 함수 경유). Vercel 환경변수 `CLOVA_OCR_SECRET`, `CLOVA_OCR_URL` 필요. **GitHub Pages는 서버리스 함수가 없어 OCR이 동작하지 않음** — Vercel 배포(`mileage-manager.vercel.app`)에서만 사용 가능.
- 종이컵 업무 목록은 `api/dispatch-status.js`가 구글시트를 읽기 전용으로 조회한다. `GOOGLE_SHEETS_APPLICANT_NAME`과 같은 `신청인` 행만 서버에서 반환하므로 다른 담당자 행은 브라우저로 전달되지 않는다. `.env.example`의 `GOOGLE_SHEETS_*`, `GOOGLE_SERVICE_ACCOUNT_*` 값을 Vercel 환경변수로 설정하고, 시트를 서비스 계정 이메일에 **뷰어 또는 편집자**로 공유해야 한다. `26y 판촉물 신청` 탭은 상단 안내 행을 건너뛰고 `요양기관명`, `신청인`, `항목`, `발주수량`, `출고 상황` 헤더를 자동 탐지한다. `출고 상황`의 `4/2 출고`는 완료와 출고일로 해석한다.
- `uid()` 함수로 ID 생성. 기존 데이터의 id를 임의 변경하면 연결이 끊어짐.
- 코드 수정 후 반드시 `save()` 호출해야 localStorage에 반영됨.
