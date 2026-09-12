// 구글시트 신청 행 생성(dispatch-append)을 실제 시트 구조로 검증한다. 실행: node scripts/validate-dispatch-append.mjs
import assert from "node:assert/strict";
import { findHeader, buildDuplicateKeys, toSheetRows } from "../api/dispatch-append.js";

// 실제 시트: 안내 문구 3줄 뒤에 헤더가 온다
const VALUES = [
  ["[예산 차감 판촉물 대장]"],
  ["* 경제적이익지출보고서 별도 제출X / 'MR필수입력'란 빈칸없이 모두 입력요망"],
  ["* 종이컵,각티슈,핸드페이퍼,아이스팩"],
  ["월", "영업본부", "요양기관명", "신청인", "항목", "연락처", "품목코드",
   "발주수량", "단가", "금액", "수령지(출고지점)", "주소", "출고 상황"],
  ["5월", "전북영업본부", "전주 스마일치과", "유성진", "종이컵(1,000개)", "010-2036-0601",
   "OSTPCH", "1", "13,000", "13,000", "전주 스마일치과", "전북 전주시 ...", "5/12 출고"],
];

const header = findHeader(VALUES);
assert.ok(header, "헤더 행을 찾아야 한다");
assert.equal(header.headerRow, 3);
// 안내 문구를 헤더로 오인하지 않는다
assert.equal(header.idx.clinic, 2);
assert.equal(header.idx.applicant, 3);
assert.equal(header.idx.item, 4);
assert.equal(header.idx.quantity, 7);
assert.equal(header.idx.destination, 10);   // '수령지(출고지점)' — 괄호가 있어도 찾는다
assert.equal(header.idx.address, 11);
assert.equal(header.idx.month, 0);
assert.equal(header.idx.branch, 1);

const keys = buildDuplicateKeys(VALUES, header.headerRow, header.idx);
assert.equal(keys.size, 1);

const ENTRY = {
  month: "9월", branch: "경기서북영업본부", clinic: "예일치과", applicant: "성진욱",
  item: "종이컵(1,000개)", quantity: 1, destination: "예일치과", address: "경기 파주시 ...",
};

// 새 건은 행으로 만들어진다
const first = toSheetRows([ENTRY], header.idx, new Set(keys));
assert.equal(first.rows.length, 1);
assert.equal(first.skipped.length, 0);
const row = first.rows[0];
assert.equal(row.length, 12);                 // 헤더에서 찾은 가장 오른쪽 칸까지만
assert.equal(row[0], "9월");
assert.equal(row[1], "경기서북영업본부");
assert.equal(row[2], "예일치과");
assert.equal(row[4], "종이컵(1,000개)");
assert.equal(row[7], 1);
assert.equal(row[10], "예일치과");
// 우리가 안 쓰는 칸(연락처·품목코드·단가·금액)은 빈 문자열로 둔다 — 시트 수식·담당자 몫이다
assert.equal(row[5], "");
assert.equal(row[6], "");
assert.equal(row[8], "");

// 시트에 이미 있는 건은 건너뛴다 (5월 전주 스마일치과 종이컵)
const dup = toSheetRows(
  [{ month: "5월", clinic: "전주 스마일치과", applicant: "유성진", item: "종이컵(1,000개)", quantity: 1 }],
  header.idx, new Set(keys));
assert.equal(dup.rows.length, 0);
assert.equal(dup.skipped.length, 1);

// 같은 요청 안에서 같은 건을 두 번 보내도 한 번만 들어간다
const twice = toSheetRows([ENTRY, { ...ENTRY }], header.idx, new Set(keys));
assert.equal(twice.rows.length, 1);
assert.equal(twice.skipped.length, 1);

// 표기 차이(공백·괄호)는 같은 건으로 본다
const spaced = toSheetRows(
  [{ ...ENTRY, month: "5월", clinic: "전주스마일치과", applicant: "유성진", item: "종이컵 (1,000개)" }],
  header.idx, new Set(keys));
assert.equal(spaced.rows.length, 0);

// 헤더가 없으면 null — 엉뚱한 줄에 쓰지 않는다
assert.equal(findHeader([["안내"], ["문구"]]), null);

console.log("OK — 구글시트 신청 행 생성 검증 통과");
