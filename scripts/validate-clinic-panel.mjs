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

console.log("OK — 거래처 타임라인·판촉물 정렬 검증 통과");
