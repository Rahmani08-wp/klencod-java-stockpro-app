(() => {
'use strict';

/* ============ أدوات عامة ============ */
const KEY = 'stockpro_v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayStr = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => dayStr(new Date());
const daysAgo = k => { const d = new Date(); d.setDate(d.getDate() - k); return dayStr(d); };
const N = v => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : 0; };
const sum = a => a.reduce((s, x) => s + x, 0);
const num = x => (+x || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money = x => num(x) + ' ' + esc(db.settings.currency);
const byId = (arr, id) => arr.find(x => x.id === id);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============ البيانات ============ */
const blank = () => ({
  settings: { company: 'شركتي', currency: 'دج', nextSale: 1, nextPurchase: 1 },
  products: [], parties: [], invoices: [], adjustments: []
});
let db = load();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.products)) {
      const b = blank();
      return Object.assign(b, d, { settings: Object.assign(b.settings, d.settings || {}) });
    }
  } catch (e) { /* ignore */ }
  return blank();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('تعذّر الحفظ في المتصفح'); }
}

/* ============ حسابات ============ */
const invSub = i => sum(i.lines.map(l => l.qty * l.price));
const invTotal = i => invSub(i) - (+i.discount || 0);
const invDue = i => Math.max(0, invTotal(i) - (+i.paid || 0));
const invProfit = i => sum(i.lines.map(l => (l.price - (l.cost || 0)) * l.qty)) - (+i.discount || 0);
const cmpInv = (a, b) => (b.date + String(b.ts || 0).padStart(15, '0')).localeCompare(a.date + String(a.ts || 0).padStart(15, '0'));

function stockMap() {
  const m = {};
  db.products.forEach(p => { m[p.id] = +p.stock0 || 0; });
  db.invoices.forEach(i => i.lines.forEach(l => {
    if (l.pid in m) m[l.pid] += i.type === 'purchase' ? l.qty : -l.qty;
  }));
  db.adjustments.forEach(a => { if (a.pid in m) m[a.pid] += a.qty; });
  return m;
}
const prodName = id => (byId(db.products, id) || {}).name || '(منتج محذوف)';
const partyLabel = i => i.partyId ? ((byId(db.parties, i.partyId) || {}).name || '—') : (i.type === 'sale' ? 'زبون عابر' : 'مورد غير محدد');
function stockState(p, st) {
  if (st <= 0) return ['bad', 'نفد'];
  if (+p.min > 0 && st <= +p.min) return ['warn', 'منخفض'];
  return ['ok', 'متوفر'];
}
function invState(i) {
  const due = invDue(i);
  if (due <= 0) return ['paid', 'ok', 'مسدّدة'];
  if ((+i.paid || 0) > 0) return ['partial', 'warn', 'سداد جزئي'];
  return ['unpaid', 'bad', 'غير مسدّدة'];
}
function nextNo(type) {
  const isSale = type === 'sale';
  const k = isSale ? 'nextSale' : 'nextPurchase';
  const n = db.settings[k]++;
  return (isSale ? 'ب-' : 'ش-') + String(n).padStart(4, '0');
}

/* ============ تنزيل الملفات ============ */
function csv(rows) {
  return '﻿' + rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: (type || 'text/csv') + ';charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 600);
}

/* ============ النوافذ المنبثقة ============ */
function closeModal() { $('#modal-root').innerHTML = ''; }
function modal(title, body, opt) {
  opt = opt || {};
  $('#modal-root').innerHTML =
    `<div class="backdrop"><div class="modal ${opt.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="m-head"><h3>${title}</h3><button type="button" class="icon-btn no-print" data-act="close" aria-label="إغلاق">✕</button></div>
      <form class="m-body">${body}
        <div class="m-foot no-print">
          ${opt.onSubmit ? `<button class="btn primary" type="submit">${opt.submitText || 'حفظ'}</button>` : ''}
          ${opt.extra || ''}
          <button type="button" class="btn" data-act="close">${opt.onSubmit ? 'إلغاء' : 'إغلاق'}</button>
        </div>
      </form></div></div>`;
  const form = $('#modal-root form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!opt.onSubmit) return;
    const r = opt.onSubmit(new FormData(form), form);
    if (r === false) return;
    if (r !== 'keep') closeModal();
  });
  const first = $('input:not([type=hidden]),select', form);
  if (first && !opt.noFocus) first.focus();
  return form;
}

/* ============ التوجيه ============ */
const R = {
  dashboard: { t: 'لوحة التحكم', i: '📊', f: pDashboard },
  sales: { t: 'المبيعات', i: '🧾', f: () => pInvoices('sale') },
  purchases: { t: 'المشتريات', i: '🛒', f: () => pInvoices('purchase') },
  products: { t: 'المنتجات', i: '🏷️', f: pProducts },
  inventory: { t: 'المخزون', i: '📦', f: pInventory },
  customers: { t: 'العملاء', i: '👥', f: () => pParties('customer') },
  suppliers: { t: 'الموردون', i: '🚚', f: () => pParties('supplier') },
  reports: { t: 'التقارير', i: '📈', f: pReports },
  settings: { t: 'الإعدادات', i: '⚙️', f: pSettings }
};
function render() {
  const h = location.hash.slice(1);
  const key = R[h] ? h : 'dashboard';
  $('#nav').innerHTML = Object.keys(R).map(k =>
    `<a href="#${k}" class="${k === key ? 'on' : ''}"><span class="ic">${R[k].i}</span>${R[k].t}</a>`).join('');
  $('#title').textContent = R[key].t;
  $('#brandName').textContent = db.settings.company;
  document.title = R[key].t + ' — ' + db.settings.company;
  $('#actions').innerHTML = '';
  $('#view').innerHTML = '';
  R[key].f();
  const on = $('#nav a.on');
  if (on && on.scrollIntoView) { try { on.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* ignore */ } }
}
window.addEventListener('hashchange', () => { closeModal(); render(); window.scrollTo(0, 0); });

/* ============ لوحة التحكم ============ */
const kpi = (l, v, s, c) => `<div class="kpi ${c || ''}"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

function chartSvg() {
  const days = [];
  for (let k = 6; k >= 0; k--) days.push(daysAgo(k));
  const tot = (type, d) => sum(db.invoices.filter(i => i.type === type && i.date === d).map(invTotal));
  const s = days.map(d => tot('sale', d));
  const p = days.map(d => tot('purchase', d));
  const max = Math.max(1, ...s, ...p);
  const W = 700, H = 230, pad = 24, gap = (W - 2 * pad) / 7, bw = 20, top = 22, base = H - 28;
  let o = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="مبيعات ومشتريات آخر 7 أيام">`;
  for (let g = 0; g <= 3; g++) {
    const y = base - (base - top) * g / 3;
    o += `<line x1="${pad}" x2="${W - pad}" y1="${y}" y2="${y}" stroke="currentColor" opacity=".12"/>`;
  }
  o += `<text x="${W - pad}" y="${top - 8}" text-anchor="end" direction="ltr">${num(max)}</text>`;
  days.forEach((d, i) => {
    const cx = W - pad - gap * (i + 0.5);
    const hs = (base - top) * s[i] / max, hp = (base - top) * p[i] / max;
    o += `<rect class="bar-s" x="${cx - bw - 1}" y="${base - hs}" width="${bw}" height="${hs}" rx="4"><title>مبيعات: ${num(s[i])}</title></rect>`;
    o += `<rect class="bar-p" x="${cx + 1}" y="${base - hp}" width="${bw}" height="${hp}" rx="4"><title>مشتريات: ${num(p[i])}</title></rect>`;
    o += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${d.slice(8)}/${d.slice(5, 7)}</text>`;
  });
  return o + '</svg>';
}

function invoiceRows(list) {
  return list.map(i => {
    const [st, cls, lb] = invState(i);
    return `<tr class="click" data-act="viewInvoice" data-id="${i.id}" data-st="${st}">
      <td><b>${esc(i.no)}</b></td><td>${esc(i.date)}</td><td>${esc(partyLabel(i))}</td>
      <td class="num">${num(invTotal(i))}</td><td class="num">${num(invDue(i))}</td>
      <td><span class="badge ${cls}">${lb}</span></td></tr>`;
  }).join('');
}

function pDashboard() {
  const v = $('#view');
  if (!db.products.length && !db.invoices.length) {
    v.innerHTML = `<div class="card empty"><h2 style="font-size:19px">مرحباً بك 👋</h2>
      <p>ابدأ بإضافة منتجاتك وعملائك وموردّيك، أو جرّب التطبيق أولاً ببيانات تجريبية.</p>
      <div class="actions" style="justify-content:center">
        <button class="btn primary" data-act="newProduct">+ إضافة منتج</button>
        <button class="btn" data-act="demo">تحميل بيانات تجريبية</button></div></div>`;
    return;
  }
  $('#actions').innerHTML = `<button class="btn ok" data-act="newInvoice" data-type="sale">+ فاتورة بيع</button>
    <button class="btn primary" data-act="newInvoice" data-type="purchase">+ فاتورة شراء</button>`;
  const ym = today().slice(0, 7), sm = stockMap();
  const sales = db.invoices.filter(i => i.type === 'sale'), purch = db.invoices.filter(i => i.type === 'purchase');
  const ms = sales.filter(i => i.date.startsWith(ym)), mp = purch.filter(i => i.date.startsWith(ym));
  const stockVal = sum(db.products.map(p => Math.max(0, sm[p.id]) * (+p.buy || 0)));
  const low = db.products.filter(p => stockState(p, sm[p.id])[0] !== 'ok');
  const profit = sum(ms.map(invProfit));
  v.innerHTML = `
    <div class="kpis">
      ${kpi('مبيعات الشهر', money(sum(ms.map(invTotal))), ms.length + ' فاتورة', 'ok')}
      ${kpi('مشتريات الشهر', money(sum(mp.map(invTotal))), mp.length + ' فاتورة')}
      ${kpi('الربح التقديري (الشهر)', money(profit), 'بحسب تكلفة الشراء', profit >= 0 ? 'ok' : 'bad')}
      ${kpi('قيمة المخزون', money(stockVal), db.products.length + ' صنف')}
      ${kpi('مستحقات على العملاء', money(sum(sales.map(invDue))), '', 'warn')}
      ${kpi('مستحقات للموردين', money(sum(purch.map(invDue))), '', 'warn')}
    </div>
    <div class="grid2">
      <div class="card"><h2>آخر 7 أيام</h2>${chartSvg()}
        <div class="legend"><span><i class="dot" style="background:var(--ok)"></i>مبيعات</span><span><i class="dot" style="background:var(--accent)"></i>مشتريات</span></div></div>
      <div class="card"><h2>تنبيهات المخزون (${low.length})</h2>
        ${low.length ? `<div class="tbl-wrap" style="border:0"><table style="min-width:0"><tbody>${low.slice(0, 8).map(p => {
          const [, cls, lb] = stockState(p, sm[p.id]);
          return `<tr><td>${esc(p.name)}</td><td class="num">${num(sm[p.id])}</td><td><span class="badge ${cls}">${lb}</span></td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">كل المنتجات بمستوى جيد ✅</div>'}</div>
    </div>
    <h2 style="font-size:16px;margin:4px 0 10px">أحدث الفواتير</h2>
    <div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الطرف</th><th class="num">الإجمالي</th><th class="num">المتبقي</th><th>الحالة</th></tr></thead>
    <tbody>${invoiceRows(db.invoices.slice().sort(cmpInv).slice(0, 8))}</tbody></table></div>`;
}

/* ============ الفواتير ============ */
function pInvoices(type) {
  const isSale = type === 'sale';
  $('#actions').innerHTML = `<button class="btn primary" data-act="newInvoice" data-type="${type}">+ ${isSale ? 'فاتورة بيع' : 'فاتورة شراء'}</button>`;
  const list = db.invoices.filter(i => i.type === type).sort(cmpInv);
  $('#view').innerHTML = `
    <div class="kpis">
      ${kpi('عدد الفواتير', num(list.length))}
      ${kpi('الإجمالي', money(sum(list.map(invTotal))), '', isSale ? 'ok' : '')}
      ${kpi(isSale ? 'غير محصّل' : 'غير مسدّد', money(sum(list.map(invDue))), '', 'warn')}
    </div>
    <div class="toolbar">
      <input class="search" type="search" placeholder="بحث برقم الفاتورة أو الاسم…">
      <select class="flt"><option value="all">كل الحالات</option><option value="paid">مسدّدة</option><option value="partial">سداد جزئي</option><option value="unpaid">غير مسدّدة</option></select>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>${isSale ? 'العميل' : 'المورد'}</th><th class="num">الإجمالي</th><th class="num">المتبقي</th><th>الحالة</th></tr></thead>
    <tbody id="tb">${invoiceRows(list) || ''}</tbody></table>
    ${list.length ? '' : '<div class="empty">لا توجد فواتير بعد.</div>'}</div>`;
}

let INV = null;
function lineRow() {
  return `<div class="line"><select class="l-prod">${INV.opts}</select>
    <input class="l-qty" type="number" min="0" step="any" value="1" inputmode="decimal" aria-label="الكمية">
    <input class="l-price" type="number" min="0" step="any" inputmode="decimal" aria-label="السعر">
    <span class="l-total">0</span>
    <button type="button" class="icon-btn" data-act="rmLine" title="حذف البند">✕</button></div>`;
}
function setPrice(row) {
  const o = $('.l-prod', row).selectedOptions[0];
  $('.l-price', row).value = o ? o.dataset.price : 0;
}
function calc(form) {
  let sub = 0;
  $$('.line', form).forEach(r => {
    const t = N($('.l-qty', r).value) * N($('.l-price', r).value);
    $('.l-total', r).textContent = num(t);
    sub += t;
  });
  const el = form.elements;
  const disc = Math.min(N(el.discount.value), sub);
  const total = sub - disc;
  if (el.paid.dataset.auto) el.paid.value = total ? +total.toFixed(2) : '';
  const due = Math.max(0, total - N(el.paid.value));
  const cur = ' ' + db.settings.currency;
  $('#t-sub', form).textContent = num(sub) + cur;
  $('#t-disc', form).textContent = num(disc) + cur;
  $('#t-total', form).textContent = num(total) + cur;
  $('#t-due', form).textContent = num(due) + cur;
}

function invoiceForm(type) {
  const isSale = type === 'sale';
  if (!db.products.length) { toast('أضف منتجاً واحداً على الأقل أولاً'); location.hash = 'products'; return; }
  const sm = stockMap();
  const opts = db.products.map(p =>
    `<option value="${p.id}" data-price="${isSale ? p.sell : p.buy}">${esc(p.name)}${isSale ? ' — متوفر ' + num(sm[p.id]) : ''}</option>`).join('');
  INV = { type, opts };
  const parties = db.parties.filter(p => p.type === (isSale ? 'customer' : 'supplier'));
  const body = `
    <div class="fields">
      <div class="field"><label>${isSale ? 'العميل' : 'المورد'}</label>
        <select name="party"><option value="">${isSale ? 'زبون عابر' : 'مورد غير محدد'}</option>
        ${parties.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>التاريخ</label><input type="date" name="date" value="${today()}" required></div>
    </div>
    <h2 style="margin:16px 0 8px;font-size:15px">البنود</h2>
    <div class="line-head"><span>المنتج</span><span>الكمية</span><span>السعر</span><span style="text-align:end">المجموع</span><span></span></div>
    <div class="lines" id="lines">${lineRow()}</div>
    <button type="button" class="btn sm" data-act="addLine">+ إضافة بند</button>
    <div class="fields" style="margin-top:14px">
      <div class="field"><label>خصم</label><input type="number" name="discount" min="0" step="any" value="0" inputmode="decimal"></div>
      <div class="field"><label>المبلغ المدفوع</label><input type="number" name="paid" min="0" step="any" data-auto="1" inputmode="decimal"></div>
      <div class="field full"><label>ملاحظات</label><input name="note"></div>
    </div>
    <div class="totals">
      <div><span>المجموع الفرعي</span><b id="t-sub">0</b></div>
      <div><span>الخصم</span><b id="t-disc">0</b></div>
      <div class="grand"><span>الإجمالي</span><b id="t-total">0</b></div>
      <div><span>المتبقي (دين)</span><b id="t-due">0</b></div>
    </div>`;
  const form = modal(isSale ? 'فاتورة بيع جديدة' : 'فاتورة شراء جديدة', body, {
    wide: true, submitText: 'حفظ الفاتورة', noFocus: true,
    onSubmit(fd, f) {
      const lines = [];
      $$('.line', f).forEach(r => {
        const pid = $('.l-prod', r).value, qty = N($('.l-qty', r).value), price = N($('.l-price', r).value);
        if (pid && qty > 0) lines.push({ pid, qty, price });
      });
      if (!lines.length) { toast('أضف بنداً واحداً على الأقل بكمية صحيحة'); return false; }
      if (isSale) {
        const need = {}, st = stockMap();
        lines.forEach(l => { need[l.pid] = (need[l.pid] || 0) + l.qty; });
        for (const pid in need) {
          if (need[pid] > st[pid] + 1e-9) { toast('الكمية المطلوبة من «' + prodName(pid) + '» تتجاوز المتوفر (' + num(st[pid]) + ')'); return false; }
        }
        lines.forEach(l => { l.cost = +byId(db.products, l.pid).buy || 0; });
      } else {
        lines.forEach(l => { byId(db.products, l.pid).buy = l.price; });
      }
      const sub = sum(lines.map(l => l.qty * l.price));
      const discount = Math.min(N(fd.get('discount')), sub);
      const total = sub - discount;
      const paid = Math.min(N(fd.get('paid')), total);
      const inv = { id: uid(), ts: Date.now(), type, no: nextNo(type), date: fd.get('date') || today(),
        partyId: fd.get('party') || '', lines, discount, paid, note: String(fd.get('note') || '').trim() };
      db.invoices.push(inv);
      save(); render(); toast('تم حفظ الفاتورة ' + inv.no);
      viewInvoice(inv.id);
      return 'keep';
    }
  });
  form.addEventListener('change', e => {
    if (e.target.classList.contains('l-prod')) setPrice(e.target.closest('.line'));
    calc(form);
  });
  form.addEventListener('input', e => {
    if (e.target.name === 'paid') e.target.dataset.auto = '';
    calc(form);
  });
  setPrice($('.line', form));
  calc(form);
}

function viewInvoice(id) {
  const i = byId(db.invoices, id);
  if (!i) return;
  const isSale = i.type === 'sale', total = invTotal(i), due = invDue(i);
  const rows = i.lines.map((l, k) => `<tr><td>${k + 1}</td><td>${esc(prodName(l.pid))}</td>
    <td class="num">${num(l.qty)}</td><td class="num">${num(l.price)}</td><td class="num">${num(l.qty * l.price)}</td></tr>`).join('');
  const body = `
    <div class="doc-head">
      <div><h2>${esc(db.settings.company)}</h2><div class="doc-meta">${isSale ? 'فاتورة بيع' : 'فاتورة شراء'}</div></div>
      <div class="doc-meta" style="text-align:end"><div><b style="font-size:16px;color:var(--text)">${esc(i.no)}</b></div>
        <div>${esc(i.date)}</div><div>${isSale ? 'العميل' : 'المورد'}: ${esc(partyLabel(i))}</div></div>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>#</th><th>المنتج</th><th class="num">الكمية</th><th class="num">السعر</th><th class="num">المجموع</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="totals">
      <div><span>المجموع الفرعي</span><b>${money(invSub(i))}</b></div>
      ${+i.discount ? `<div><span>الخصم</span><b>${money(i.discount)}</b></div>` : ''}
      <div class="grand"><span>الإجمالي</span><b>${money(total)}</b></div>
      <div><span>المدفوع</span><b>${money(i.paid)}</b></div>
      <div><span>المتبقي</span><b class="${due > 0 ? 'neg' : 'pos'}">${money(due)}</b></div>
    </div>
    ${i.note ? `<p class="doc-meta">ملاحظات: ${esc(i.note)}</p>` : ''}`;
  const extra = `<button type="button" class="btn" data-act="print">🖨️ طباعة</button>
    ${due > 0 ? `<button type="button" class="btn ok" data-act="payInvoice" data-id="${i.id}">تسجيل دفعة</button>` : ''}
    <button type="button" class="btn danger" data-act="delInvoice" data-id="${i.id}">حذف</button>`;
  modal(isSale ? 'تفاصيل فاتورة البيع' : 'تفاصيل فاتورة الشراء', body, { wide: true, extra });
}

function payInvoice(id) {
  const i = byId(db.invoices, id);
  if (!i) return;
  const due = invDue(i);
  modal('تسجيل دفعة — ' + esc(i.no), `<div class="fields">
    <div class="field full"><label>المتبقي: ${money(due)}</label>
    <input type="number" name="amt" min="0" step="any" value="${+due.toFixed(2)}" required inputmode="decimal"></div></div>`, {
    submitText: 'تسجيل',
    onSubmit(fd) {
      const a = N(fd.get('amt'));
      if (a <= 0) { toast('أدخل مبلغاً صحيحاً'); return false; }
      i.paid = Math.min(invTotal(i), (+i.paid || 0) + a);
      save(); render(); toast('تم تسجيل الدفعة');
    }
  });
}
function delInvoice(id) {
  const i = byId(db.invoices, id);
  if (!i) return;
  const msg = 'حذف الفاتورة ' + i.no + '؟ سيتم عكس أثرها على المخزون.';
  if (!confirm(msg)) return;
  db.invoices = db.invoices.filter(x => x.id !== id);
  save(); closeModal(); render(); toast('تم حذف الفاتورة');
}

/* ============ المنتجات ============ */
function pProducts() {
  $('#actions').innerHTML = `<button class="btn" data-act="exportProducts">تصدير CSV</button>
    <button class="btn primary" data-act="newProduct">+ منتج جديد</button>`;
  const sm = stockMap();
  const rows = db.products.map(p => {
    const [st, cls, lb] = stockState(p, sm[p.id]);
    const margin = p.sell > 0 ? ((p.sell - p.buy) / p.sell * 100) : 0;
    return `<tr data-st="${st}"><td>${esc(p.sku)}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.category)}</td>
      <td class="num">${num(p.buy)}</td><td class="num">${num(p.sell)}</td>
      <td class="num ${margin < 0 ? 'neg' : ''}">${num(margin)}%</td>
      <td class="num"><b>${num(sm[p.id])}</b> ${esc(p.unit)}</td><td><span class="badge ${cls}">${lb}</span></td>
      <td class="act"><button class="btn sm" data-act="editProduct" data-id="${p.id}">تعديل</button>
      <button class="btn sm danger" data-act="delProduct" data-id="${p.id}">حذف</button></td></tr>`;
  }).join('');
  $('#view').innerHTML = `
    <div class="toolbar"><input class="search" type="search" placeholder="بحث بالاسم أو الرمز أو الفئة…">
    <select class="flt"><option value="all">كل الحالات</option><option value="ok">متوفر</option><option value="warn">منخفض</option><option value="bad">نفد</option></select></div>
    <div class="tbl-wrap"><table><thead><tr><th>الرمز</th><th>المنتج</th><th>الفئة</th><th class="num">الشراء</th><th class="num">البيع</th><th class="num">الهامش</th><th class="num">المخزون</th><th>الحالة</th><th></th></tr></thead>
    <tbody id="tb">${rows}</tbody></table>
    ${db.products.length ? '' : '<div class="empty">لا توجد منتجات. أضف أول منتج لك.</div>'}</div>`;
}

function productForm(id) {
  const p = id ? byId(db.products, id) : {};
  const cats = Array.from(new Set(db.products.map(x => x.category).filter(Boolean)));
  modal(id ? 'تعديل منتج' : 'منتج جديد', `<div class="fields">
    <div class="field full"><label>اسم المنتج *</label><input name="name" required value="${esc(p.name || '')}"></div>
    <div class="field"><label>الرمز / الباركود</label><input name="sku" value="${esc(p.sku || '')}"></div>
    <div class="field"><label>الفئة</label><input name="category" list="cats" value="${esc(p.category || '')}"><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="field"><label>الوحدة</label><input name="unit" value="${esc(p.unit || 'وحدة')}"></div>
    <div class="field"><label>حد التنبيه (الحد الأدنى)</label><input type="number" name="min" min="0" step="any" value="${p.min == null ? 0 : p.min}" inputmode="decimal"></div>
    <div class="field"><label>سعر الشراء</label><input type="number" name="buy" min="0" step="any" value="${p.buy == null ? '' : p.buy}" inputmode="decimal"></div>
    <div class="field"><label>سعر البيع</label><input type="number" name="sell" min="0" step="any" value="${p.sell == null ? '' : p.sell}" inputmode="decimal"></div>
    <div class="field full"><label>رصيد افتتاحي</label><input type="number" name="stock0" step="any" value="${p.stock0 == null ? 0 : p.stock0}" inputmode="decimal"></div>
  </div>`, {
    onSubmit(fd) {
      const name = String(fd.get('name') || '').trim();
      if (!name) { toast('اسم المنتج مطلوب'); return false; }
      const o = { name, sku: String(fd.get('sku') || '').trim(), category: String(fd.get('category') || '').trim(),
        unit: String(fd.get('unit') || '').trim() || 'وحدة', min: N(fd.get('min')), buy: N(fd.get('buy')),
        sell: N(fd.get('sell')), stock0: N(fd.get('stock0')) };
      if (id) Object.assign(p, o); else db.products.push(Object.assign({ id: uid() }, o));
      save(); render(); toast('تم حفظ المنتج');
    }
  });
}
function delProduct(id) {
  if (db.invoices.some(i => i.lines.some(l => l.pid === id))) { toast('لا يمكن حذف منتج مرتبط بفواتير'); return; }
  if (!confirm('حذف هذا المنتج؟')) return;
  db.products = db.products.filter(p => p.id !== id);
  db.adjustments = db.adjustments.filter(a => a.pid !== id);
  save(); render(); toast('تم حذف المنتج');
}

/* ============ المخزون ============ */
function pInventory() {
  $('#actions').innerHTML = `<button class="btn primary" data-act="adjust">تسوية المخزون</button>`;
  const sm = stockMap();
  const val = sum(db.products.map(p => Math.max(0, sm[p.id]) * (+p.buy || 0)));
  const potential = sum(db.products.map(p => Math.max(0, sm[p.id]) * (+p.sell || 0)));
  const low = db.products.filter(p => stockState(p, sm[p.id])[0] === 'warn').length;
  const out = db.products.filter(p => stockState(p, sm[p.id])[0] === 'bad').length;
  const rows = db.products.map(p => {
    const [st, cls, lb] = stockState(p, sm[p.id]);
    return `<tr data-st="${st}"><td><b>${esc(p.name)}</b></td><td class="num"><b>${num(sm[p.id])}</b> ${esc(p.unit)}</td>
      <td class="num">${num(p.min)}</td><td class="num">${num(Math.max(0, sm[p.id]) * p.buy)}</td>
      <td><span class="badge ${cls}">${lb}</span></td>
      <td class="act"><button class="btn sm" data-act="adjust" data-id="${p.id}">تسوية</button></td></tr>`;
  }).join('');
  const mv = [];
  db.invoices.forEach(i => i.lines.forEach(l => mv.push({ date: i.date, ts: i.ts || 0, pid: l.pid, q: i.type === 'purchase' ? l.qty : -l.qty, ref: i.no, k: i.type === 'purchase' ? 'شراء' : 'بيع' })));
  db.adjustments.forEach(a => mv.push({ date: a.date, ts: a.ts || 0, pid: a.pid, q: a.qty, ref: a.reason || '—', k: 'تسوية' }));
  mv.sort((a, b) => (b.date + String(b.ts).padStart(15, '0')).localeCompare(a.date + String(a.ts).padStart(15, '0')));
  $('#view').innerHTML = `
    <div class="kpis">
      ${kpi('قيمة المخزون (شراء)', money(val))}
      ${kpi('القيمة بسعر البيع', money(potential), '', 'ok')}
      ${kpi('أصناف منخفضة', num(low), '', low ? 'warn' : '')}
      ${kpi('أصناف نفدت', num(out), '', out ? 'bad' : '')}
    </div>
    <div class="toolbar"><input class="search" type="search" placeholder="بحث عن منتج…">
    <select class="flt"><option value="all">كل الحالات</option><option value="ok">متوفر</option><option value="warn">منخفض</option><option value="bad">نفد</option></select></div>
    <div class="tbl-wrap"><table><thead><tr><th>المنتج</th><th class="num">الرصيد</th><th class="num">حد التنبيه</th><th class="num">القيمة</th><th>الحالة</th><th></th></tr></thead>
    <tbody id="tb">${rows}</tbody></table>${db.products.length ? '' : '<div class="empty">لا توجد منتجات.</div>'}</div>
    <h2 style="font-size:16px;margin:22px 0 10px">آخر حركات المخزون</h2>
    <div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>المنتج</th><th>النوع</th><th class="num">الكمية</th><th>المرجع</th></tr></thead>
    <tbody>${mv.slice(0, 40).map(m => `<tr><td>${esc(m.date)}</td><td>${esc(prodName(m.pid))}</td><td>${m.k}</td>
      <td class="num ${m.q >= 0 ? 'pos' : 'neg'}" dir="ltr">${m.q > 0 ? '+' : ''}${num(m.q)}</td><td>${esc(m.ref)}</td></tr>`).join('')}</tbody></table>
    ${mv.length ? '' : '<div class="empty">لا توجد حركات بعد.</div>'}</div>`;
}
function adjustForm(pid) {
  if (!db.products.length) { toast('أضف منتجاً أولاً'); return; }
  modal('تسوية المخزون', `<div class="fields">
    <div class="field full"><label>المنتج</label><select name="pid">${db.products.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="field"><label>الكمية (+ زيادة / − نقص)</label><input type="number" name="qty" step="any" required inputmode="decimal" placeholder="مثال: -3"></div>
    <div class="field"><label>التاريخ</label><input type="date" name="date" value="${today()}" required></div>
    <div class="field full"><label>السبب</label><input name="reason" placeholder="جرد، تلف، هدية…"></div></div>`, {
    onSubmit(fd) {
      const q = N(fd.get('qty'));
      if (!q) { toast('أدخل كمية غير صفرية'); return false; }
      db.adjustments.push({ id: uid(), ts: Date.now(), pid: fd.get('pid'), qty: q, date: fd.get('date') || today(), reason: String(fd.get('reason') || '').trim() });
      save(); render(); toast('تمت التسوية');
    }
  });
}

/* ============ العملاء والموردون ============ */
function pParties(type) {
  const isC = type === 'customer';
  $('#actions').innerHTML = `<button class="btn primary" data-act="newParty" data-type="${type}">+ ${isC ? 'عميل جديد' : 'مورد جديد'}</button>`;
  const list = db.parties.filter(p => p.type === type);
  const rows = list.map(p => {
    const inv = db.invoices.filter(i => i.partyId === p.id);
    const due = sum(inv.map(invDue));
    return `<tr><td><b>${esc(p.name)}</b></td><td dir="ltr" style="text-align:end">${esc(p.phone)}</td><td>${esc(p.address)}</td>
      <td class="num">${inv.length}</td><td class="num ${due > 0 ? 'neg' : ''}">${num(due)}</td>
      <td class="act"><button class="btn sm" data-act="editParty" data-id="${p.id}">تعديل</button>
      <button class="btn sm danger" data-act="delParty" data-id="${p.id}">حذف</button></td></tr>`;
  }).join('');
  $('#view').innerHTML = `
    <div class="toolbar"><input class="search" type="search" placeholder="بحث…"></div>
    <div class="tbl-wrap"><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th class="num">الفواتير</th><th class="num">${isC ? 'مستحق علينا قبضه' : 'مستحق علينا دفعه'}</th><th></th></tr></thead>
    <tbody id="tb">${rows}</tbody></table>${list.length ? '' : `<div class="empty">لا يوجد ${isC ? 'عملاء' : 'موردون'} بعد.</div>`}</div>`;
}
function partyForm(type, id) {
  const p = id ? byId(db.parties, id) : {};
  const isC = (id ? p.type : type) === 'customer';
  modal((id ? 'تعديل ' : 'إضافة ') + (isC ? 'عميل' : 'مورد'), `<div class="fields">
    <div class="field full"><label>الاسم *</label><input name="name" required value="${esc(p.name || '')}"></div>
    <div class="field"><label>الهاتف</label><input name="phone" type="tel" value="${esc(p.phone || '')}"></div>
    <div class="field"><label>العنوان</label><input name="address" value="${esc(p.address || '')}"></div></div>`, {
    onSubmit(fd) {
      const name = String(fd.get('name') || '').trim();
      if (!name) { toast('الاسم مطلوب'); return false; }
      const o = { name, phone: String(fd.get('phone') || '').trim(), address: String(fd.get('address') || '').trim() };
      if (id) Object.assign(p, o); else db.parties.push(Object.assign({ id: uid(), type }, o));
      save(); render(); toast('تم الحفظ');
    }
  });
}
function delParty(id) {
  if (db.invoices.some(i => i.partyId === id)) { toast('لا يمكن الحذف: مرتبط بفواتير'); return; }
  if (!confirm('حذف هذا السجل؟')) return;
  db.parties = db.parties.filter(p => p.id !== id);
  save(); render(); toast('تم الحذف');
}

/* ============ التقارير ============ */
const rep = { from: (() => { const d = new Date(); d.setDate(1); return dayStr(d); })(), to: today() };
function repList() {
  return db.invoices.filter(i => i.date >= rep.from && i.date <= rep.to).sort(cmpInv);
}
function pReports() {
  $('#actions').innerHTML = `<button class="btn" data-act="exportReport">تصدير الفواتير CSV</button>`;
  const list = repList();
  const sales = list.filter(i => i.type === 'sale'), purch = list.filter(i => i.type === 'purchase');
  const top = {};
  sales.forEach(i => i.lines.forEach(l => {
    const t = top[l.pid] || (top[l.pid] = { q: 0, r: 0, p: 0 });
    t.q += l.qty; t.r += l.qty * l.price; t.p += (l.price - (l.cost || 0)) * l.qty;
  }));
  const topRows = Object.keys(top).sort((a, b) => top[b].r - top[a].r).slice(0, 10).map(pid =>
    `<tr><td>${esc(prodName(pid))}</td><td class="num">${num(top[pid].q)}</td><td class="num">${num(top[pid].r)}</td><td class="num">${num(top[pid].p)}</td></tr>`).join('');
  const profit = sum(sales.map(invProfit));
  $('#view').innerHTML = `
    <div class="card" style="margin-bottom:14px"><div class="fields">
      <div class="field"><label>من تاريخ</label><input type="date" data-rep="from" value="${rep.from}"></div>
      <div class="field"><label>إلى تاريخ</label><input type="date" data-rep="to" value="${rep.to}"></div></div></div>
    <div class="kpis">
      ${kpi('المبيعات', money(sum(sales.map(invTotal))), sales.length + ' فاتورة', 'ok')}
      ${kpi('المشتريات', money(sum(purch.map(invTotal))), purch.length + ' فاتورة')}
      ${kpi('الربح التقديري', money(profit), '', profit >= 0 ? 'ok' : 'bad')}
      ${kpi('المحصّل من المبيعات', money(sum(sales.map(i => +i.paid || 0))))}
      ${kpi('غير محصّل', money(sum(sales.map(invDue))), '', 'warn')}
      ${kpi('غير مسدّد للموردين', money(sum(purch.map(invDue))), '', 'warn')}
    </div>
    <h2 style="font-size:16px;margin:4px 0 10px">أفضل المنتجات مبيعاً</h2>
    <div class="tbl-wrap"><table><thead><tr><th>المنتج</th><th class="num">الكمية</th><th class="num">الإيراد</th><th class="num">الربح</th></tr></thead><tbody>${topRows}</tbody></table>
    ${topRows ? '' : '<div class="empty">لا توجد مبيعات في هذه الفترة.</div>'}</div>
    <h2 style="font-size:16px;margin:22px 0 10px">الفواتير (${list.length})</h2>
    <div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الطرف</th><th class="num">الإجمالي</th><th class="num">المتبقي</th><th>الحالة</th></tr></thead>
    <tbody>${invoiceRows(list)}</tbody></table>${list.length ? '' : '<div class="empty">لا توجد فواتير.</div>'}</div>`;
}

/* ============ الإعدادات ============ */
function pSettings() {
  $('#view').innerHTML = `
    <div class="card" style="margin-bottom:14px"><h2>بيانات المنشأة</h2>
      <form id="setForm"><div class="fields">
        <div class="field"><label>اسم المنشأة</label><input name="company" value="${esc(db.settings.company)}" required></div>
        <div class="field"><label>رمز العملة</label><input name="currency" value="${esc(db.settings.currency)}" required></div>
      </div><div class="m-foot"><button class="btn primary" type="submit">حفظ الإعدادات</button></div></form></div>
    <div class="card"><h2>البيانات</h2>
      <p class="doc-meta">تُحفظ البيانات داخل متصفح هذا الجهاز فقط. خذ نسخة احتياطية بانتظام.</p>
      <div class="actions">
        <button class="btn" data-act="backup">⬇️ نسخة احتياطية (JSON)</button>
        <button class="btn" data-act="restore">⬆️ استعادة نسخة</button>
        <button class="btn" data-act="demo">بيانات تجريبية</button>
        <button class="btn danger" data-act="reset">مسح كل البيانات</button>
      </div></div>`;
}

function demo() {
  if ((db.products.length || db.invoices.length) && !confirm('سيتم استبدال البيانات الحالية بالبيانات التجريبية. متابعة؟')) return;
  const settings = db.settings;
  db = blank();
  db.settings = Object.assign(db.settings, { company: settings.company, currency: settings.currency });
  const P = [
    ['دقيق 25 كغ', 'مواد غذائية', 'كيس', 1900, 2300, 10], ['سكر 1 كغ', 'مواد غذائية', 'كغ', 95, 120, 30],
    ['زيت 5 لتر', 'زيوت', 'قارورة', 780, 950, 12], ['قهوة 250 غ', 'مشروبات', 'علبة', 310, 400, 15],
    ['حليب 1 لتر', 'ألبان', 'علبة', 70, 90, 40], ['أرز 1 كغ', 'حبوب', 'كغ', 140, 175, 25],
    ['صابون سائل', 'منظفات', 'قارورة', 180, 260, 10], ['ماء معدني 1.5 لتر', 'مشروبات', 'قارورة', 28, 40, 60]
  ];
  P.forEach((r, k) => db.products.push({ id: uid(), sku: 'P' + String(k + 1).padStart(3, '0'), name: r[0], category: r[1], unit: r[2], buy: r[3], sell: r[4], min: r[5], stock0: 0 }));
  const S = ['شركة الأمل للتوزيع', 'مؤسسة النور'], C = ['محمد بن علي', 'متجر الأمان', 'سعاد مرزوق', 'مطعم الواحة'];
  S.forEach(n => db.parties.push({ id: uid(), type: 'supplier', name: n, phone: '0550 00 00 0' + (db.parties.length + 1), address: 'الجزائر' }));
  C.forEach(n => db.parties.push({ id: uid(), type: 'customer', name: n, phone: '0660 00 00 0' + (db.parties.length + 1), address: 'الجزائر' }));
  const sup = db.parties.filter(p => p.type === 'supplier'), cus = db.parties.filter(p => p.type === 'customer');
  let seed = 11;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const add = (type, date, party, items, ratio) => {
    const lines = items.map(it => {
      const p = db.products[it[0]];
      const l = { pid: p.id, qty: it[1], price: type === 'sale' ? p.sell : p.buy };
      if (type === 'sale') l.cost = p.buy;
      return l;
    });
    const inv = { id: uid(), ts: Date.now() + db.invoices.length, type, no: nextNo(type), date, partyId: party ? party.id : '', lines, discount: 0, paid: 0, note: '' };
    inv.paid = Math.round(invTotal(inv) * ratio);
    db.invoices.push(inv);
  };
  add('purchase', daysAgo(14), sup[0], db.products.map((p, k) => [k, 150]), 1);
  add('purchase', daysAgo(8), sup[1], [[0, 60], [2, 40], [3, 50], [7, 120]], 0.6);
  for (let d = 12; d >= 0; d--) {
    const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const items = [], used = {};
      const cnt = 2 + Math.floor(rnd() * 2);
      while (items.length < cnt) {
        const pi = Math.floor(rnd() * db.products.length);
        if (used[pi]) continue;
        used[pi] = 1;
        items.push([pi, 1 + Math.floor(rnd() * 12)]);
      }
      const party = rnd() < 0.3 ? null : cus[Math.floor(rnd() * cus.length)];
      add('sale', daysAgo(d), party, items, rnd() < 0.7 ? 1 : 0.5);
    }
  }
  save(); render(); toast('تم تحميل البيانات التجريبية');
}

/* ============ الأحداث ============ */
const A = {
  close: closeModal,
  print: () => window.print(),
  newInvoice: d => invoiceForm(d.type),
  viewInvoice: d => viewInvoice(d.id),
  payInvoice: d => payInvoice(d.id),
  delInvoice: d => delInvoice(d.id),
  addLine: (d, b) => { const f = b.closest('form'); $('#lines', f).insertAdjacentHTML('beforeend', lineRow()); const r = $$('.line', f).pop(); setPrice(r); calc(f); },
  rmLine: (d, b) => { const f = b.closest('form'); if ($$('.line', f).length > 1) { b.closest('.line').remove(); calc(f); } },
  newProduct: () => productForm(),
  editProduct: d => productForm(d.id),
  delProduct: d => delProduct(d.id),
  adjust: d => adjustForm(d.id),
  newParty: d => partyForm(d.type),
  editParty: d => partyForm(null, d.id),
  delParty: d => delParty(d.id),
  exportProducts: () => {
    const sm = stockMap();
    download('products.csv', csv([['الرمز', 'المنتج', 'الفئة', 'الوحدة', 'سعر الشراء', 'سعر البيع', 'المخزون', 'حد التنبيه']]
      .concat(db.products.map(p => [p.sku, p.name, p.category, p.unit, p.buy, p.sell, sm[p.id], p.min]))));
  },
  exportReport: () => {
    download('invoices_' + rep.from + '_' + rep.to + '.csv', csv([['الرقم', 'النوع', 'التاريخ', 'الطرف', 'الإجمالي', 'المدفوع', 'المتبقي']]
      .concat(repList().map(i => [i.no, i.type === 'sale' ? 'بيع' : 'شراء', i.date, partyLabel(i), invTotal(i), +i.paid || 0, invDue(i)]))));
  },
  backup: () => download('stockpro-backup-' + today() + '.json', JSON.stringify(db, null, 1), 'application/json'),
  restore: () => $('#restoreFile').click(),
  demo,
  reset: () => {
    if (!confirm('سيتم حذف كل المنتجات والفواتير نهائياً. هل أنت متأكد؟')) return;
    const s = db.settings; db = blank(); db.settings = s; save(); render(); toast('تم مسح البيانات');
  }
};
document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('backdrop')) { closeModal(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const fn = A[b.dataset.act];
  if (fn) { e.preventDefault(); fn(b.dataset, b); }
});

function applyFilter() {
  const q = ($('.search') ? $('.search').value : '').trim().toLowerCase();
  const st = $('.flt') ? $('.flt').value : 'all';
  $$('#tb tr').forEach(tr => {
    tr.hidden = !((!q || tr.textContent.toLowerCase().includes(q)) && (st === 'all' || tr.dataset.st === st));
  });
}
document.addEventListener('input', e => { if (e.target.matches('.search')) applyFilter(); });
document.addEventListener('change', e => {
  if (e.target.matches('.flt')) applyFilter();
  if (e.target.dataset && e.target.dataset.rep) {
    rep[e.target.dataset.rep] = e.target.value || rep[e.target.dataset.rep];
    pReports();
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'setForm') {
    e.preventDefault();
    const f = new FormData(e.target);
    db.settings.company = String(f.get('company')).trim() || 'شركتي';
    db.settings.currency = String(f.get('currency')).trim() || 'دج';
    save(); render(); toast('تم حفظ الإعدادات');
  }
});
$('#restoreFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.products) || !Array.isArray(d.invoices)) throw new Error('bad');
      if (!confirm('سيتم استبدال كل البيانات الحالية بالنسخة الاحتياطية. متابعة؟')) return;
      const b = blank();
      db = Object.assign(b, d, { settings: Object.assign(b.settings, d.settings || {}) });
      save(); render(); toast('تمت استعادة البيانات');
    } catch (x) { toast('ملف غير صالح'); }
  };
  r.readAsText(f);
  e.target.value = '';
});

render();
})();
