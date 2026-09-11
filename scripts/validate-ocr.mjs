// OCR 수량 추출(extractAmount)과 접힌 행 병합(mergeFoldedRows)을 실제 통계표 행으로 검증한다.
// 실행: node scripts/validate-ocr.mjs
// 이 저장소엔 테스트 러너가 없고 앱은 단일 HTML 파일이라, 소스에서 순수 함수만 뽑아 돌린다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const grab = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}을 찾지 못했습니다.`);
  let depth = 0, i = src.indexOf("{", start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`${name}의 끝을 찾지 못했습니다.`);
};

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ocrjs = readFileSync(new URL("../api/ocr.js", import.meta.url), "utf8");
const extractAmount = new Function(`${grab(html, "extractAmount")}; return extractAmount;`)();
const keywords = html.slice(html.indexOf("const OCR_KEYWORDS = {"), html.indexOf("};", html.indexOf("const OCR_KEYWORDS = {")) + 2);
const matchOcrDrugs = new Function(
  `${keywords}\n${grab(html, "extractAmount")}\n${grab(html, "matchOcrDrugs")}; return matchOcrDrugs;`
)();
const mergeFoldedRows = new Function(`${grab(ocrjs, "mergeFoldedRows")}; return mergeFoldedRows;`)();

// --- extractAmount: 원외처방 약제 통계표 ---
// 컬럼: 단가 급여횟수 급여량 비급여횟수 비급여량 총횟수 총처방량 횟수비율% 량비율%
assert.equal(extractAmount("053500040 세파클리캡슐(세파클러수화물)_(0.25g/1캡슐) 372 7 141 0 0 7 141 1.4% 2.1%"), 141);
assert.equal(extractAmount("053500180 오스템아세클로페낙정_(0.1g/1정) 160 3 63 0 0 3 63 0.6% 0.9%"), 63);
assert.equal(extractAmount("053500050 록소리펜정(록소프로펜나트륨수화물)_(68.1mg/1정) 125 8 162 0 0 8 162 1.6% 2.4%"), 162);
assert.equal(extractAmount("053500020 나프록소정(나프록센나트륨)_(0.275g/1정) 115 87 1,257 4 60 91 1,317 17.7% 19.6%"), 1317);
assert.equal(extractAmount("053500100 모사프리정(모사프리드시트르산염수화물)_(5.29mg/1정) 103 144 2,028 4 60 148 2,088 28.8% 31.0%"), 2088);
assert.equal(extractAmount("053500060 아목시클라정375mg(아목시실린-클라불란산칼륨(2:1))_(1정) 300 134 1,806 4 60 138 1,866 26.9% 27.7%"), 1866);
// 약품명 농도(0.12%)가 앞에 껴도 비율 컬럼은 끝의 두 개다.
assert.equal(extractAmount("053500191 오스템클로르헥시딘액0.12%(클로르헥시딘글루콘산염액)_(0.6mL/100mL) 910 42 42 0 0 42 42 8.2% 0.6%"), 42);
// 옆 행의 비율(%)이 줄에 섞여 들어온 경우 — 반복쌍(99 108 … 99 108)으로 잡는다.
assert.equal(extractAmount("치과 구강용약 053500191 오스템클로르헥시딘액0.12%(클로르헥 0.7% 0.9% 시딘글루콘산염액)_(0.6mL/100mL) 910 99 108 0 0 99 108 18.4%"), 108);
assert.equal(extractAmount("053500040 세파클리캡슐(세파클러수화물)_ (0.25g/1캡슐) 372 41 789 0 0 41 789 7.6% 11.8%"), 789);
assert.equal(extractAmount("053500100 물)_(5.29mg/1정) 모사프리정(모사프리드시트르산염수화 103 129 2,004 0 0 129 2,004 24.0% 29.9%"), 2004);

// --- extractAmount: 경영통계 화면(총처방량 열이 사진에서 잘림) ---
assert.equal(extractAmount("에페신정(에페리손염산염)(수 명문제약(주) 113 2 42 0 0 2"), 42);
assert.equal(extractAmount("소론도정(프레드니솔론)_(5mg (주)유한양행 16 11 177 2 36 13"), 213);
assert.equal(extractAmount("알마펜정(알마게이트)_(0.5g/1 오스템파마주식회사 55 73 1,161 2 36 75"), 1197);
assert.equal(extractAmount("나프록소정(나프록센나트륨)_( 오스템파마주식회사 115 35 537 2 36 37"), 573);
// 총처방량 열까지 찍힌 사진은 두 검산이 모두 맞을 때 그 값을 그대로 쓴다.
assert.equal(extractAmount("소론도정(프레드니솔론)_(5mg (주)유한양행 16 11 177 2 36 13 213"), 213);

// --- extractAmount: 명세서형(단가×수량=금액) ---
assert.equal(extractAmount("053500080 아목시스캡슐 300 24 7200"), 24);

// --- 진정한하루치과 26년 6월 실제 행 ---
assert.equal(extractAmount("해열진통소염제 053500050 록소리펜정(록소프로펜나트륨수화물)_(68.1mg/1 125 57 813 0 0 57 813 22.8% 23.6%"), 813);
assert.equal(extractAmount("치과 구강용약 053500191 오스템클로르헥시딘액0.12%(클로르헥시딘글루 910 25 25 0 0 25 25 10.0% 0.7%"), 25);

// --- mergeFoldedRows ---
// 자기 수량 열이 이미 붙은 자사 행은 아랫 행(경쟁품 알마겔)을 삼키지 않는다.
const same = mergeFoldedRows([
  "053500090 알마펜정(알마게이트)_(0.5g/1정) 55 130 1,233 0 0 130 1,233 30.7% 29.8%",
  "642101080 알마겔정(알마게이트)_(0.5g/1정) 55 6 54 0 0 6 54 1.4% 1.3%",
]);
assert.equal(same[0].includes("54"), false);

// 이름이 두 줄로 접혀 코드 줄에 숫자가 없으면 이웃 줄 숫자를 이어 붙인다.
const folded = mergeFoldedRows([
  "053500040 세파클리캡슐(세파클러수화물)_",
  "(0.25g/1캡슐) 372 41 789 0 0 41 789 8.1% 9.2%",
]);
assert.equal(folded[0].includes("789"), true);

// 이름 꼬리만 남은 코드 줄은 앞 줄 숫자를 가져온다.
const tail = mergeFoldedRows([
  "103 144 2,028 4 60 148 2,088 28.8% 31.0%",
  "053500100 물)_(5.29mg/1정)",
]);
assert.equal(tail[1].includes("2,088"), true);

// --- matchOcrDrugs: 진정한하루치과 26년 6월 통계표 (자사 5품목 + 경쟁품) ---
const DRUGS = [
  { id: "d1", name: "록소리펜 정 60mg(록소프로펜)", code: "053500050", price: 125 },
  { id: "d2", name: "모사프리 정 5mg(모사프리드)", code: "053500100", price: 103 },
  { id: "d3", name: "아목시클라 정 375mg(아목시실린+클라불란산)", code: "053500060", price: 300 },
  { id: "d4", name: "알마펜 정 500mg(알마게이트)", code: "053500090", price: 55 },
  { id: "d5", name: "오스템클로르헥시딘액0.12%(클로르헥시딘글루콘산염액100mL)", code: "053500191", price: 910 },
];
const JUNE = [
  "해열진통소염제 053500050 록소리펜정(록소프로펜나트륨수화물)_(68.1mg/1 125 57 813 0 0 57 813 22.8% 23.6%",
  "672300240 타이레놀8시간이알서방정(아세트아미노펜)_(0.65 70 5 96 0 0 5 96 2.0% 2.8%",
  "649806570 명문록소프로펜정(록소프로펜나트륨수화물)_(68 125 4 66 0 0 4 66 1.6% 1.9%",
  "치과 구강용약 053500191 오스템클로르헥시딘액0.12%(클로르헥시딘글루 910 25 25 0 0 25 25 10.0% 0.7%",
  "제산제 053500090 알마펜정(알마게이트)_(0.5g/1정) 55 24 420 0 0 24 420 9.6% 12.2%",
  "기타 소화기관용약 053500100 모사프리정(모사프리드시트르산염수화물)_(5.29 103 40 504 0 0 40 504 16.0% 14.6%",
  "항생제(그람양성,그 053500060 아목시클라정375mg(아목시실린-클라불란산칼륨 300 38 594 0 0 38 594 15.2% 17.2%",
  "660702770 아모시틴정625밀리그램(아목시실린수화물-묶은 483 16 168 0 0 16 168 6.4% 4.9%",
];
const hits = matchOcrDrugs(JUNE, DRUGS);
assert.deepEqual(
  Object.fromEntries(hits.map(h => [h.drug.id, h.qty])),
  { d1: 813, d5: 25, d4: 420, d2: 504, d3: 594 }
);
// 경쟁품(명문록소프로펜, 아모시틴)은 자사 품목으로 잡히지 않는다.
assert.equal(hits.length, 5);

// 코드가 안 읽힌 줄은 키워드로 잡되, 타사 코드가 있는 줄은 잡지 않는다.
assert.deepEqual(
  matchOcrDrugs(["알마펜정(알마게이트)_(0.5g/1정) 55 24 420 0 0 24 420 9.6% 12.2%"], DRUGS)
    .map(h => [h.drug.id, h.qty]),
  [["d4", 420]]
);
assert.deepEqual(
  matchOcrDrugs(["649400020 가스탄정(모사프리드시트르산염수화물) 103 9 126 0 0 9 126 1.1% 2.2%"], DRUGS),
  []
);

console.log("OK — OCR 수량 추출·행 병합·약품 매칭 검증 통과");
