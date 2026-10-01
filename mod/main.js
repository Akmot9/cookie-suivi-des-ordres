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

  var TEXT = {
    title: 'Portefeuille', value: 'Valeur de marché', capital: 'Capital investi', unrealized: 'P/L latent',
    realized: 'P/L réalisé', fees: 'Frais payés', unknown: 'coût inconnu', cookies: 'cookies',
    cols: ['Marchandise', 'Qté', 'PRU', 'Cours', '% repos', 'Valeur', 'P/L latent', 'P/L réalisé'],
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

  if (typeof module !== 'undefined' && module.exports) module.exports = { Ledger: Ledger, render: render };
})();
