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
