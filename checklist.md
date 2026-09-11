# mr-crm OCR 통째 이식 체크리스트

## 서버 (api/ocr.js)
- [x] 행 묶기를 nearest-x baseline으로 교체 (원근 왜곡 대응)
- [x] `mergeFoldedRows()` 이식 (약제명 두 줄 접힘 행 병합)
- [x] 응답에 `lines` 배열 추가 (`text`는 하위호환 유지)

## 클라이언트 (index.html)
- [x] `compressImage()` 이식 — 업로드 전 1200px·JPEG 0.7 (폰 사진 413 방지)
- [x] `extractAmount()` 이식 — mr-crm의 총처방량 추출기로 교체
- [x] `parseOcrDrugs()` 매칭 이식 — 보험코드 우선, 타사 코드 있는 줄은 키워드 매칭 차단
- [x] 처방 기간 자동 설정 시 날짜 형식 검증 (Safari SyntaxError 방지)

## 검증
- [x] `scripts/validate-ocr.mjs` — mr-crm validate-ocr-amount.mjs 케이스 이식
- [ ] 실제 6월 통계 사진으로 인식 확인 (배포 후 사용자 확인 필요)
