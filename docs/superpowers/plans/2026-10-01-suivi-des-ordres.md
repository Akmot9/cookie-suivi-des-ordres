# Suivi des ordres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Cookie Clicker (Steam) mod that adds a "Portefeuille" button to the Bank row and shows a lot-based ledger of stock-market orders: FIFO sales, pro-rata fees, realized and unrealized P/L, unknown-cost stock kept apart.

**Architecture:** One file `mod/main.js` with three units: `Ledger` (pure), `render` (pure, returns HTML), `install` (wraps `buyGood`/`sellGood`, adds the button and panel, reconciles stock). `module.exports` guard for Node tests; `typeof Game` guard registers the mod in the game.

**Tech Stack:** ES5-style JavaScript, Node 24 `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-01-suivi-des-ordres-design.md`

## Global Constraints

- Mod ID is exactly `suivi des ordres`; `info.txt` has `"AllowSteamAchievs": 1`.
- Bank is `Game.ObjectsById[5]`; the row is `#row5`, buttons in `#row5 .productButtons`. Button id `sdoButton`, panel id `sdoPanel`.
- Unit fee = `val × (overhead − 1)` with `overhead = 1 + 0.01 × 20 × 0.95^brokers`.
- Unknown-cost stock is sold first and never enters P/L. `reconcile` never records realized P/L.
- 1 $ = `game.cookiesPsRawHighest` cookies. Numbers use the game short scale: k, M, B, T, Qa, Qi.
- No emoji / non-Latin-1 characters in the panel; every dynamic text goes through `esc()`.
- Every wrapper calls the original and returns its value. Mod errors are caught and only disable the mod.
- Test command: `node --test test/*.test.js`.

## Review Focus

1. **A partial sale across several lots.** FIFO must consume the oldest lot fully, then part of the next, and fees must follow the sold quantities. Test: Task 1 `partial sale across two lots is FIFO with pro-rata fees`.
2. **Stock bought before the mod existed.** It must be shown as unknown cost and excluded from P/L, and sold first. Test: Task 1 `unknown stock sells first and never enters P/L`.
3. **The game's stock drifts from the ledger** (purchase made while mod disabled, or save corrupted). `reconcile` must realign without inventing gains. Test: Task 1 `reconcile both ways`.
4. **A buy the game refuses** (`buyGood` returns `false`, e.g. not enough cookies). Nothing must be recorded. Test: Task 3 `refused buy records nothing`.
5. **Save content is garbage.** Load must leave an empty ledger, not throw. Test: Task 1 `invalid save gives an empty ledger`.

---

## File Structure

```
mod/info.txt
mod/main.js                 Ledger + render + install + registration
test/ledger.test.js
test/render.test.js
test/install.test.js
README.md
```

---

### Task 1: Ledger (pure logic)

**Files:**
- Create: `mod/main.js`
- Test: `test/ledger.test.js`

**Interfaces:**
- `new Ledger()`
- `.buy(id, qty, val, overhead, t)`
- `.sell(id, qty, val, t)` → `{ known, unknown }` quantities sold
- `.reconcile(id, gameStock)`
- `.position(id, val)` → `{ qtyKnown, qtyUnknown, capital, value, unrealized, realized, fees, pru, lots: [{t, qty, unitPrice, unitFee, unrealized}] }`
- `.totals(prices)` where `prices = {id: val}` → `{ value, capital, unrealized, realized, fees }`
- `.save()` → JSON string; `.load(str)`; `.ids()` → array of ids with any state.
- Export `Ledger`.

- [ ] **Step 1: Write the failing tests**

`test/ledger.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { Ledger } = require('../mod/main.js');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ' got ' + a + ' expected ' + b);
const OH = 1.2; // 0 brokers

test('a buy creates a lot with price and fee per unit', () => {
  const L = new Ledger();
  L.buy(0, 10, 5, OH, 100);
  const p = L.position(0, 5);
  assert.strictEqual(p.qtyKnown, 10);
  near(p.capital, 60);          // 10 × (5 + 1)
  near(p.pru, 6);
  near(p.unrealized, -10);      // 50 − 60
  assert.deepStrictEqual(p.lots.map(l => [l.t, l.qty, l.unitPrice]), [[100, 10, 5]]);
  near(p.lots[0].unitFee, 1);
});

test('partial sale across two lots is FIFO with pro-rata fees', () => {
  const L = new Ledger();
  L.buy(0, 10, 5, OH, 1);   // cost 50, fee 10
  L.buy(0, 10, 8, OH, 2);   // cost 80, fee 16
  const sold = L.sell(0, 15, 12, 3);
  assert.deepStrictEqual(sold, { known: 15, unknown: 0 });
  const p = L.position(0, 12);
  assert.strictEqual(p.qtyKnown, 5);
  near(p.realized, 15 * 12 - (10 * 5 + 5 * 8) - (10 * 1 + 5 * 1.6)); // 180 − 90 − 18 = 72
  near(p.fees, 18);
  near(p.capital, 5 * (8 + 1.6));
  assert.deepStrictEqual(p.lots.map(l => l.qty), [5]);
});

test('unknown stock sells first and never enters P/L', () => {
  const L = new Ledger();
  L.reconcile(1, 20);            // 20 of unknown cost
  L.buy(1, 5, 10, OH, 1);
  let p = L.position(1, 30);
  assert.strictEqual(p.qtyUnknown, 20);
  assert.strictEqual(p.qtyKnown, 5);
  near(p.value, 150);            // only known stock is valued
  const sold = L.sell(1, 22, 30, 2);
  assert.deepStrictEqual(sold, { known: 2, unknown: 20 });
  p = L.position(1, 30);
  assert.strictEqual(p.qtyUnknown, 0);
  assert.strictEqual(p.qtyKnown, 3);
  near(p.realized, 2 * 30 - 2 * 10 - 2 * 2);
});

test('reconcile both ways', () => {
  const L = new Ledger();
  L.buy(2, 10, 5, OH, 1);
  L.reconcile(2, 14);            // game has 4 more: unknown
  assert.strictEqual(L.position(2, 5).qtyUnknown, 4);
  L.reconcile(2, 7);             // game has 7 fewer: unknown first, then FIFO lots, no realized
  const p = L.position(2, 5);
  assert.strictEqual(p.qtyUnknown, 0);
  assert.strictEqual(p.qtyKnown, 7);
  near(p.realized, 0);
  L.reconcile(2, 7);             // no change
  assert.strictEqual(L.position(2, 5).qtyKnown, 7);
});

test('totals add every good', () => {
  const L = new Ledger();
  L.buy(0, 10, 5, OH, 1);
  L.buy(3, 2, 40, OH, 1);
  L.sell(3, 1, 60, 2);
  const t = L.totals({ 0: 6, 3: 50 });
  near(t.value, 60 + 50);
  near(t.capital, 60 + 48);
  near(t.unrealized, 110 - 108);
  near(t.realized, 60 - 40 - 8);
  near(t.fees, 8);
});

test('save and load round-trip', () => {
  const L = new Ledger();
  L.buy(0, 10, 5, OH, 1);
  L.sell(0, 3, 9, 2);
  L.reconcile(4, 2);
  const M = new Ledger();
  M.load(L.save());
  assert.deepStrictEqual(M.position(0, 9), L.position(0, 9));
  assert.strictEqual(M.position(4, 1).qtyUnknown, 2);
  assert.deepStrictEqual(M.ids().sort(), [0, 4]);
});

test('invalid save gives an empty ledger', () => {
  const L = new Ledger();
  L.load('{"lots":');
  L.load('null');
  L.load('');
  assert.deepStrictEqual(L.ids(), []);
  assert.strictEqual(L.position(0, 1).qtyKnown, 0);
});

test('selling more than owned is clamped', () => {
  const L = new Ledger();
  L.buy(0, 3, 5, OH, 1);
  assert.deepStrictEqual(L.sell(0, 10, 9, 2), { known: 3, unknown: 0 });
  assert.strictEqual(L.position(0, 9).qtyKnown, 0);
});
```

- [ ] **Step 2: Run and check they fail**

Run: `node --test test/*.test.js`
Expected: `Cannot find module '../mod/main.js'`.

- [ ] **Step 3: Implement**

`mod/main.js`:
```js
/* Suivi des ordres — lot-based ledger for Cookie Clicker's stock market */
(function () {
  'use strict';

  function Ledger() {
    this.lots = {};      // id -> [{ t, qty, unitPrice, unitFee }]
    this.realized = {};  // id -> { proceeds, cost, fees }
    this.unknown = {};   // id -> qty of unknown cost
  }

  Ledger.prototype._lots = function (id) { return this.lots[id] || (this.lots[id] = []); };
  Ledger.prototype._real = function (id) {
    return this.realized[id] || (this.realized[id] = { proceeds: 0, cost: 0, fees: 0 });
  };

  Ledger.prototype.buy = function (id, qty, val, overhead, t) {
    if (!(qty > 0)) return;
    this._lots(id).push({ t: t, qty: qty, unitPrice: val, unitFee: val * (overhead - 1) });
  };

  // Consume quantities: unknown stock first, then lots FIFO. Returns what was consumed.
  Ledger.prototype._consume = function (id, qty, onLot) {
    var out = { known: 0, unknown: 0 };
    var u = this.unknown[id] || 0;
    var fromUnknown = Math.min(u, qty);
    this.unknown[id] = u - fromUnknown;
    out.unknown = fromUnknown;
    qty -= fromUnknown;
    var lots = this._lots(id);
    while (qty > 0 && lots.length) {
      var lot = lots[0], take = Math.min(lot.qty, qty);
      if (onLot) onLot(lot, take);
      lot.qty -= take;
      out.known += take;
      qty -= take;
      if (lot.qty <= 0) lots.shift();
    }
    return out;
  };

  Ledger.prototype.sell = function (id, qty, val) {
    var r = this._real(id);
    return this._consume(id, qty, function (lot, take) {
      r.proceeds += take * val;
      r.cost += take * lot.unitPrice;
      r.fees += take * lot.unitFee;
    });
  };

  Ledger.prototype.reconcile = function (id, gameStock) {
    var have = (this.unknown[id] || 0) + this._lots(id).reduce(function (s, l) { return s + l.qty; }, 0);
    if (gameStock > have) this.unknown[id] = (this.unknown[id] || 0) + (gameStock - have);
    else if (gameStock < have) this._consume(id, have - gameStock, null);
  };

  Ledger.prototype.position = function (id, val) {
    var lots = this.lots[id] || [], r = this.realized[id] || { proceeds: 0, cost: 0, fees: 0 };
    var qty = 0, capital = 0;
    var detail = lots.map(function (l) {
      qty += l.qty;
      capital += l.qty * (l.unitPrice + l.unitFee);
      return { t: l.t, qty: l.qty, unitPrice: l.unitPrice, unitFee: l.unitFee, unrealized: l.qty * (val - l.unitPrice - l.unitFee) };
    });
    return {
      qtyKnown: qty, qtyUnknown: this.unknown[id] || 0, capital: capital, value: qty * val,
      unrealized: qty * val - capital, realized: r.proceeds - r.cost - r.fees, fees: r.fees,
      pru: qty > 0 ? capital / qty : 0, lots: detail,
    };
  };

  Ledger.prototype.ids = function () {
    var self = this, set = {};
    Object.keys(this.lots).forEach(function (k) { if (self.lots[k].length) set[k] = 1; });
    Object.keys(this.realized).forEach(function (k) { set[k] = 1; });
    Object.keys(this.unknown).forEach(function (k) { if (self.unknown[k] > 0) set[k] = 1; });
    return Object.keys(set).map(Number);
  };

  Ledger.prototype.totals = function (prices) {
    var self = this, t = { value: 0, capital: 0, unrealized: 0, realized: 0, fees: 0 };
    this.ids().forEach(function (id) {
      var p = self.position(id, prices[id] || 0);
      t.value += p.value; t.capital += p.capital; t.unrealized += p.unrealized;
      t.realized += p.realized; t.fees += p.fees;
    });
    return t;
  };

  Ledger.prototype.save = function () {
    return JSON.stringify({ v: 1, lots: this.lots, realized: this.realized, unknown: this.unknown });
  };

  Ledger.prototype.load = function (str) {
    this.lots = {}; this.realized = {}; this.unknown = {};
    var d;
    try { d = JSON.parse(str); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;
    var self = this;
    Object.keys(d.lots || {}).forEach(function (k) {
      if (Array.isArray(d.lots[k])) self.lots[k] = d.lots[k].filter(function (l) { return l && l.qty > 0; });
    });
    Object.keys(d.realized || {}).forEach(function (k) {
      var r = d.realized[k] || {};
      self.realized[k] = { proceeds: +r.proceeds || 0, cost: +r.cost || 0, fees: +r.fees || 0 };
    });
    Object.keys(d.unknown || {}).forEach(function (k) { if (d.unknown[k] > 0) self.unknown[k] = +d.unknown[k]; });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { Ledger: Ledger };
})();
```

- [ ] **Step 4: Run and check they pass**

Run: `node --test test/*.test.js`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mod/main.js test/ledger.test.js
git commit -m "feat: lot-based ledger with FIFO sales and pro-rata fees"
```

---

### Task 2: render (pure HTML)

**Files:**
- Modify: `mod/main.js` (add `TEXT`, `esc`, `shortNum`, `money`, `render` before the export)
- Test: `test/render.test.js`

**Interfaces:**
- `render(view, opened)` where:
  - `view = { cps, totals: {value, capital, unrealized, realized, fees}, goods: [{ id, name, val, rest, max, position }] }` with `position` from `Ledger.position`;
  - `opened` is an object `{id: true}` of goods whose lots are expanded.
- Row: `<div class="sdo-row" data-id="N">`; positive P/L cells get class `sdo-pos`, negative `sdo-neg`; unknown qty shown as `+N coût inconnu`; lots in `<div class="sdo-lots">`.
- Export `render`.

- [ ] **Step 1: Write the failing tests**

`test/render.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { Ledger, render } = require('../mod/main.js');

function view() {
  const L = new Ledger();
  L.buy(0, 10, 5, 1.2, 1000);
  L.sell(0, 4, 9, 1001);
  L.reconcile(2, 3);
  L.buy(2, 1, 20, 1.2, 1002);
  const prices = { 0: 11, 2: 15 };
  return {
    cps: 1e8,
    totals: L.totals(prices),
    goods: [
      { id: 0, name: 'Céréales', val: 11, rest: 10, max: 110, position: L.position(0, 11) },
      { id: 2, name: 'Beurre', val: 15, rest: 30, max: 62, position: L.position(2, 15) },
    ],
  };
}

test('summary and rows in French with $ and cookies', () => {
  const html = render(view(), {});
  assert.match(html, /Valeur de marché/);
  assert.match(html, /P\/L latent/);
  assert.match(html, /P\/L réalisé/);
  assert.match(html, /Frais payés/);
  assert.match(html, /Céréales/);
  assert.match(html, /6,00 \$/);                 // PRU of Céréales
  assert.match(html, /\+3 coût inconnu/);
  assert.strictEqual((html.match(/class="sdo-row"/g) || []).length, 2);
  assert.match(html, /B cookies|M cookies/);
});

test('positive and negative P/L get colour classes', () => {
  const html = render(view(), {});
  assert.match(html, /sdo-pos/);   // Céréales unrealized 6×11 − 36 > 0
  assert.match(html, /sdo-neg/);   // Beurre: 15 − 24 < 0
});

test('lots are shown only for opened goods', () => {
  assert.doesNotMatch(render(view(), {}), /sdo-lots/);
  const html = render(view(), { 0: true });
  assert.strictEqual((html.match(/sdo-lots/g) || []).length, 1);
  assert.match(html, /6 × 5,00 \$/);
});

test('escapes html and uses only latin-1 text', () => {
  const v = view();
  v.goods[0].name = '<b>x</b>';
  const html = render(v, { 0: true });
  assert.doesNotMatch(html, /<b>x/);
  assert.match(html, /&lt;b&gt;x/);
  assert.deepStrictEqual([...html].filter(ch => ch.codePointAt(0) > 0xff), []);
});
```

- [ ] **Step 2: Run and check they fail**

Run: `node --test test/*.test.js`
Expected: `render is not a function`.

- [ ] **Step 3: Implement**

Insert before the export line:
```js
  var TEXT = {
    title: 'Portefeuille', value: 'Valeur de marché', capital: 'Capital investi', unrealized: 'P/L latent',
    realized: 'P/L réalisé', fees: 'Frais payés', unknown: 'coût inconnu', cookies: 'cookies',
    cols: ['Marchandise', 'Qté', 'PRU', 'Cours', 'Écart repos', 'Valeur', 'P/L latent', 'P/L réalisé'],
    lotCols: 'heure · qté × prix (+ frais) · latent',
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shortNum(n) {
    var units = [[1e18, 'Qi'], [1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(n) >= units[i][0]) return (n / units[i][0]).toFixed(1).replace('.', ',') + ' ' + units[i][1];
    }
    return String(Math.round(n));
  }
  function dollars(n) { return n.toFixed(2).replace('.', ',') + ' $'; }
  function signed(n) { return (n > 0 ? '+' : '') + dollars(n); }
  function plClass(n) { return n > 0 ? ' sdo-pos' : n < 0 ? ' sdo-neg' : ''; }
  function money(n, cps) { return esc(signed(n)) + ' <span class="sdo-dim">(' + esc(shortNum(n * cps)) + ' ' + TEXT.cookies + ')</span>'; }
  function hhmmss(t) {
    var d = new Date(t * 1000);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (x) { return (x < 10 ? '0' : '') + x; }).join(':');
  }

  function render(view, opened) {
    var T = view.totals, cps = view.cps;
    var h = '<div class="sdo-title">' + TEXT.title + '</div><div class="sdo-summary">' +
      '<span>' + TEXT.value + ' : <b>' + esc(dollars(T.value)) + '</b></span>' +
      '<span>' + TEXT.capital + ' : <b>' + esc(dollars(T.capital)) + '</b></span>' +
      '<span class="' + plClass(T.unrealized) + '">' + TEXT.unrealized + ' : <b>' + money(T.unrealized, cps) + '</b></span>' +
      '<span class="' + plClass(T.realized) + '">' + TEXT.realized + ' : <b>' + money(T.realized, cps) + '</b></span>' +
      '<span>' + TEXT.fees + ' : <b>' + esc(dollars(T.fees)) + '</b></span></div>';
    h += '<div class="sdo-head">' + TEXT.cols.map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</div>';
    view.goods.forEach(function (g) {
      var p = g.position;
      var qty = String(p.qtyKnown) + (p.qtyUnknown ? ' <span class="sdo-dim">+' + p.qtyUnknown + ' ' + TEXT.unknown + '</span>' : '') + ' / ' + g.max;
      var pct = g.rest ? Math.round(g.val / g.rest * 100) + ' %' : '';
      var unrealPct = p.capital > 0 ? ' (' + (p.unrealized > 0 ? '+' : '') + Math.round(p.unrealized / p.capital * 100) + ' %)' : '';
      h += '<div class="sdo-row" data-id="' + g.id + '">' +
        '<span>' + esc(g.name) + '</span><span>' + qty + '</span>' +
        '<span>' + (p.qtyKnown ? esc(dollars(p.pru)) : '-') + '</span>' +
        '<span>' + esc(dollars(g.val)) + '</span><span>' + esc(pct) + '</span>' +
        '<span>' + esc(dollars(p.value)) + '</span>' +
        '<span class="' + plClass(p.unrealized) + '">' + money(p.unrealized, cps) + esc(unrealPct) + '</span>' +
        '<span class="' + plClass(p.realized) + '">' + money(p.realized, cps) + '</span></div>';
      if (opened[g.id] && p.lots.length) {
        h += '<div class="sdo-lots"><div class="sdo-dim">' + TEXT.lotCols + '</div>' + p.lots.map(function (l) {
          return '<div>' + hhmmss(l.t) + ' · ' + l.qty + ' × ' + esc(dollars(l.unitPrice)) + ' (+' + esc(dollars(l.unitFee)) + ')' +
            ' · <span class="' + plClass(l.unrealized) + '">' + esc(signed(l.unrealized)) + '</span></div>';
        }).join('') + '</div>';
      }
    });
    return h;
  }
```
Change the export to `module.exports = { Ledger: Ledger, render: render };`.

- [ ] **Step 4: Run and check they pass**

Run: `node --test test/*.test.js`
Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mod/main.js test/render.test.js
git commit -m "feat: render the portfolio panel"
```

---

### Task 3: install, registration, info.txt, README, publish

**Files:**
- Modify: `mod/main.js` (add `PANEL_CSS`, `install`, registration; extend export)
- Create: `mod/info.txt`, `README.md`
- Test: `test/install.test.js`

**Interfaces:**
- `install(game, doc, ledger)` → `{ tick(), refresh(), disabled() }`.
  - `tick()` once per second: wraps the market when it appears, reconciles each active good, refreshes the panel if open.
  - Button `#sdoButton` (class `productButton`) appended once to `#row5 .productButtons`; panel `#sdoPanel` appended once to `#row5`, hidden by default; clicking the button toggles `style.display`.
  - Clicking a row (`.sdo-row`) toggles its lots.
- Registration exposes `Game.mods['suivi des ordres'].ledger`.

- [ ] **Step 1: Write the failing tests**

`test/install.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { install, Ledger } = require('../mod/main.js');

function fakeDoc() {
  const byId = {};
  function el(tag, id) {
    const e = { tagName: tag, id: id || '', className: '', style: {}, children: [], innerHTML: '', listeners: {},
      appendChild(c) { this.children.push(c); if (c.id) byId[c.id] = c; return c; },
      querySelector(sel) { return sel === '.productButtons' ? this.children.find(c => c.className === 'productButtons') || null : null; },
      addEventListener(t, f) { this.listeners[t] = f; },
      click() { this.listeners.click && this.listeners.click({ target: this }); },
    };
    return e;
  }
  const doc = { head: el('head'), createElement: t => el(t), getElementById: id => byId[id] || null };
  const row = el('div', 'row5'); byId.row5 = row;
  const buttons = el('div'); buttons.className = 'productButtons'; row.appendChild(buttons);
  return { doc, row, buttons };
}
function fakeGame(withMarket = true) {
  const G = { cookiesPsRawHighest: 1e8, Objects: { Bank: {} } };
  if (withMarket) G.Objects.Bank.minigame = market();
  return G;
}
function market() {
  return {
    brokers: 0,
    goodsById: [
      { id: 0, name: 'Céréales', symbol: 'CRL', val: 5, stock: 0, active: true, hidden: false },
      { id: 1, name: 'Chocolat', symbol: 'CHC', val: 15, stock: 7, active: true, hidden: false },
      { id: 2, name: 'Beurre', symbol: 'BTR', val: 20, stock: 0, active: false, hidden: false },
    ],
    getRestingVal(id) { return 10 + 10 * id; },
    getGoodMaxStock() { return 100; },
    buyGood(id, n) { this.goodsById[id].stock += n; return true; },
    sellGood(id, n) { const g = this.goodsById[id]; n = Math.min(n, g.stock); g.stock -= n; return n > 0; },
  };
}

test('adds the button and hidden panel once; button toggles the panel', () => {
  const { doc, row, buttons } = fakeDoc();
  const rec = install(fakeGame(), doc, new Ledger());
  rec.tick(); rec.tick();
  assert.strictEqual(buttons.children.filter(c => c.id === 'sdoButton').length, 1);
  assert.strictEqual(row.children.filter(c => c.id === 'sdoPanel').length, 1);
  const panel = doc.getElementById('sdoPanel');
  assert.strictEqual(panel.style.display, 'none');
  doc.getElementById('sdoButton').click();
  assert.strictEqual(panel.style.display, 'block');
  assert.match(panel.innerHTML, /Portefeuille/);
  doc.getElementById('sdoButton').click();
  assert.strictEqual(panel.style.display, 'none');
});

test('existing stock is reconciled as unknown cost; buys and sells update the ledger', () => {
  const { doc } = fakeDoc();
  const L = new Ledger();
  const G = fakeGame();
  const M = G.Objects.Bank.minigame;
  const rec = install(G, doc, L);
  rec.tick();
  assert.strictEqual(L.position(1, 15).qtyUnknown, 7);
  assert.strictEqual(M.buyGood(0, 10), true);
  assert.strictEqual(L.position(0, 5).qtyKnown, 10);
  assert.ok(Math.abs(L.position(0, 5).pru - 6) < 1e-9);
  M.goodsById[0].val = 9;
  assert.strictEqual(M.sellGood(0, 4), true);
  assert.ok(Math.abs(L.position(0, 9).realized - (36 - 20 - 4)) < 1e-9);
  rec.tick(); // reconcile must not change anything now
  assert.strictEqual(L.position(0, 9).qtyKnown, 6);
});

test('refused buy records nothing', () => {
  const { doc } = fakeDoc();
  const L = new Ledger();
  const G = fakeGame();
  G.Objects.Bank.minigame.buyGood = function () { return false; };
  const rec = install(G, doc, L);
  rec.tick();
  G.Objects.Bank.minigame.buyGood(0, 10);
  assert.strictEqual(L.position(0, 5).qtyKnown, 0);
});

test('market arriving later is wrapped once', () => {
  const { doc, buttons } = fakeDoc();
  const G = fakeGame(false);
  const rec = install(G, doc, new Ledger());
  rec.tick();
  assert.strictEqual(buttons.children.length, 0);
  G.Objects.Bank.minigame = market();
  rec.tick(); rec.tick();
  assert.strictEqual(buttons.children.filter(c => c.id === 'sdoButton').length, 1);
  assert.strictEqual(G.Objects.Bank.minigame.buyGood.__sdoWrapped, true);
});

test('panel refreshes only when open and only when html changed', () => {
  const { doc } = fakeDoc();
  const G = fakeGame();
  const rec = install(G, doc, new Ledger());
  rec.tick();
  const panel = doc.getElementById('sdoPanel');
  assert.strictEqual(panel.innerHTML, '');
  doc.getElementById('sdoButton').click();
  const first = panel.innerHTML;
  let writes = 0;
  Object.defineProperty(panel, 'innerHTML', { get: () => first, set: () => { writes++; } });
  rec.tick();
  assert.strictEqual(writes, 0);
  G.Objects.Bank.minigame.goodsById[0].val = 6;
  rec.tick();
  assert.strictEqual(writes, 1);
});

test('no document or no row is a no-op; mod error disables only itself', () => {
  assert.doesNotThrow(() => install(fakeGame(), null, new Ledger()).tick());
  const { doc } = fakeDoc();
  const L = new Ledger();
  L.reconcile = () => { throw new Error('boom'); };
  const origErr = console.error; console.error = () => {};
  let rec;
  try { rec = install(fakeGame(), doc, L); rec.tick(); } finally { console.error = origErr; }
  assert.strictEqual(rec.disabled(), true);
});
```

- [ ] **Step 2: Run and check they fail**

Run: `node --test test/*.test.js`
Expected: `install is not a function`.

- [ ] **Step 3: Implement**

Insert before the export line:
```js
  var MOD_ID = 'suivi des ordres';
  var BANK_ROW = 'row5';
  var PANEL_CSS =
    '#sdoPanel{background:rgba(0,0,0,0.6);color:#eee;font:11px sans-serif;padding:6px 8px;margin:4px 0}' +
    '#sdoPanel .sdo-title{font-weight:bold;font-size:13px;margin-bottom:4px}' +
    '#sdoPanel .sdo-summary span{display:inline-block;margin-right:14px}' +
    '#sdoPanel .sdo-head,#sdoPanel .sdo-row{display:grid;grid-template-columns:1.3fr 1.2fr 0.8fr 0.8fr 0.6fr 0.9fr 1.6fr 1.6fr;gap:4px;padding:2px 0}' +
    '#sdoPanel .sdo-head{opacity:0.6;border-bottom:1px solid #555}' +
    '#sdoPanel .sdo-row{cursor:pointer}#sdoPanel .sdo-row:hover{background:rgba(255,255,255,0.08)}' +
    '#sdoPanel .sdo-lots{padding:2px 0 4px 16px;opacity:0.9}' +
    '#sdoPanel .sdo-dim{opacity:0.6}#sdoPanel .sdo-pos{color:#6bff8f}#sdoPanel .sdo-neg{color:#ff6b6b}';

  function install(game, doc, ledger) {
    var disabled = false, opened = {}, panel = null, lastHtml = null;
    function safe(fn) {
      if (disabled) return;
      try { fn(); } catch (e) { disabled = true; console.error('[' + MOD_ID + ']', e); }
    }
    function now() { return Date.now() / 1000; }
    function marketOf() {
      var bank = game.Objects && game.Objects.Bank;
      return bank && bank.minigame && bank.minigame.goodsById ? bank.minigame : null;
    }
    function overheadOf(M) { return 1 + 0.01 * (20 * Math.pow(0.95, M.brokers || 0)); }

    function wrapMarket(M) {
      if (!M.buyGood.__sdoWrapped) {
        var origBuy = M.buyGood;
        M.buyGood = function (id) {
          var g = M.goodsById[id], before = g ? g.stock : 0, price = g ? g.val : 0, overhead = overheadOf(M);
          var out = origBuy.apply(this, arguments);
          safe(function () {
            if (out && g && g.stock > before) { ledger.buy(id, g.stock - before, price, overhead, now()); refresh(); }
          });
          return out;
        };
        M.buyGood.__sdoWrapped = true;
      }
      if (!M.sellGood.__sdoWrapped) {
        var origSell = M.sellGood;
        M.sellGood = function (id) {
          var g = M.goodsById[id], before = g ? g.stock : 0, price = g ? g.val : 0;
          var out = origSell.apply(this, arguments);
          safe(function () {
            if (g && g.stock < before) { ledger.sell(id, before - g.stock, price, now()); refresh(); }
          });
          return out;
        };
        M.sellGood.__sdoWrapped = true;
      }
    }

    function mount() {
      if (panel || !doc || !doc.getElementById) return;
      var row = doc.getElementById(BANK_ROW);
      var buttons = row && row.querySelector && row.querySelector('.productButtons');
      if (!row || !buttons) return;
      var style = doc.createElement('style');
      style.innerHTML = PANEL_CSS;
      doc.head.appendChild(style);
      var btn = doc.createElement('div');
      btn.id = 'sdoButton';
      btn.className = 'productButton';
      btn.innerHTML = TEXT.title;
      buttons.appendChild(btn);
      panel = doc.createElement('div');
      panel.id = 'sdoPanel';
      panel.style.display = 'none';
      row.appendChild(panel);
      btn.addEventListener('click', function () {
        safe(function () {
          panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
          lastHtml = null;
          refresh();
        });
      });
      panel.addEventListener('click', function (e) {
        safe(function () {
          var t = e && e.target;
          while (t && t !== panel && !(t.getAttribute && t.getAttribute('data-id'))) t = t.parentNode;
          if (!t || t === panel) return;
          var id = t.getAttribute('data-id');
          opened[id] = !opened[id];
          lastHtml = null;
          refresh();
        });
      });
    }

    function buildView(M) {
      var goods = M.goodsById.filter(function (g) { return g.active && !g.hidden; });
      var prices = {};
      goods.forEach(function (g) { prices[g.id] = g.val; });
      return {
        cps: game.cookiesPsRawHighest || 0,
        totals: ledger.totals(prices),
        goods: goods.map(function (g) {
          return { id: g.id, name: g.name, val: g.val, rest: M.getRestingVal(g.id), max: M.getGoodMaxStock(g), position: ledger.position(g.id, g.val) };
        }),
      };
    }

    function refresh() {
      var M = marketOf();
      if (!panel || !M || panel.style.display === 'none') return;
      var html = render(buildView(M), opened);
      if (html !== lastHtml) { panel.innerHTML = html; lastHtml = html; }
    }

    function tick() {
      safe(function () {
        var M = marketOf();
        if (!M) return;
        wrapMarket(M);
        mount();
        M.goodsById.forEach(function (g) { if (g.active && !g.hidden) ledger.reconcile(g.id, g.stock); });
        refresh();
      });
    }

    return { tick: tick, refresh: refresh, disabled: function () { return disabled; } };
  }

  if (typeof Game !== 'undefined' && Game.registerMod) {
    var ledger = new Ledger();
    Game.registerMod(MOD_ID, {
      ledger: ledger,
      init: function () {
        try {
          var rec = install(Game, typeof document !== 'undefined' ? document : null, ledger);
          Game.registerHook('logic', function () { if (Game.T % Game.fps === 0) rec.tick(); });
        } catch (e) { console.error('[' + MOD_ID + ']', e); }
      },
      save: function () { try { return ledger.save(); } catch (e) { return ''; } },
      load: function (str) { try { ledger.load(str); } catch (e) { console.error('[' + MOD_ID + ']', e); } },
    });
  }
```
Export: `module.exports = { Ledger: Ledger, render: render, install: install };`.

`mod/info.txt`:
```json
{
	"Name": "Suivi des ordres",
	"ID": "suivi des ordres",
	"Author": "Akmot9",
	"Description": "Portefeuille de la Bourse : un lot par achat, ventes FIFO, frais au prorata, P/L latent et réalisé.",
	"ModVersion": 1,
	"GameVersion": 2.053,
	"Date": "01/10/2026",
	"Dependencies": [],
	"AllowSteamAchievs": 1
}
```

`README.md`:
````markdown
# Suivi des ordres — Cookie Clicker

Mod for Cookie Clicker (Steam) that adds a **Portefeuille** button to the Bank row. It keeps a lot-based ledger of your stock-market orders, in the spirit of [Suivi des ordres](https://github.com/Akmot9/actions_true_perf):

- one lot per purchase (time, quantity, price, fee);
- sales are matched FIFO, so cost basis and realized P/L are rebuilt lot by lot;
- fees follow the sold quantities pro rata;
- realized P/L, unrealized P/L and fees are shown separately, in $ and in cookies;
- stock that was bought before the mod was running is shown as *coût inconnu* and never valued in the P/L.

The ledger is stored in the game save. The mod only observes: it never buys or sells for you and does not block Steam achievements.

## Install (Steam, Linux)
```bash
git clone https://github.com/Akmot9/cookie-suivi-des-ordres.git
ln -s "$PWD/cookie-suivi-des-ordres/mod" \
  "$HOME/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/mods/local/suivi des ordres"
```
Then in game: Options → Mods → enable **Suivi des ordres** → restart.

## Tests
```bash
node --test test/*.test.js
```
````

- [ ] **Step 4: Run and check they pass**

Run: `node --test test/*.test.js`
Expected: 18 tests pass.

- [ ] **Step 5: Commit, install, publish**

```bash
git add -A && git commit -m "feat: Portefeuille button, panel and game registration"
ln -s ~/github/cookie-suivi-des-ordres/mod "$HOME/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/mods/local/suivi des ordres"
gh repo create Akmot9/cookie-suivi-des-ordres --public --source=. --push --description "Cookie Clicker mod: lot-based portfolio for the stock market (FIFO, pro-rata fees, realized/unrealized P/L)"
```

- [ ] **Step 6: In-game check (with the player)**

1. Restart the game, enable **Suivi des ordres** in Options → Mods, restart.
2. The **Portefeuille** button is on the Bank row; clicking it opens the panel.
3. Existing stock appears as `+N coût inconnu`; a new buy appears as a lot with PRU = price × 1.2; a sale moves P/L to "réalisé".
4. Restart the game: the ledger is still there.
