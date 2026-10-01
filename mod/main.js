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

  if (typeof module !== 'undefined' && module.exports) module.exports = { Ledger: Ledger, render: render, install: install };
})();
