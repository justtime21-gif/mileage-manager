# Context Notes

## 2026-09-11 · mr-crm OCR 이식

### 왜 다시 이식하나
마일리지 앱에는 2026-07 시점의 mr-crm OCR이 한 번 이식돼 있었다. 그 뒤 mr-crm에서
고친 것들이 반영되지 않아, 기울여 찍은 사진과 인쇄 통계표에서 수량을 잘못 읽는다.

### 증상 진단 (추측 아님)
- 배포된 `/api/ocr`에 1x1 PNG POST → `{"text":""}` 200. 서버·환경변수 정상.
- 화면 에러 `The string did not match the expected pattern.`는 WebKit 전용 메시지.
  서버 에러였다면 `api/ocr.js`가 한글 안내를 덧붙였을 것이므로 클라이언트 throw다.
  `applyOcrResult()`가 `runStatsOcr()`의 try 안에 있어 "인식 실패"로 표시된다.
  유력 원인: OCR로 읽은 연월이 깨졌을 때 `input[type=date].value`에 잘못된 문자열을
  넣는 것 — Chrome은 무시하지만 Safari는 이 메시지로 throw한다.

### 이식 대상과 근거
| 대상 | mr-crm 출처 | 이유 |
|---|---|---|
| nearest-x baseline 행 묶기 | `src/lib/ocr.ts` | 비스듬히 찍으면 행이 부채꼴로 벌어져 오른쪽 숫자 열이 아랫행에 붙는다 |
| `mergeFoldedRows()` | `src/lib/ocr.ts` | 인쇄 통계표는 약제명이 두 줄로 접혀 코드 줄에 숫자가 없다 |
| `extractAmount()` | `src/lib/ocr-amount.ts` | 통계표형·명세서형·경영통계 3양식을 검산으로 가린다. 검증 스크립트 있음 |
| `DRUG_COLS` 키워드 | `src/components/OcrSheetEntry.tsx` | 성분명 겹침으로 타사 제품이 자사 칸에 들어간 실제 사고들을 막은 값 |
| `compressImage()` | `src/components/OcrSheetEntry.tsx` | 폰 원본 5~10MB는 서버 본문 한도(~4.5MB) 초과 |

### 결정
- 마일리지 앱은 단일 파일(index.html)이라 mr-crm의 TS 모듈 구조는 가져오지 않는다.
  순수 함수만 옮기고, 검증 스크립트가 index.html에서 함수 소스를 뽑아 실행한다.
- 기존 Format A/B/C/D 휴리스틱은 `extractAmount`로 대체한다. 두 벌을 유지하면
  어느 쪽이 답을 냈는지 추적이 안 된다.

### 이식 중 발견한 버그
`matchOcrDrugs`에서 '타사 코드가 있는 줄' 판정을 공백·콤마를 지운 문자열에서 하면,
`55 24 420 0 0 24 420`이 `5524420002442096`으로 이어져 없는 9자리 보험코드가 만들어진다.
그 줄은 경쟁사 행으로 오인돼 키워드 매칭이 통째로 막힌다. 코드 판정은 공백이 남은 원본
줄에서 한다. (코드 '포함' 검사는 OCR이 코드를 쪼개 읽을 수 있어 despace 유지)

### 검증
`node scripts/validate-ocr.mjs` — mr-crm의 validate-ocr-amount.mjs·validate-ocr-rows.mjs
케이스 + 진정한하루치과 26년 6월 실제 행 + 약품 매칭까지 한 파일에서 돌린다.
index.html·api/ocr.js에서 함수 소스를 직접 뽑아 실행하므로 앱과 테스트가 어긋나지 않는다.
