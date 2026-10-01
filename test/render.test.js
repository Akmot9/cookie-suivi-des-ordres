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
  assert.match(html, /4 \/ 62/, 'quantity shown is everything held');
  assert.match(html, /dont 3 au coût inconnu/);
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

test('every summary amount is shown in $ and in cookies', () => {
  const html = render(view(), {});
  const summary = html.slice(html.indexOf('sdo-summary'), html.indexOf('sdo-head'));
  assert.strictEqual((summary.match(/cookies\)/g) || []).length, 5);
});

test('market value counts unknown-cost stock, P/L does not', () => {
  const { Ledger: L2 } = require('../mod/main.js');
  const L = new L2();
  L.reconcile(2, 63);
  const p = L.position(2, 24);
  assert.strictEqual(p.qtyUnknown, 63);
  assert.ok(Math.abs(p.valueAll - 63 * 24) < 1e-9);
  assert.strictEqual(p.value, 0);
  assert.strictEqual(p.unrealized, 0);
  const t = L.totals({ 2: 24 });
  assert.ok(Math.abs(t.value - 63 * 24) < 1e-9);
  assert.strictEqual(t.unrealized, 0);
  const html = render({ cps: 1, totals: t, goods: [{ id: 2, name: 'Beurre', val: 24, rest: 30, max: 63, position: p }] }, {});
  assert.match(html, /1512,00 \$/);
  assert.match(html, /hors coût inconnu/);
});
