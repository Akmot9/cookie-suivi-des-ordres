/* Suivi des ordres — lot-based ledger for Cookie Clicker's stock market */
(function () {
  'use strict';

  function Ledger() {
    this.seed = null;    // Game.seed of the run this ledger belongs to
    this.clear();
  }

  Ledger.prototype.clear = function () {
    this.seed = null;
    this.lots = {};      // id -> [{ t, qty, unitPrice, unitFee }]
    this.realized = {};  // id -> { proceeds, cost, fees }
    this.unknown = {};   // id -> qty of unknown cost
  };

  function isId(k) { return /^\d+$/.test(k); }
  function fin(x) { var n = +x; return isFinite(n) ? n : NaN; }

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
    return JSON.stringify({ v: 1, seed: this.seed, lots: this.lots, realized: this.realized, unknown: this.unknown });
  };

  Ledger.prototype.load = function (str) {
    this.clear();
    var d;
    try { d = JSON.parse(str); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;
    var self = this;
    this.seed = typeof d.seed === 'string' ? d.seed : null;
    // Only numeric ids and finite numbers get in: a bad lot must not poison the panel or the prototype chain
    Object.keys(d.lots || {}).forEach(function (k) {
      if (!isId(k) || !Array.isArray(d.lots[k])) return;
      var lots = [];
      d.lots[k].forEach(function (l) {
        if (!l || typeof l !== 'object') return;
        var lot = { t: fin(l.t) || 0, qty: fin(l.qty), unitPrice: fin(l.unitPrice), unitFee: fin(l.unitFee) };
        if (lot.qty > 0 && isFinite(lot.unitPrice) && isFinite(lot.unitFee)) lots.push(lot);
      });
      if (lots.length) self.lots[k] = lots;
    });
    Object.keys(d.realized || {}).forEach(function (k) {
      var r = d.realized[k];
      if (!isId(k) || !r || typeof r !== 'object') return;
      self.realized[k] = { proceeds: fin(r.proceeds) || 0, cost: fin(r.cost) || 0, fees: fin(r.fees) || 0 };
    });
    Object.keys(d.unknown || {}).forEach(function (k) {
      var q = fin(d.unknown[k]);
      if (isId(k) && q > 0) self.unknown[k] = q;
    });
  };

  var TEXT = {
    title: 'Portefeuille', value: 'Valeur de marché', capital: 'Capital investi', unrealized: 'P/L latent',
    realized: 'P/L réalisé', fees: 'Frais payés', unknown: 'coût inconnu', cookies: 'cookies',
    cols: ['Marchandise', 'Qté', 'PRU', 'Cours', '% repos', 'Valeur', 'P/L latent', 'P/L réalisé'],
    lotCols: 'heure · qté × prix (+ frais) · latent',
    rateNote: 'Cookies convertis au taux actuel (1 $ = 1 s de production brute max).',
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
  function money(n, cps) { return esc(signed(n)) + '<span class="sdo-dim sdo-ck">(' + esc(shortNum(n * cps)) + ' ' + TEXT.cookies + ')</span>'; }
  function plain(n, cps) { return esc(dollars(n)) + '<span class="sdo-dim sdo-ck">(' + esc(shortNum(n * cps)) + ' ' + TEXT.cookies + ')</span>'; }
  function hhmmss(t) {
    var d = new Date(t * 1000);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (x) { return (x < 10 ? '0' : '') + x; }).join(':');
  }

  function render(view, opened) {
    var T = view.totals, cps = view.cps;
    var h = '<div class="sdo-title">' + TEXT.title + '</div><div class="sdo-summary">' +
      '<span>' + TEXT.value + ' : <b>' + plain(T.value, cps) + '</b></span>' +
      '<span>' + TEXT.capital + ' : <b>' + plain(T.capital, cps) + '</b></span>' +
      '<span class="' + plClass(T.unrealized) + '">' + TEXT.unrealized + ' : <b>' + money(T.unrealized, cps) + '</b></span>' +
      '<span class="' + plClass(T.realized) + '">' + TEXT.realized + ' : <b>' + money(T.realized, cps) + '</b></span>' +
      '<span>' + TEXT.fees + ' : <b>' + plain(T.fees, cps) + '</b></span></div>' +
      '<div class="sdo-dim sdo-note">' + TEXT.rateNote + '</div>';
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
    '#sdoPanel .sdo-dim{opacity:0.6}#sdoPanel .sdo-pos{color:#6bff8f}#sdoPanel .sdo-neg{color:#ff6b6b}' +
    '#sdoPanel .sdo-ck{display:block;font-size:10px}#sdoPanel .sdo-note{font-size:10px;margin:2px 0 4px}';

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

    function goodName(g) { return String(g.name).replace('%1', game.bakeryName || ''); }
    function buildView(M) {
      // Every good is priced, hidden or not: a hidden good still has a value. Rows: active goods plus any good still held.
      var prices = {};
      M.goodsById.forEach(function (g) { prices[g.id] = g.val; });
      var goods = M.goodsById.filter(function (g) {
        var p = ledger.position(g.id, g.val);
        return (g.active && !g.hidden) || p.qtyKnown > 0 || p.qtyUnknown > 0;
      });
      return {
        cps: game.cookiesPsRawHighest || 0,
        totals: ledger.totals(prices),
        goods: goods.map(function (g) {
          return { id: g.id, name: goodName(g), val: g.val, rest: M.getRestingVal(g.id), max: M.getGoodMaxStock(g), position: ledger.position(g.id, g.val) };
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
        // The ledger belongs to one run: a new seed (ascension, hard reset, another save) starts a fresh one
        if (ledger.seed !== game.seed) { ledger.clear(); ledger.seed = game.seed; lastHtml = null; }
        M.goodsById.forEach(function (g) { ledger.reconcile(g.id, g.stock); }); // the game's stock is the truth, active or not
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
          Game.registerHook('reset', function () { ledger.clear(); }); // ascension or hard reset: the market is wiped too
        } catch (e) { console.error('[' + MOD_ID + ']', e); }
      },
      save: function () { try { return ledger.save(); } catch (e) { return ''; } },
      load: function (str) { try { ledger.load(str); } catch (e) { console.error('[' + MOD_ID + ']', e); } },
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { Ledger: Ledger, render: render, install: install };
})();
