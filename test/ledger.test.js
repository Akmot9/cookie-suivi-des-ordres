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
