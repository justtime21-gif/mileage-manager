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

console.log("OK — 거래처 타임라인 검증 통과");
