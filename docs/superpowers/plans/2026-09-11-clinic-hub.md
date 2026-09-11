# 거래처 원스톱 화면(거래처 허브) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거래처를 하나 고르면 잔액·적립 이력·차감 이력·처방 입력·판촉물 차감·보고서를 한 화면에서 끝낸다.

**Architecture:** `index.html`에 좌우 2단 화면(`page-clinic-hub`)을 새로 만든다. 좌측은 거래처 목록, 우측은 고정 헤더 + 탭 4개. 처방·차감·보고서 폼은 마크업을 복제하지 않고 기존 DOM 노드를 패널로 **이동**시켰다가 화면을 떠날 때 되돌린다. 저장 함수(`saveRx`/`saveRedeem`/`getReportData`)는 거래처를 `<select>` 값에서 읽으므로 수정하지 않는다.

**Tech Stack:** 단일 HTML 파일(바닐라 JS, 인라인 `onclick`), localStorage, Node로 돌리는 순수 함수 검증 스크립트

**Spec:** `docs/superpowers/specs/2026-09-11-clinic-hub-design.md`

## Global Constraints

- 대상 파일은 `index.html` 하나. 빌드 도구·프레임워크·번들러 없음. 새 의존성 추가 금지
- 새 소스 파일 첫 줄은 역할을 적은 한 줄 한국어 주석 (`scripts/*.mjs` 포함)
- 잔액 계산(`getClinicBalance`)과 보고서 계산(`getReportData`)은 수정하지 않는다
- 기존 화면 6개(`dashboard`, `clinics`, `prescriptions`, `rx-history`, `redeem`, `history`, `promo-track`, `settings`)는 삭제하지 않는다
- 데이터 변경 후에는 반드시 `save()` 호출 (이 계획은 데이터를 쓰지 않으므로 해당 없음)
- 커밋 메시지는 `<type>: <설명>` 형식, 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 로컬 확인은 `python3 -m http.server 3456` (`.claude/launch.json`의 `mileage-app`)

---

### Task 1: 적립·차감 통합 타임라인 순수 함수

**Files:**
- Modify: `index.html` (`getClinicTotalRx` 정의 뒤, 약 1630행 근처에 추가)
- Create: `scripts/validate-clinic-panel.mjs`

**Interfaces:**
- Consumes: 전역 `transactions`, `txPeriod(t)`, `fmt(n)` (기존)
- Produces: `buildClinicTimeline(clinicId, txs)` → `Array<{id, kind: 'earn'|'spend', date, amount, desc}>`
  날짜 내림차순, 같은 날짜면 `createdAt` 내림차순. `txs`는 테스트에서 주입하고 앱에서는 생략(전역 `transactions` 사용)

- [ ] **Step 1: 검증 스크립트를 먼저 쓴다 (실패하는 테스트)**

`scripts/validate-clinic-panel.mjs` 생성:

```javascript
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
  `${grab(html, "txPeriod")}\n${grab(html, "buildClinicTimeline")}; return buildClinicTimeline;`
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
```

- [ ] **Step 2: 실패 확인**

```bash
node scripts/validate-clinic-panel.mjs
```

Expected: FAIL — `buildClinicTimeline을 찾지 못했습니다.`

- [ ] **Step 3: 함수 구현**

`index.html`의 `getClinicTotalRx` 함수 정의가 끝난 직후에 추가:

```javascript
// 거래처 하나의 적립·차감을 한 줄씩 합쳐 최신순으로 돌려준다. 요약 탭이 쓴다.
// txs는 테스트에서 주입하기 위한 것 — 앱에서는 전역 transactions를 쓴다.
function buildClinicTimeline(clinicId, txs) {
  const source = txs || transactions;
  return source
    .filter(t => t.clinicId === clinicId)
    .map(t => ({
      id: t.id,
      kind: t.type,
      date: t.date || '',
      amount: t.amount || 0,
      desc: t.type === 'earn'
        ? `${txPeriod(t)} 처방 · 적립률 ${t.rate}%`
        : (t.items || []).map(i => `${i.name} × ${i.qty || 1}개`).join(', ') || '-',
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || 0);
}
```

주의: 위 구현은 같은 날짜 정렬이 빠져 있어 Step 4에서 테스트가 실패한다. 그때 `createdAt` 비교를 더한다.

- [ ] **Step 4: 테스트 실행 — 같은 날짜 케이스 실패 확인 후 보정**

```bash
node scripts/validate-clinic-panel.mjs
```

Expected: 처음에는 `["a","b"]` vs `["b","a"]`로 FAIL. `map`에서 `createdAt: t.createdAt || 0`을 함께 담고 정렬을 아래로 바꾼다:

```javascript
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
```

다시 실행해 `OK — 거래처 타임라인 검증 통과` 확인.

- [ ] **Step 5: 커밋**

```bash
git add index.html scripts/validate-clinic-panel.mjs
git commit -m "feat: 거래처 적립·차감 통합 타임라인 함수

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 폼 이동 헬퍼 (mountTab / restoreTabs)

**Files:**
- Modify: `index.html:415` 부근 (`#page-prescriptions`의 2단 그리드 div에 id 부여)
- Modify: `index.html:530` 부근 (`#page-redeem`의 2단 그리드 div에 id 부여)
- Modify: `index.html:1009` 부근 (보고서 모달 본문에 id 부여)
- Modify: `index.html` (`navigate` 함수 위에 헬퍼 추가)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `mountTab(tabName, clinicId)` — `tabName`은 `'rx' | 'redeem' | 'report'`. 해당 워크에어리어를 `#hub-tab-body`로 옮기고 거래처 select 값을 `clinicId`로 맞춘 뒤 그 줄을 숨긴다
  - `restoreTabs()` — 옮긴 노드를 전부 원래 부모로 되돌리고 숨긴 줄을 복구한다
  - 상수 `HUB_TABS` — `{ rx: {...}, redeem: {...}, report: {...} }`

- [ ] **Step 1: 옮길 단위에 id 부여**

`#page-prescriptions`의 `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">`에 `id="rx-workarea"` 추가.
`#page-redeem`의 같은 형태 div에 `id="redeem-workarea"` 추가.
보고서 모달(`#report-modal`)의 `<div class="modal" style="max-width:720px">` 안쪽 내용을 감쌀 새 div를 만들지 말고, 그 `modal` div 자체에 `id="report-workarea"` 추가.

- [ ] **Step 2: 헬퍼 구현**

`function navigate(page) {` 바로 위에 추가:

```javascript
// ===== 거래처 허브: 폼 노드 이동 =====
// 처방·차감·보고서 폼은 전역 DOM id를 쓰기 때문에 복제하면 id가 겹쳐 양쪽 다 깨진다.
// 그래서 인스턴스를 하나만 두고, 탭을 열 때 그 노드를 패널로 옮겼다가 되돌린다.
const HUB_TABS = {
  rx:     { workarea: 'rx-workarea',     select: 'rx-clinic',     onMount: () => { renderRxClinicSelect(); onRxClinicChange(); } },
  redeem: { workarea: 'redeem-workarea', select: 'redeem-clinic', onMount: () => { renderRedeemClinicSelect(); renderRedeemPromoGrid(); updateRedeemBalance(); } },
  report: { workarea: 'report-workarea', select: 'report-clinic', onMount: () => renderReport() },
};

// 옮긴 노드의 원래 자리: { workareaId: {parent, nextSibling, hiddenRow} }
const hubMoved = {};

function mountTab(tabName, clinicId) {
  const conf = HUB_TABS[tabName];
  if (!conf) return;
  const node = document.getElementById(conf.workarea);
  const body = document.getElementById('hub-tab-body');
  if (!node || !body) return;

  if (!hubMoved[conf.workarea]) {
    hubMoved[conf.workarea] = { parent: node.parentNode, nextSibling: node.nextSibling, hiddenRow: null };
  }
  body.innerHTML = '';
  body.appendChild(node);

  // 거래처는 이미 정해져 있으므로 select 줄은 숨기고 값만 맞춘다.
  const sel = document.getElementById(conf.select);
  if (sel) {
    if (conf.select === 'report-clinic') {
      sel.innerHTML = clinicsSortedByBalance().map(c => `<option value="${c.id}">${clinicLabel(c)}</option>`).join('');
    }
    conf.onMount();
    sel.value = clinicId;
    sel.dispatchEvent(new Event('change'));
    const row = sel.closest('.form-group');
    if (row) { row.style.display = 'none'; hubMoved[conf.workarea].hiddenRow = row; }
  } else {
    conf.onMount();
  }
}

function restoreTabs() {
  Object.entries(hubMoved).forEach(([id, at]) => {
    const node = document.getElementById(id);
    if (node && at.parent) at.parent.insertBefore(node, at.nextSibling);
    if (at.hiddenRow) at.hiddenRow.style.display = '';
    delete hubMoved[id];
  });
}
```

`mountTab`의 `onMount()`가 select보다 먼저 불리는 순서에 주의한다. `renderRxClinicSelect()`가 select를 다시 그리므로, 값 지정은 그 뒤여야 한다 — 위 코드가 그 순서다.

- [ ] **Step 3: `navigate`에서 되돌리기**

`function navigate(page) {`의 첫 줄에 추가:

```javascript
  if (page !== 'clinic-hub') restoreTabs();
```

- [ ] **Step 4: 문법 확인**

```bash
node -e "const fs=require('fs');new Function(fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1]);console.log('syntax ok')"
```

Expected: `syntax ok`

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "feat: 거래처 허브용 폼 노드 이동 헬퍼

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 거래처 허브 껍데기와 좌측 목록

**Files:**
- Modify: `index.html:309` 부근 (사이드바 nav에 항목 추가)
- Modify: `index.html:334` 부근 (`#page-dashboard` 앞에 `#page-clinic-hub` 추가)
- Modify: `index.html` (`navigate`의 분기, 렌더 함수 추가)

**Interfaces:**
- Consumes: `getClinicBalance(id)`, `getMileageReviewRows()`, `clinicLabel(c)`, `fmtNum(n)`, Task 2의 `restoreTabs`
- Produces:
  - 전역 `hubState = { clinicId: null, tab: 'summary', filter: '', sort: 'name' }`
  - `renderClinicHub()` — 좌우 2단 전체 렌더
  - `renderClinicList()` — 좌측 목록만 렌더
  - `selectHubClinic(clinicId)` — 선택 전환, 탭을 `'summary'`로 초기화

- [ ] **Step 1: nav 항목 추가**

`index.html:309`의 대시보드 nav-item **위에** 추가:

```html
      <div class="nav-item" data-nav="clinic-hub" onclick="navigate('clinic-hub')">
        <span>🏥</span> 거래처
      </div>
```

- [ ] **Step 2: 화면 마크업 추가**

`<div id="page-dashboard" class="page active">` 바로 위에 추가:

```html
    <div id="page-clinic-hub" class="page">
      <div style="display:grid;grid-template-columns:280px 1fr;gap:16px;align-items:start">
        <div class="card" style="padding:12px">
          <input id="hub-search" placeholder="거래처 검색" oninput="hubState.filter=this.value; renderClinicList()"
            style="width:100%;padding:8px;border:1px solid var(--gray-300);border-radius:6px;margin-bottom:8px">
          <select id="hub-sort" onchange="hubState.sort=this.value; renderClinicList()"
            style="width:100%;padding:6px;border:1px solid var(--gray-300);border-radius:6px;margin-bottom:8px">
            <option value="name">이름순</option>
            <option value="balance">잔액순</option>
            <option value="overdue">오래된순</option>
          </select>
          <div id="hub-clinic-list" style="max-height:70vh;overflow-y:auto"></div>
        </div>
        <div id="hub-panel" class="card"></div>
      </div>
    </div>
```

- [ ] **Step 3: 상태와 목록 렌더 구현**

`function navigate(page) {` 위, Task 2 헬퍼 아래에 추가:

```javascript
// ===== 거래처 허브 =====
let hubState = { clinicId: null, tab: 'summary', filter: '', sort: 'name' };

function renderClinicHub() {
  renderClinicList();
  renderClinicPanel(hubState.clinicId);
}

function renderClinicList() {
  const root = document.getElementById('hub-clinic-list');
  if (!root) return;
  const overdue = new Map(getMileageReviewRows().map(r => [r.clinic.id, r.overdueDays]));
  const keyword = hubState.filter.trim();
  let list = clinics.filter(c => !keyword || c.name.includes(keyword) || (c.branch || '').includes(keyword));

  if (hubState.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  if (hubState.sort === 'balance') list.sort((a, b) => getClinicBalance(b.id).balance - getClinicBalance(a.id).balance);
  if (hubState.sort === 'overdue') list.sort((a, b) => (overdue.get(b.id) || -1) - (overdue.get(a.id) || -1));

  root.innerHTML = list.map(c => {
    const { balance } = getClinicBalance(c.id);
    const days = overdue.get(c.id);
    const active = c.id === hubState.clinicId;
    return `<div onclick="selectHubClinic('${c.id}')" style="padding:8px;border-radius:6px;cursor:pointer;margin-bottom:2px;
      background:${active ? 'var(--primary-light)' : 'transparent'}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
        <strong style="font-size:13px">${days !== undefined ? '<span style="color:var(--danger)">●</span> ' : ''}${c.name}</strong>
        <span style="font-size:13px;color:${balance < 0 ? 'var(--danger)' : 'var(--primary)'}">${fmtNum(balance)}</span>
      </div>
      <div class="text-sm" style="color:var(--gray-500)">${c.branch || ''}${days !== undefined ? ` · ${days}일 경과` : ''}</div>
    </div>`;
  }).join('') || '<div class="text-sm" style="color:var(--gray-400);padding:8px">거래처가 없습니다.</div>';
}

function selectHubClinic(clinicId) {
  restoreTabs();
  hubState.clinicId = clinicId;
  hubState.tab = 'summary';
  renderClinicList();
  renderClinicPanel(clinicId);
}
```

- [ ] **Step 4: `navigate` 분기 추가**

`if (page === 'dashboard') renderDashboard();` 줄 위에 추가:

```javascript
  if (page === 'clinic-hub') renderClinicHub();
```

- [ ] **Step 5: 임시 패널 스텁 추가 (Task 4에서 대체)**

`selectHubClinic` 아래에 추가:

```javascript
function renderClinicPanel(clinicId) {
  const root = document.getElementById('hub-panel');
  if (!root) return;
  const c = clinics.find(x => x.id === clinicId);
  root.innerHTML = c ? `<div>${c.name}</div>` : '<div class="text-sm" style="color:var(--gray-400)">왼쪽에서 거래처를 선택하세요.</div>';
}
```

- [ ] **Step 6: 브라우저 확인**

프리뷰를 띄우고 `거래처` 메뉴로 이동한다.

```bash
python3 -m http.server 3456
```

확인 항목:
- 좌측에 거래처 목록이 뜨고 잔액이 보인다
- 검색어를 넣으면 목록이 줄어든다
- 정렬 3가지가 각각 다르게 정렬한다
- 거래처를 누르면 그 줄이 강조되고 우측에 이름이 뜬다

- [ ] **Step 7: 커밋**

```bash
git add index.html
git commit -m "feat: 거래처 허브 화면과 좌측 목록

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 상세 패널 헤더와 요약 탭

**Files:**
- Modify: `index.html` (Task 3의 `renderClinicPanel` 스텁을 대체)

**Interfaces:**
- Consumes: Task 1의 `buildClinicTimeline(clinicId)`, `getClinicBalance(id)`, `fmt(n)`, `fmtNum(n)`, 기존 `showEarnDetail(txId)`, `editSpendTx(txId)`, `editClinic(id)`
- Produces:
  - `renderClinicPanel(clinicId)` — 헤더 + 탭 바 + `#hub-tab-body`
  - `showHubTab(tabName)` — 탭 전환

- [ ] **Step 1: 스텁을 실제 구현으로 교체**

Task 3에서 넣은 `renderClinicPanel`을 아래로 통째 교체:

```javascript
function renderClinicPanel(clinicId) {
  const root = document.getElementById('hub-panel');
  if (!root) return;
  const c = clinics.find(x => x.id === clinicId);
  if (!c) {
    root.innerHTML = '<div class="text-sm" style="color:var(--gray-400)">왼쪽에서 거래처를 선택하세요.</div>';
    return;
  }
  const { earned, spent, balance, initial } = getClinicBalance(c.id);
  const tabs = [['summary', '요약'], ['rx', '처방 입력'], ['redeem', '차감'], ['report', '보고서']];

  root.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
      <div>
        <h2 style="margin:0">${c.name} ${c.branch ? `<span class="text-sm" style="color:var(--gray-500)">[${c.branch}]</span>` : ''}</h2>
        <div class="text-sm" style="color:var(--gray-500);margin-top:2px">적립률 ${c.rate}%</div>
      </div>
      <button class="btn btn-outline btn-sm" onclick="editClinic('${c.id}')">수정</button>
    </div>
    <div style="display:flex;gap:20px;margin:12px 0;padding:12px;background:var(--gray-50);border-radius:8px">
      <div><div class="text-sm" style="color:var(--gray-500)">잔액</div>
        <strong style="font-size:20px;color:${balance < 0 ? 'var(--danger)' : 'var(--primary)'}">${fmt(balance)}</strong></div>
      <div><div class="text-sm" style="color:var(--gray-500)">적립${initial > 0 ? ` (이전 ${fmtNum(initial)} 포함)` : ''}</div>
        <strong style="font-size:20px;color:var(--primary)">${fmt(earned + initial)}</strong></div>
      <div><div class="text-sm" style="color:var(--gray-500)">차감</div>
        <strong style="font-size:20px;color:var(--danger)">${fmt(spent)}</strong></div>
    </div>
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--gray-200);margin-bottom:12px">
      ${tabs.map(([id, label]) => `<button onclick="showHubTab('${id}')"
        style="padding:8px 14px;border:none;background:none;cursor:pointer;font-weight:600;font-size:14px;
        color:${hubState.tab === id ? 'var(--primary-dark)' : 'var(--gray-500)'};
        border-bottom:2px solid ${hubState.tab === id ? 'var(--primary)' : 'transparent'}">${label}</button>`).join('')}
    </div>
    <div id="hub-tab-body"></div>`;

  showHubTab(hubState.tab);
}

function showHubTab(tabName) {
  const prev = hubState.tab;
  hubState.tab = tabName;
  const body = document.getElementById('hub-tab-body');
  if (!body) return;
  if (prev !== tabName) restoreTabs();

  if (tabName === 'summary') {
    body.innerHTML = renderHubSummary(hubState.clinicId);
    // 탭 표시 갱신을 위해 헤더만 다시 그린다 (무한 재귀를 피해 요약은 위에서 이미 채웠다)
    return;
  }
  mountTab(tabName, hubState.clinicId);
}

function renderHubSummary(clinicId) {
  const rows = buildClinicTimeline(clinicId);
  if (!rows.length) return '<div class="text-sm" style="color:var(--gray-400);padding:12px 0">거래 이력이 없습니다.</div>';
  return rows.map(r => `
    <div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--gray-100);font-size:13px">
      <span style="min-width:88px;color:var(--gray-500)">${r.date}</span>
      <span style="flex:1;color:var(--gray-700)">${escapeHtml(r.desc)}</span>
      <strong style="color:${r.kind === 'earn' ? 'var(--primary)' : 'var(--danger)'}">${r.kind === 'earn' ? '+' : '-'}${fmt(r.amount)}</strong>
      <button class="btn btn-outline btn-sm" onclick="${r.kind === 'earn' ? `showEarnDetail('${r.id}')` : `editSpendTx('${r.id}')`}">${r.kind === 'earn' ? '상세' : '수정'}</button>
    </div>`).join('');
}
```

`showHubTab`은 탭 버튼의 강조 색을 바꾸지 못한다. 강조는 `renderClinicPanel`이 그리므로, 탭 버튼 `onclick`을 `showHubTab` 대신 아래로 바꾼다:

```javascript
onclick="hubState.tab='${id}'; renderClinicPanel(hubState.clinicId)"
```

이렇게 하면 `renderClinicPanel`이 헤더·탭·본문을 한 번에 다시 그린다. `showHubTab`은 `renderClinicPanel` 안에서만 불린다.

- [ ] **Step 2: 문법 확인**

```bash
node -e "const fs=require('fs');new Function(fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1]);console.log('syntax ok')"
```

Expected: `syntax ok`

- [ ] **Step 3: 브라우저 확인 (요약 탭만)**

거래처를 선택해 확인:
- 헤더에 `잔액`, `적립(이전 포함)`, `차감`이 뜨고 `적립 − 차감 = 잔액`이 맞는다
- 요약 탭에 적립·차감이 최신순으로 섞여 나온다
- 적립 줄 `[상세]`가 처방 상세 모달을 연다
- 차감 줄 `[수정]`이 차감 수정 모달을 연다

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: 거래처 상세 패널 헤더와 요약 탭

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 처방 입력·차감·보고서 탭 연결

**Files:**
- Modify: `index.html` (`saveRx`, `saveRedeem` 끝부분에 갱신 호출 추가)

**Interfaces:**
- Consumes: Task 2의 `mountTab`, Task 4의 `renderClinicPanel`
- Produces: `refreshHubAfterSave()` — 허브 화면이 떠 있을 때만 목록·패널을 다시 그린다

- [ ] **Step 1: 저장 후 갱신 함수 추가**

`renderHubSummary` 아래에 추가:

```javascript
// 처방·차감을 저장하면 헤더 잔액과 요약이 즉시 맞아야 한다.
// 허브 화면이 떠 있지 않으면 아무것도 하지 않는다.
function refreshHubAfterSave() {
  if (!document.querySelector('#page-clinic-hub.active')) return;
  hubState.tab = 'summary';
  renderClinicList();
  renderClinicPanel(hubState.clinicId);
}
```

- [ ] **Step 2: `saveRx` 끝에 호출 추가**

`saveRx` 함수에서 `save();` 호출 뒤, 화면 갱신 구간에 한 줄 추가:

```javascript
  refreshHubAfterSave();
```

- [ ] **Step 3: `saveRedeem` 끝에 호출 추가**

`saveRedeem` 함수에서 `save();` 호출 뒤에 같은 줄을 추가한다.

- [ ] **Step 4: 브라우저 확인 — 탭 3개**

각 탭을 열어 확인:
- `처방 입력` 탭: 폼이 패널 안에 뜨고, **거래선 선택 줄이 안 보인다**. 사진 붙여넣기가 동작한다
- `차감` 탭: 판촉물 그리드와 잔액 안내가 뜨고 거래선 줄이 안 보인다
- `보고서` 탭: 보고서 캔버스가 그려지고 기간 수정·이미지 복사가 동작한다
- 거래처를 다른 곳으로 바꾼 뒤 같은 탭을 열면 **새 거래처** 기준으로 뜬다
- 처방을 저장하면 헤더 잔액이 즉시 바뀌고 요약 탭으로 돌아온다

- [ ] **Step 5: 브라우저 확인 — 되돌리기 (이 계획의 핵심 위험)**

- `거래처` 화면에서 `처방 입력` 탭을 연 뒤 사이드바 `마일리지` 메뉴로 이동 → 처방 입력 화면이 **정상**으로 보인다
- 같은 방법으로 `차감` 탭 → `발송 관리` 메뉴 확인
- `보고서` 탭을 연 뒤 `거래처 관리` 화면에서 `📊 보고서` 버튼 → 모달이 **정상**으로 뜬다
- 위 셋을 두 번씩 왕복해도 같은지 확인한다

- [ ] **Step 6: 커밋**

```bash
git add index.html
git commit -m "feat: 거래처 허브에 처방·차감·보고서 탭 연결

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 시작 화면 전환과 대시보드 진입점

**Files:**
- Modify: `index.html:2198` 부근 (`openMileageClinic`)
- Modify: `index.html:309` 부근 (nav의 `active` 클래스 위치)
- Modify: `index.html:334` 부근 (`#page-dashboard`의 `active` 클래스 제거, `#page-clinic-hub`로 이동)
- Modify: `index.html:5296` 부근 (INIT)

**Interfaces:**
- Consumes: Task 3의 `renderClinicHub`, `selectHubClinic`
- Produces: 없음

- [ ] **Step 1: 대시보드 `정리` 버튼이 허브로 가게 바꾼다**

`openMileageClinic`를 아래로 교체:

```javascript
function openMileageClinic(clinicId) {
  navigate('clinic-hub');
  selectHubClinic(clinicId);
  hubState.tab = 'rx';
  renderClinicPanel(clinicId);
}
```

- [ ] **Step 2: 시작 화면 전환**

- nav: `data-nav="dashboard"` 항목에서 `active` 클래스를 빼고 `data-nav="clinic-hub"` 항목에 넣는다
- 화면: `<div id="page-dashboard" class="page active">` → `class="page"`, `<div id="page-clinic-hub" class="page">` → `class="page active"`
- INIT: `renderDashboard();` 를 아래로 교체

```javascript
renderDashboard();
renderClinicHub();
```

`renderDashboard()`는 대시보드 데이터(발송 상태 동기화 포함)를 준비하므로 남겨 둔다.

- [ ] **Step 3: 브라우저 확인**

- 새로고침하면 `거래처` 화면으로 시작한다
- 대시보드 `마일리지 정리 필요`에서 `정리`를 누르면 거래처 화면으로 가서 그 거래처가 선택되고 `처방 입력` 탭이 열린다
- 사이드바 메뉴 8개를 모두 한 번씩 눌러 오류 없이 뜨는지 확인한다

- [ ] **Step 4: 전체 검증 스크립트 실행**

```bash
node scripts/validate-ocr.mjs && node scripts/validate-clinic-panel.mjs
```

Expected: 둘 다 OK

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "feat: 거래처 화면을 시작 화면으로 전환

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 체크리스트·컨텍스트 노트 갱신**

`checklist.md`를 거래처 허브 항목으로 교체하고, `context-notes.md`에 "폼 노드 이동 방식을 고른 이유와 되돌리기 위험"을 한 문단 적는다. 커밋:

```bash
git add checklist.md context-notes.md
git commit -m "docs: 거래처 허브 체크리스트·컨텍스트 노트 갱신

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
