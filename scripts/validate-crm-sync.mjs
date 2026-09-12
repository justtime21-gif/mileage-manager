// CRM 거래처 대조(matchCrmClients)와 처방통계 품목 매칭(matchCrmProducts)을 검증한다.
// 실행: node scripts/validate-crm-sync.mjs
// 이 저장소엔 테스트 러너가 없고 앱은 단일 HTML 파일이라, 소스에서 순수 함수만 뽑아 돌린다.
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
const keywords = html.slice(html.indexOf("const OCR_KEYWORDS = {"), html.indexOf("};", html.indexOf("const OCR_KEYWORDS = {")) + 2);
const build = (names, extra = "") =>
  new Function(`${extra}\n${names.map((n) => grab(html, n)).join("\n")}\nreturn { ${names.join(", ")} };`)();

const { crmNameKey, matchCrmClients, matchCrmProducts, crmMonthsForPeriod } = build(
  ["normalizeClinicName", "crmNameKey", "diffClinicAgainstCrm", "matchCrmClients", "matchCrmProducts", "crmMonthsForPeriod"],
  keywords,
);

// --- crmNameKey ---
// CRM은 인허가 상호("미소진치과의원"), 앱은 담당자가 부르는 이름("미소진치과")이라 꼬리표만 다르다.
assert.equal(crmNameKey("미소진치과의원"), crmNameKey("미소진치과"));
assert.equal(crmNameKey("서울 에스 치과의원"), crmNameKey("서울에스치과"));
assert.equal(crmNameKey("연세바른치과의원(강남)"), crmNameKey("연세바른치과"));
// 「치과」까지 지우면 서로 다른 거래처가 같은 키가 된다 — 지우지 않는다.
assert.notEqual(crmNameKey("서울치과"), crmNameKey("서울의원"));

// --- matchCrmClients: 코드가 이미 붙은 거래선은 코드로 짝짓는다 ---
{
  const clinics = [{ id: "a", name: "옛이름치과", clientCode: "100010", branch: "" }];
  const rows = [{ id: 1, name: "새이름치과의원", client_code: "100010", branch: "은평지점", address: "서울..." }];
  const { matched, newRows, unmatchedClinics } = matchCrmClients(clinics, rows);
  assert.equal(matched.length, 1);
  assert.equal(newRows.length, 0);
  assert.equal(unmatchedClinics.length, 0);
  // 이름·지점 변경을 따라갈 후보로 올린다. 반영은 사람이 체크해야 일어난다.
  const fields = matched[0].changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ["branch", "name"]);
  // 주소는 후보에 오르지 않는다 — 앱 address는 판촉물 수령지라 CRM 소재지로 덮으면 발송이 틀어진다.
  assert.equal(matched[0].changes.some((c) => c.field === "address"), false);
}

// --- matchCrmClients: 코드가 없으면 이름으로 짝지어 코드를 붙인다 ---
{
  const clinics = [{ id: "a", name: "미소진치과", branch: "은평지점" }];
  const rows = [{ id: 1, name: "미소진치과의원", client_code: "100010", branch: "은평지점" }];
  const { matched } = matchCrmClients(clinics, rows);
  assert.equal(matched.length, 1);
  const code = matched[0].changes.find((c) => c.field === "clientCode");
  assert.equal(code.to, "100010");
}

// --- matchCrmClients: 같은 이름이 여럿이면 짝짓지 않는다(사람이 고른다) ---
{
  const clinics = [{ id: "a", name: "서울치과" }];
  const rows = [
    { id: 1, name: "서울치과의원", client_code: "100010", branch: "강남지점" },
    { id: 2, name: "서울치과", client_code: "100011", branch: "은평지점" },
  ];
  const { matched, unmatchedClinics, newRows } = matchCrmClients(clinics, rows);
  assert.equal(matched.length, 0);
  assert.equal(unmatchedClinics.length, 1);
  assert.equal(unmatchedClinics[0].ambiguous, true);
  assert.equal(newRows.length, 2);
}

// --- matchCrmClients: CRM에만 있는 곳은 신규 후보, 앱에만 있는 곳은 미매칭으로 각각 남는다 ---
{
  const clinics = [{ id: "a", name: "앱에만있는치과" }];
  const rows = [{ id: 1, name: "CRM에만있는치과의원", client_code: "100012", branch: "" }];
  const { matched, newRows, unmatchedClinics } = matchCrmClients(clinics, rows);
  assert.equal(matched.length, 0);
  assert.equal(newRows.length, 1);
  assert.equal(unmatchedClinics.length, 1);
  assert.equal(unmatchedClinics[0].ambiguous, false);
}

// --- diffClinicAgainstCrm: CRM이 빈 값이면 덮어쓸 후보로 올리지 않는다 ---
{
  const clinics = [{ id: "a", name: "미소진치과", clientCode: "100010", branch: "은평지점", address: "수령지 주소" }];
  const rows = [{ id: 1, name: "미소진치과", client_code: "100010", branch: "", address: "CRM 소재지" }];
  const { matched } = matchCrmClients(clinics, rows);
  assert.deepEqual(matched[0].changes, []);
}

// --- matchCrmProducts: 시트 품목 열 이름을 앱 처방약품에 붙인다 ---
const drugs = [
  { id: "d1", name: "아목시스 캡슐 500mg(아목시실린)", price: 81, code: "053500080" },
  { id: "d2", name: "모사프리 정 5mg(모사프리드)", price: 103, code: "053500100" },
  { id: "d3", name: "오스템클로르헥시딘액0.12%(...100mL)", price: 910, code: "053500191" },
];
{
  const { matched, unmatched } = matchCrmProducts(
    [{ name: "아목시스캡슐", quantity: 120 }, { name: "모사프리정", quantity: "1,806" }],
    drugs,
  );
  assert.equal(matched.length, 2);
  assert.equal(matched[0].qty, 120);
  assert.equal(matched[1].qty, 1806); // 시트 값에 콤마가 있어도 숫자로 읽는다
  assert.equal(unmatched.length, 0);
}
// 수량 0·빈 칸은 그 달 처방이 없다는 뜻이므로 품목 줄을 만들지 않는다.
{
  const { matched } = matchCrmProducts([{ name: "아목시스캡슐", quantity: 0 }, { name: "모사프리정", quantity: "" }], drugs);
  assert.equal(matched.length, 0);
}
// 앱 약품에 없는 열은 조용히 버리지 않고 돌려준다 — 버리면 처방액이 소리 없이 작아진다.
{
  const { matched, unmatched } = matchCrmProducts([{ name: "새로나온자사품목", quantity: 30 }], drugs);
  assert.equal(matched.length, 0);
  assert.deepEqual(unmatched, [{ header: "새로나온자사품목", qty: 30 }]);
}
// 보험코드가 열 이름에 있으면 그것으로도 붙는다.
{
  const { matched } = matchCrmProducts([{ name: "053500191 클로르헥시딘 100mL", quantity: 25 }], drugs);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].drug.id, "d3");
}

// --- crmMonthsForPeriod: 시트 탭 이름으로 바꾼다 ---
assert.deepEqual(crmMonthsForPeriod("2026-06-01", "2026-06-30"), ["6월"]);
assert.deepEqual(crmMonthsForPeriod("2026-05-26", "2026-06-27"), ["5월", "6월"]);
// 잘못된 날짜가 들어와도 빈 배열을 내지 않는다 — 빈 배열이면 버튼이 조용히 아무것도 못 한다.
assert.equal(crmMonthsForPeriod("", "").length, 1);

console.log("✅ validate-crm-sync: 통과");
