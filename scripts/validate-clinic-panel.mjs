// 거래처 허브의 적립·차감 통합 타임라인(buildClinicTimeline)을 검증한다. 실행: node scripts/validate-clinic-panel.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const grab = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}을 찾지 못했습니다.`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`${name}의 끝을 찾지 못했습니다.`);
};

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const buildClinicTimeline = new Function(
  `${grab(html, "fmtPeriod")}\n${grab(html, "txPeriod")}\n${grab(html, "buildClinicTimeline")}; return buildClinicTimeline;`
)();

const TXS = [
  { id: "e1", clinicId: "c1", type: "earn",  amount: 38596, date: "2026-06-17", createdAt: 100,
    rxTotal: 257307, rate: 15, rxStart: "2026-05-01", rxEnd: "2026-05-31" },
  { id: "s1", clinicId: "c1", type: "spend", amount: 82500, date: "2026-06-18", createdAt: 200,
    items: [{ name: "종이컵 (1000개입)", qty: 3, price: 27500 }] },
  { id: "e2", clinicId: "c1", type: "earn",  amount: 56638, date: "2026-07-20", createdAt: 300,
    rxTotal: 377587, rate: 15, rxStart: "2026-06-01", rxEnd: "2026-06-30" },
  { id: "x1", clinicId: "c2", type: "earn",  amount: 999,   date: "2026-07-21", createdAt: 400,
    rxTotal: 6660, rate: 15, rxStart: "2026-06-01", rxEnd: "2026-06-30" },
];

const rows = buildClinicTimeline("c1", TXS);

// 다른 거래처 거래는 섞이지 않는다
assert.equal(rows.length, 3);
// 최신순 정렬
assert.deepEqual(rows.map(r => r.id), ["e2", "s1", "e1"]);
assert.deepEqual(rows.map(r => r.kind), ["earn", "spend", "earn"]);
// 적립 설명에는 처방 기간과 적립률이 들어간다
assert.ok(rows[2].desc.includes("26.05.01~05.31"));
assert.ok(rows[2].desc.includes("15%"));
// 차감 설명에는 품목과 수량이 들어간다
assert.ok(rows[1].desc.includes("종이컵 (1000개입)"));
assert.ok(rows[1].desc.includes("3"));

// 같은 날짜는 createdAt 내림차순
const sameDay = buildClinicTimeline("c1", [
  { id: "a", clinicId: "c1", type: "earn", amount: 1, date: "2026-08-01", createdAt: 1, rate: 15 },
  { id: "b", clinicId: "c1", type: "earn", amount: 2, date: "2026-08-01", createdAt: 2, rate: 15 },
]);
assert.deepEqual(sameDay.map(r => r.id), ["b", "a"]);

// 거래가 없으면 빈 배열
assert.deepEqual(buildClinicTimeline("없는거래처", TXS), []);

// --- sortPromoItemsForClinic: 자주 시키는 판촉물이 위로 오는가 ---
const CLINICS = [
  { id: "c1", name: "가치과", regularPromos: ["물티슈"] },
  { id: "c2", name: "나치과", regularPromos: [] },
];
const sortPromo = new Function(
  `const clinics = ${JSON.stringify(CLINICS)};` +
  `${grab(html, "normalizeText")}\n${grab(html, "isRegularPromoForClinic")}\n${grab(html, "sortPromoItemsForClinic")}; return sortPromoItemsForClinic;`
)();

const PROMOS = [
  { id: "p1", name: "각티슈 (30매)" },
  { id: "p2", name: "종이컵 (1000개입)" },
  { id: "p3", name: "물티슈 (100매)" },
  { id: "p4", name: "볼펜 (10자루)" },
];
const SPENDS = [
  // 종이컵 3회 — 한 건 안에 같은 품목이 두 줄이어도 1회로 센다
  { clinicId: "c1", type: "spend", items: [{ name: "종이컵(1000개입)" }, { name: "종이컵 (1000개입)" }] },
  { clinicId: "c1", type: "spend", items: [{ name: "종이컵 (1000개입)" }, { name: "각티슈 (30매)" }] },
  { clinicId: "c1", type: "spend", items: [{ name: "종이컵 (1000개입)" }] },
  // 각티슈 2회째
  { clinicId: "c1", type: "spend", items: [{ name: "각티슈 (30매)" }] },
  // 다른 거래처 주문은 섞이지 않는다
  { clinicId: "c2", type: "spend", items: [{ name: "볼펜 (10자루)" }] },
  // 적립 거래는 세지 않는다
  { clinicId: "c1", type: "earn", items: [{ name: "볼펜 (10자루)" }] },
];

const ordered = sortPromo(PROMOS, "c1", SPENDS);
// 정기 발송 품목(물티슈)이 주문 이력과 무관하게 최상단
assert.equal(ordered[0].item.id, "p3");
assert.equal(ordered[0].regular, true);
// 그다음 주문 횟수 순 — 종이컵 3회, 각티슈 2회
assert.deepEqual(ordered.slice(1).map(r => r.item.id), ["p2", "p1", "p4"]);
assert.deepEqual(ordered.slice(1).map(r => r.orders), [3, 2, 0]);
// 주문 이력이 같으면 원래 등록 순서를 지킨다
assert.equal(ordered[3].item.id, "p4");

// 거래처 미선택이면 원래 순서 그대로
assert.deepEqual(sortPromo(PROMOS, "", SPENDS).map(r => r.item.id), ["p1", "p2", "p3", "p4"]);
// 정기 품목이 없는 거래처는 주문 횟수만으로 정렬된다
assert.deepEqual(sortPromo(PROMOS, "c2", SPENDS).map(r => r.item.id), ["p4", "p1", "p2", "p3"]);

// --- getRegularDispatchReviewRows: 정기 발송 누락 의심 ---
const gapFn = new Function(
  `${grab(html, "today")}\n${grab(html, "isIsoDate")}\n${grab(html, "getRegularDispatchReviewRows")}; return getRegularDispatchReviewRows;`
)();

const GAP_CLINICS = [
  { id: "g1", name: "월간치과", noMileage: true },            // 30일 주기
  { id: "g2", name: "분기치과", dualTrack: true },            // 90일 주기
  { id: "g3", name: "정상치과", noMileage: true },            // 최근에 보냄
  { id: "g4", name: "마일리지치과", rate: 15 },               // 정기 발송 거래처가 아님
  { id: "g5", name: "첫발송치과", noMileage: true },          // 이력 1건
  { id: "g6", name: "미발송치과", noMileage: true },          // 보낸 적 없음
];
const spend = (clinicId, date) => ({ id: date + clinicId, clinicId, type: "spend", date, amount: 1, createdAt: 1 });
const GAP_TXS = [
  // 월간치과: 30일 간격으로 보내다 2026-06-01 이후 끊김 → 기준 45일, 91일 경과
  spend("g1", "2026-04-02"), spend("g1", "2026-05-02"), spend("g1", "2026-06-01"),
  // 분기치과: 91일 간격 → 기준 137일, 120일 경과 → 아직 누락 아님
  spend("g2", "2026-02-01"), spend("g2", "2026-05-03"),
  // 정상치과: 30일 주기, 최근 발송
  spend("g3", "2026-07-05"), spend("g3", "2026-08-04"),
  // 첫발송치과: 한 건뿐, 60일 경과 → 45일 기준 초과
  spend("g5", "2026-07-03"),
  // 마일리지치과는 정기 발송 거래처가 아니라 대상에서 빠진다
  spend("g4", "2026-01-01"),
];
const gaps = gapFn("2026-08-31", GAP_CLINICS, GAP_TXS);

// 정기 발송 거래처만, 그중 늦은 곳만
assert.deepEqual(gaps.map(r => r.clinic.id), ["g1", "g5"]);
// 월간치과: 중앙값 30일 → 기준 45일
assert.equal(gaps[0].cycleDays, 30);
assert.equal(gaps[0].threshold, 45);
assert.equal(gaps[0].lastDate, "2026-06-01");
assert.equal(gaps[0].overdueDays, 91);
// 이력 1건이면 주기를 못 재고 고정 45일
assert.equal(gaps[1].cycleDays, null);
assert.equal(gaps[1].threshold, 45);

// 주기가 짧아도 최소 14일은 기다린다 — 주 단위 발송이 이틀 늦었다고 뜨면 안 된다
const weekly = gapFn("2026-08-31", [{ id: "w1", name: "주간치과", noMileage: true }], [
  spend("w1", "2026-08-03"), spend("w1", "2026-08-10"), spend("w1", "2026-08-17"), spend("w1", "2026-08-24"),
]);
assert.equal(weekly.length, 0);   // 7일 주기, 7일 경과 → 14일 기준 미달
const weeklyLate = gapFn("2026-09-10", [{ id: "w1", name: "주간치과", noMileage: true }], [
  spend("w1", "2026-08-03"), spend("w1", "2026-08-10"), spend("w1", "2026-08-17"), spend("w1", "2026-08-24"),
]);
assert.equal(weeklyLate.length, 1);
assert.equal(weeklyLate[0].threshold, 14);

// 같은 날 여러 건은 발송 1회로 센다 (간격 계산이 0일로 오염되면 안 된다)
const sameDayDispatch = gapFn("2026-08-31", [{ id: "s1", name: "중복치과", noMileage: true }], [
  spend("s1", "2026-05-01"), { ...spend("s1", "2026-05-01"), id: "dup" }, spend("s1", "2026-06-01"),
]);
assert.equal(sameDayDispatch[0].cycleDays, 31);

// 늦은 정도(lateBy) 순으로 정렬한다 — 경과일 순이면 분기 거래처가 늘 위에 온다
const order = gapFn("2026-08-31", [
  { id: "a", name: "가", noMileage: true }, { id: "b", name: "나", noMileage: true },
], [
  spend("a", "2026-01-01"), spend("a", "2026-04-01"), spend("a", "2026-05-01"),  // 분기급, 122일 경과
  spend("b", "2026-06-20"), spend("b", "2026-07-05"),                            // 15일 주기, 57일 경과
]);
assert.deepEqual(order.map(r => r.clinic.id), ["b", "a"]);

// --- mergeMileageState: 로그인 시 양쪽 기록을 합치는가 (손실 금지) ---
const mergeFns = new Function(
  `${grab(html, "mergeById")}\n${grab(html, "mergeMileageState")}\n${grab(html, "mergeSummary")};` +
  `return { mergeMileageState, mergeSummary };`
)();

// 실제로 벌어진 상황: 한쪽 PC에만 백년약속치과 7월 적립이 있었다.
const LOCAL = {
  clinics: [
    { id: "c1", name: "백년약속치과", rate: 15, updatedAt: 200 },
    { id: "c2", name: "이PC에만치과", rate: 10, updatedAt: 100 },
  ],
  transactions: [
    { id: "t1", clinicId: "c1", type: "earn", amount: 139986 },
    { id: "t9", clinicId: "c1", type: "earn", amount: 127109 },   // 이 PC에만 있는 7월 적립
  ],
  rxDrugs: [{ id: "d1", name: "록소리펜", price: 125 }],
  promoItems: [{ id: "p1", name: "종이컵" }],
  appSettings: { orderDates: ["2026-09-01"], promoSheetUrl: "" },
  reportSnapshots: { c1: { at: 500, balance: 10 } },
};
const SERVER = {
  clinics: [
    { id: "c1", name: "백년약속치과(구)", rate: 15, updatedAt: 100 },  // 더 오래된 수정
    { id: "c3", name: "서버에만치과", rate: 12, updatedAt: 100 },
  ],
  transactions: [
    { id: "t1", clinicId: "c1", type: "earn", amount: 139986 },
    { id: "t2", clinicId: "c3", type: "earn", amount: 5000 },
  ],
  rxDrugs: [{ id: "d2", name: "모사프리", price: 103 }],
  promoItems: [{ id: "p2", name: "각티슈" }],
  appSettings: { orderDates: ["2026-08-01"], promoSheetUrl: "https://sheet" },
  reportSnapshots: { c1: { at: 100, balance: 99 }, c3: { at: 300, balance: 7 } },
};

const merged = mergeFns.mergeMileageState(LOCAL, SERVER);
// 거래는 어느 쪽도 사라지지 않는다 — 특히 이 PC에만 있던 t9
assert.deepEqual(merged.transactions.map(t => t.id).sort(), ["t1", "t2", "t9"]);
// 거래처도 합집합
assert.deepEqual(merged.clinics.map(c => c.id).sort(), ["c1", "c2", "c3"]);
// 같은 거래처는 updatedAt이 최신인 쪽을 쓴다
assert.equal(merged.clinics.find(c => c.id === "c1").name, "백년약속치과");
// 약품·판촉물도 합집합
assert.deepEqual(merged.rxDrugs.map(d => d.id).sort(), ["d1", "d2"]);
assert.deepEqual(merged.promoItems.map(d => d.id).sort(), ["p1", "p2"]);
// 주문일은 합쳐서 정렬, 시트 URL은 비어 있지 않은 쪽
assert.deepEqual(merged.appSettings.orderDates, ["2026-08-01", "2026-09-01"]);
assert.equal(merged.appSettings.promoSheetUrl, "https://sheet");
// 보고서 스냅샷은 거래처당 하나 — 마지막 전송(at이 큰 쪽)
assert.equal(merged.reportSnapshots.c1.at, 500);
assert.equal(merged.reportSnapshots.c3.at, 300);

// 합치기 전 사용자에게 보여줄 숫자
const sum = mergeFns.mergeSummary(LOCAL, SERVER);
assert.equal(sum.localOnlyTx, 1);
assert.equal(sum.serverOnlyTx, 1);
assert.equal(sum.localOnlyClinics, 1);
assert.equal(sum.serverOnlyClinics, 1);

// 서버가 비어 있어도 로컬을 지우지 않는다
const onlyLocal = mergeFns.mergeMileageState(LOCAL, {});
assert.deepEqual(onlyLocal.transactions.map(t => t.id).sort(), ["t1", "t9"]);
// 로컬이 비어 있으면 서버 그대로
const onlyServer = mergeFns.mergeMileageState({}, SERVER);
assert.deepEqual(onlyServer.transactions.map(t => t.id).sort(), ["t1", "t2"]);

// --- nextRxPeriod: 처방 기간 자동 이어붙이기 ---
const nextRxPeriod = new Function(`${grab(html, "nextRxPeriod")}; return nextRxPeriod;`)();

// 월 단위(1일~말일)로 받아 온 거래처는 다음 달 통째로
assert.deepEqual(nextRxPeriod("2026-08-01", "2026-08-31"), { start: "2026-09-01", end: "2026-09-30" });
assert.deepEqual(nextRxPeriod("2026-09-01", "2026-09-30"), { start: "2026-10-01", end: "2026-10-31" });
// 2월(윤년 아님)과 연말 넘김
assert.deepEqual(nextRxPeriod("2026-01-01", "2026-01-31"), { start: "2026-02-01", end: "2026-02-28" });
assert.deepEqual(nextRxPeriod("2026-12-01", "2026-12-31"), { start: "2027-01-01", end: "2027-01-31" });
// 윤년 2월
assert.deepEqual(nextRxPeriod("2028-01-01", "2028-01-31"), { start: "2028-02-01", end: "2028-02-29" });

// 월 단위가 아니면 다음날부터 30일
assert.deepEqual(nextRxPeriod("2026-05-26", "2026-06-27"), { start: "2026-06-28", end: "2026-07-28" });
// 1일 시작이어도 말일로 안 끝나면 월 단위가 아니다
assert.deepEqual(nextRxPeriod("2026-08-01", "2026-08-20"), { start: "2026-08-21", end: "2026-09-20" });
// 말일로 끝나도 1일 시작이 아니면 월 단위가 아니다
assert.deepEqual(nextRxPeriod("2026-08-05", "2026-08-31"), { start: "2026-09-01", end: "2026-10-01" });

// --- getRegularPromoGapRows: 정기 품목 미등록 탐지 ---
const gapRows = new Function(`${grab(html, "getRegularPromoGapRows")}; return getRegularPromoGapRows;`)();

const GAP_C = [
  { id: "p1", name: "병행_품목없음", dualTrack: true, regularPromos: [] },
  { id: "p2", name: "병행_품목있음", dualTrack: true, regularPromos: ["종이컵"] },
  { id: "p3", name: "발송전용_품목없음", noMileage: true },
  { id: "p4", name: "마일리지전용", rate: 15 },            // 정기 거래처가 아니라 대상 아님
];
const GAP_T = [
  { clinicId: "p1", type: "spend", amount: 100000 },
  { clinicId: "p1", type: "spend", amount: 16500 },
  { clinicId: "p1", type: "spend", amount: 0 },            // 면제된 건은 금액 0이라 안 더해진다
  { clinicId: "p3", type: "spend", amount: 5000 },
  { clinicId: "p2", type: "spend", amount: 99999 },        // 품목이 등록돼 있으면 목록에 안 뜬다
  { clinicId: "p1", type: "earn", amount: 777 },           // 적립은 세지 않는다
];
const gapsFound = gapRows(GAP_C, GAP_T);

// 정기 거래처 중 품목이 비어 있는 곳만, 차감 많은 순
assert.deepEqual(gapsFound.map(r => r.clinic.id), ["p1", "p3"]);
assert.equal(gapsFound[0].spent, 116500);
assert.equal(gapsFound[1].spent, 5000);
// regularPromos가 아예 없는(undefined) 거래처도 잡는다
assert.ok(gapsFound.some(r => r.clinic.id === "p3"));
// 마일리지 전용은 대상이 아니다
assert.ok(!gapsFound.some(r => r.clinic.id === "p4"));

// --- isRegularPromoForClinic: 앱과 구글시트의 이름 표기가 달라도 면제되는가 ---
const isRegular = new Function(
  `${grab(html, "normalizeText")}\n${grab(html, "isRegularPromoForClinic")}; return isRegularPromoForClinic;`
)();

// 실제로 새던 조합: 앱은 '종이컵 (1,000개)', 시트는 '종이컵(1,000개)' — 괄호 앞 공백 차이
const C = { regularPromos: ["종이컵 (1,000개)"] };
assert.equal(isRegular(C, "종이컵(1,000개)"), true);      // 시트 표기
assert.equal(isRegular(C, "종이컵 (1,000개)"), true);     // 앱 표기
assert.equal(isRegular(C, "종이컵 (1000개)"), true);      // 쉼표 없는 표기
assert.equal(isRegular(C, "각티슈 (24개)"), false);       // 등록 안 된 품목은 차감된다

// 품목명만 등록해 둔 경우도 걸린다
const C2 = { regularPromos: ["종이컵"] };
assert.equal(isRegular(C2, "종이컵(1,000개)"), true);
assert.equal(isRegular(C2, "물티슈 (100매)"), false);

// 정기 품목이 없거나 거래처가 없으면 면제하지 않는다
assert.equal(isRegular({ regularPromos: [] }, "종이컵"), false);
assert.equal(isRegular(null, "종이컵"), false);
assert.equal(isRegular(C, ""), false);
// 빈 문자열이 등록돼 있어도 전부 면제되면 안 된다
assert.equal(isRegular({ regularPromos: ["", "  "] }, "종이컵"), false);

// --- findMischargedRegularItems / applyRegularItemRefunds: 잘못 차감된 정기 품목 정정 ---
const refundFns = new Function(
  `${grab(html, "normalizeText")}\n${grab(html, "isRegularPromoForClinic")}\n` +
  `${grab(html, "findMischargedRegularItems")}\n${grab(html, "applyRegularItemRefunds")};` +
  `return { findMischargedRegularItems, applyRegularItemRefunds };`
)();

const RC = [
  { id: "r1", name: "병행치과", dualTrack: true, regularPromos: ["종이컵 (1,000개)"] },
  { id: "r2", name: "발송전용치과", noMileage: true, regularPromos: ["각티슈"] },
  { id: "r3", name: "마일리지치과", rate: 15, regularPromos: ["종이컵"] },   // 정기 거래처가 아니다
];
const RT = [
  // 시트 표기(공백 없음)로 잘못 차감된 건
  { id: "t1", clinicId: "r1", type: "spend", amount: 16500, date: "2026-08-05",
    items: [{ name: "종이컵(1,000개)", qty: 1, price: 16500, amount: 16500 }] },
  // 정기 품목과 일반 품목이 섞인 건 — 일반 품목은 남아야 한다
  { id: "t2", clinicId: "r1", type: "spend", amount: 59000, date: "2026-07-02",
    items: [{ name: "종이컵 (1,000개)", qty: 1, price: 16500, amount: 16500 },
            { name: "각티슈 (24개)", qty: 1, price: 42500, amount: 42500 }] },
  // 이미 0인 건은 대상이 아니다
  { id: "t3", clinicId: "r1", type: "spend", amount: 0, date: "2026-06-05",
    items: [{ name: "종이컵 (1,000개)", qty: 1, price: 16500, amount: 0 }] },
  // 발송전용 거래처의 정기 품목
  { id: "t4", clinicId: "r2", type: "spend", amount: 42500, date: "2026-05-01",
    items: [{ name: "각티슈 (24개)", qty: 1, price: 42500, amount: 42500 }] },
  // 마일리지 전용 거래처는 정기 품목이 등록돼 있어도 정정 대상이 아니다
  { id: "t5", clinicId: "r3", type: "spend", amount: 16500, date: "2026-05-01",
    items: [{ name: "종이컵 (1,000개)", qty: 1, price: 16500, amount: 16500 }] },
  // 적립은 건드리지 않는다
  { id: "t6", clinicId: "r1", type: "earn", amount: 99999, date: "2026-05-01" },
];

const found = refundFns.findMischargedRegularItems(RC, RT);
// 되돌릴 금액 많은 순. t2는 59,000짜리 차감이지만 되돌릴 것은 종이컵 16,500뿐이다.
assert.deepEqual(found.map(r => r.tx.id), ["t4", "t1", "t2"]);
assert.equal(found.find(r => r.tx.id === "t2").refund, 16500);   // 섞인 건은 정기 품목만
assert.equal(found.find(r => r.tx.id === "t2").after, 42500);    // 일반 품목은 남는다

refundFns.applyRegularItemRefunds(found);
const byId = Object.fromEntries(RT.map(t => [t.id, t]));
assert.equal(byId.t1.amount, 0);
assert.equal(byId.t2.amount, 42500);                              // 각티슈만 남았다
assert.equal(byId.t2.items.find(i => i.name.includes("각티슈")).amount, 42500);
assert.equal(byId.t2.items.find(i => i.name.includes("종이컵")).amount, 0);
assert.equal(byId.t4.amount, 0);
assert.equal(byId.t5.amount, 16500);                              // 마일리지 전용은 그대로
assert.equal(byId.t6.amount, 99999);                              // 적립도 그대로
assert.ok(byId.t1.memo.includes("정기 품목 정정"));                // 추적 가능하게 표시
// 발송 기록 자체는 남는다 — 지우면 발송 현황에서 그 달이 비어 누락처럼 보인다
assert.equal(byId.t1.items.length, 1);

// 두 번 돌려도 더 깎이지 않는다
assert.equal(refundFns.findMischargedRegularItems(RC, RT).length, 0);

console.log("OK — 거래처 타임라인·판촉물 정렬·정기 발송 누락·서버 병합·처방 기간·정기 품목 미등록·면제 판정·정기 품목 정정 검증 통과");
