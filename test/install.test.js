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
  const G = { cookiesPsRawHighest: 1e8, seed: 'abc', bakeryName: 'Boulangerie', Objects: { Bank: {} } };
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

test('hidden and inactive goods are still reconciled and valued; rows shown for held goods', () => {
  const { doc } = fakeDoc();
  const L = new Ledger();
  const G = fakeGame();
  const M = G.Objects.Bank.minigame;
  const rec = install(G, doc, L);
  rec.tick();
  M.buyGood(0, 10);                    // 10 at 5 → capital 60
  M.goodsById[0].hidden = true;        // player hides the good
  M.goodsById[2].stock = 4;            // inactive good gets stock (e.g. bought while mod off)
  rec.tick();
  doc.getElementById('sdoButton').click();
  const html = doc.getElementById('sdoPanel').innerHTML;
  assert.match(html, /Céréales/);
  assert.match(html, /Beurre/);
  assert.strictEqual(L.position(2, 20).qtyUnknown, 4);
  const t = L.totals({ 0: 5, 2: 20 });
  assert.ok(Math.abs(t.unrealized - (50 - 60)) < 1e-9, 'hidden good valued at its price, not 0');
});

test('a market reset (all goods inactive, stock 0) leaves no capital or P/L on screen', () => {
  const { doc } = fakeDoc();
  const L = new Ledger();
  const G = fakeGame();
  const M = G.Objects.Bank.minigame;
  const rec = install(G, doc, L);
  rec.tick();
  M.buyGood(0, 10);
  M.goodsById.forEach(g => { g.stock = 0; g.active = false; g.hidden = true; });
  rec.tick();
  assert.strictEqual(L.position(0, 5).qtyKnown, 0);
  assert.strictEqual(L.totals({ 0: 5 }).capital, 0);
});

test('a different game seed clears the ledger (save loaded without mod data)', () => {
  const { doc } = fakeDoc();
  const L = new Ledger();
  L.seed = 'old';
  L.buy(0, 10, 5, 1.2, 1);
  L.sell(0, 5, 9, 2);
  const G = fakeGame();
  G.Objects.Bank.minigame.goodsById[0].stock = 5;
  const rec = install(G, doc, L);
  rec.tick();
  assert.strictEqual(L.seed, 'abc');
  assert.strictEqual(L.position(0, 5).realized, 0);
  assert.strictEqual(L.position(0, 5).qtyUnknown, 5, 'stock of the new game is unknown cost');
});

test('good named %1 shows the bakery name', () => {
  const { doc } = fakeDoc();
  const G = fakeGame();
  G.bakeryName = 'Cyprien';
  G.Objects.Bank.minigame.goodsById[0].name = '%1';
  const rec = install(G, doc, new Ledger());
  rec.tick();
  doc.getElementById('sdoButton').click();
  assert.match(doc.getElementById('sdoPanel').innerHTML, /Cyprien/);
});

test('game registration: reset hook clears the ledger, save/load round-trip', () => {
  const hooks = {};
  let mod;
  global.Game = {
    fps: 30, T: 0, seed: 'abc', Objects: {},
    registerMod(id, m) { mod = m; },
    registerHook(name, fn) { hooks[name] = fn; },
  };
  try {
    delete require.cache[require.resolve('../mod/main.js')];
    require('../mod/main.js');
    assert.doesNotThrow(() => mod.init());
    mod.ledger.buy(0, 1, 1, 1.2, 1);
    assert.match(mod.save(), /"unitPrice":1/);
    hooks.reset(0);
    assert.deepStrictEqual(mod.ledger.ids(), []);
    mod.load('{"v":1,"seed":"abc","lots":{"1":[{"t":1,"qty":2,"unitPrice":3,"unitFee":0.6}]},"realized":{},"unknown":{}}');
    assert.strictEqual(mod.ledger.position(1, 3).qtyKnown, 2);
  } finally {
    delete global.Game;
    delete require.cache[require.resolve('../mod/main.js')];
  }
});
