/**
 * QC System - Tab 4: XƯỞNG IN TAMPON – Kiểm tra hàng ngày (Giai đoạn 1 – Cơ bản)
 * Theo bộ quy trình CB-00…CB-06 và phiếu P1…P5.
 *
 * Dữ liệu Firebase: qc_in_store_v1/{YYYY-MM-DD}/{NGAY|DEM}/
 *   p1: { header: {canOk, nguoiPha}, rows: {id: {...}} }   Phiếu pha mực
 *   p2: { header: {nguoiCap}, rows: {id: {...}} }           Phiếu cấp mực & châm nước
 *   p3: { id: {...} }                                       Phiếu mẫu đầu
 *   p4: { rounds: { "08:00": { rows: {id: {...}} } } }      Phiếu QC đi kiểm 2 giờ
 *   p5: { id: {...} }                                       Phiếu dừng máy / hàng lỗi
 * Mỗi ô nhập được ghi riêng theo đường dẫn (field-level) để nhiều người nhập cùng lúc không đè nhau.
 */

// ===================== TRẠNG THÁI =====================
let inData = {};              // dữ liệu ca đang xem
let inSub = 'tong';           // tab con đang mở
let inP4Round = null;         // vòng kiểm P4 đang mở
let inListenerPath = null;
let inPendingRender = false;
let inStarted = false;

const IN_RATIO_PVC = 1.2;     // nước = mực × 1,2 (nhựa PVC, nước T-11-3009)
const IN_HAN_PHUT = 240;      // hạn dùng cốc mực: 4 giờ
const IN_CHAM_TOI_DA = 3;     // châm tối đa 3 lần rồi thay mực
const IN_LECH_TOI_DA = 1;     // lệch ≤ 1 g
const IN_ROUNDS = { NGAY: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'], DEM: ['20:00', '22:00', '00:00', '02:00', '04:00', '06:00'] };

const IN_P3_PREP = [
    'Phôi có tem OK, sạch',
    'Lau IPA 1 chiều, chờ khô 1 phút, đeo găng',
    'Bản in đúng mã, không xước',
    'Đầu silicone đúng loại, không nứt',
    'Cốc mực có nhãn, còn hạn',
    'Cài máy theo phiếu thông số'
];
const IN_P3_CRIT = ['Đúng vị trí', 'Đúng màu (so mẫu chuẩn)', 'Nét đủ, phủ kín', 'Không nhòe, không lem'];
const IN_P3_LYDO = ['Đầu ca', 'Đổi mã', 'Đổi màu', 'Mực mới', 'Sau sửa máy', 'Sau lỗi'];
const IN_P4_COLS = [
    ['c1', 'Cốc mực còn hạn, có nhãn'],
    ['c2', 'Không có can nước tại máy'],
    ['c3', 'Đeo găng'],
    ['c4', 'Nét in tốt (xem 5 sp)'],
    ['c5', 'Thử băng keo 1 sp (đã nguội)']
];
const IN_P5_PHATHIEN = ['Mẫu đầu', 'QC đi kiểm', 'Thợ in báo', 'Kiểm hàng xuất'];
const IN_P5_LOI = [['bangKeo', 'Băng keo bong'], ['saiMau', 'Sai màu'], ['lech', 'Lệch'], ['matNet', 'Mất nét / nhòe']];
const IN_P5_NN = [['muc', 'Mực (sai nước / quá hạn / châm nhiều)'], ['phoi', 'Phôi bẩn'], ['may', 'Máy (áp lực, đầu, bản)'], ['lo', 'Lò (nhiệt)']];

// ===================== TIỆN ÍCH =====================
function inEsc(s) { return (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function inId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function inNowHM() { let d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function inToMin(hm) { if (!hm || !/^\d{1,2}:\d{2}/.test(hm)) return null; let [h, m] = hm.split(':').map(Number); return h * 60 + m; }
function inAddMin(hm, add) { let t = inToMin(hm); if (t == null) return ''; t = (t + add) % 1440; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }
function inDiffMin(from, to) { let a = inToMin(from), b = inToMin(to); if (a == null || b == null) return null; let d = b - a; if (d < 0) d += 1440; return d; }
function inNum(v) { if (v === '' || v == null) return null; let n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; }
function inUser() { let e = (typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email : 'QC'; return e.split('@')[0]; }
function inStamp() { return { by: inUser(), at: inNowHM() }; }
function inDate() { return document.getElementById('inDate')?.value || getTodayISO(); }
function inShift() { return document.getElementById('inShift')?.value || 'NGAY'; }
function inBase() { return `qc_in_store_v1/${inDate()}/${inShift()}`; }
function inDefaultShift() { let t = inToMin(inNowHM()); return (t >= 450 && t < 1170) ? 'NGAY' : 'DEM'; } // 07:30–19:30 = ca ngày
function inGet(path) { return path.split('/').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : undefined, inData); }
function inSetLocal(path, value) {
    let keys = path.split('/'), o = inData;
    for (let i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
    if (value === null || value === undefined || value === '') delete o[keys[keys.length - 1]];
    else o[keys[keys.length - 1]] = value;
}
function inWrite(path, value) {
    if (value === '' || value === false) value = null;
    inSetLocal(path, value);
    if (typeof db !== 'undefined' && db && isConnected) {
        db.ref(`${inBase()}/${path}`).set(value === undefined ? null : value).catch(err => {
            console.error('Lỗi ghi xưởng in:', err);
            inToast('⚠️ Không lưu được lên Firebase: ' + (err && err.message ? err.message : err), true);
        });
    }
}
function inRows(obj) { return Object.entries(obj || {}).filter(([, v]) => v && typeof v === 'object').sort((a, b) => (a[1].t || 0) - (b[1].t || 0)); }
function inToast(msg, bad) {
    let el = document.getElementById('inToast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'in-toast show' + (bad ? ' bad' : '');
    clearTimeout(el._t); el._t = setTimeout(() => { el.className = 'in-toast'; }, 3500);
}

// ===================== TÍNH TOÁN / QUY TẮC =====================
function inP1Calc(r) {
    let muc = inNum(r.gramMuc), da = inNum(r.gramNuoc);
    let nhua = r.nhua || 'PVC';
    let res = { phai: null, dung: null, han: r.gioPha ? inAddMin(r.gioPha, IN_HAN_PHUT) : '', khongTyLe: nhua !== 'PVC' };
    if (!res.khongTyLe && muc != null) res.phai = Math.round(muc * IN_RATIO_PVC * 10) / 10;
    if (res.phai != null && da != null) res.dung = Math.abs(da - res.phai) <= IN_LECH_TOI_DA;
    return res;
}
function inP2Calc(r) {
    let d = inDiffMin(r.gioPha, r.gioCap);
    let cham = [r.cham1, r.cham2, r.cham3].filter(Boolean).length;
    return { tuoi: d, conHan: d == null ? null : d <= IN_HAN_PHUT, cham, duCham: cham >= IN_CHAM_TOI_DA };
}
function inP3Calc(r) {
    let prepOk = IN_P3_PREP.every((_, i) => (r.a || {})[i] === 'OK');
    let prepNg = IN_P3_PREP.some((_, i) => (r.a || {})[i] === 'NG');
    let crit = IN_P3_CRIT.map((_, c) => {
        let vals = [0, 1, 2, 3, 4].map(s => ((r.b || {})[c] || {})[s]);
        if (vals.some(v => v === 'NG')) return 'NG';
        if (vals.every(v => v === 'OK')) return 'OK';
        return '';
    });
    let bOk = crit.every(v => v === 'OK');
    let bNg = crit.some(v => v === 'NG');
    let status, cls;
    if (r.bangKeo === 'BONG') { status = '🟥 BONG – DỪNG MÁY, giữ cả xe thẻ vàng (CB-05)'; cls = 'ng'; }
    else if (!r.qcKy) { status = bNg ? '🔧 Mẫu chưa đạt – tổ trưởng chỉnh máy, in lại 5 sp' : '⛔ Chưa có QC ký – CHƯA ĐƯỢC CHẠY LOẠT'; cls = bNg ? 'warn' : 'stop'; }
    else if (r.bangKeo !== 'KHONG_BONG') { status = '🟨 THẺ VÀNG – hàng chạy loạt chờ thử băng keo'; cls = 'yellow'; }
    else if (!r.goTheVang) { status = '🟨 Băng keo đạt – chờ QC gỡ thẻ vàng'; cls = 'yellow'; }
    else { status = '✅ Đạt – đã gỡ thẻ vàng, xe hàng đi tiếp (CB-04)'; cls = 'ok'; }
    let viPham = !!(r.gioChayLoat && !r.qcKy);
    return { prepOk, prepNg, crit, bOk, bNg, canSign: prepOk && bOk, status, cls, viPham };
}
function inP4Calc(r) {
    let vals = IN_P4_COLS.map(([k]) => r[k]);
    if (vals.some(v => v === 'NG')) return 'NG';
    if (vals.every(v => v === 'OK')) return 'OK';
    return '';
}
function inP5Calc(r) {
    let decided = !!(r.qd && (r.qd.dung || r.qd.tay || r.qd.huy || r.qd.by));
    if (!r.goTheDo) return { status: '🟥 ĐANG DỪNG – thẻ đỏ (chỉ QC gỡ)', cls: 'ng', open: true, decided };
    if (!decided && inNum(r.slGiu) > 0) return { status: '🟢 Đã chạy lại – chờ Phòng CL quyết định hàng giữ (≤ 24h)', cls: 'yellow', open: false, decided };
    return { status: '✅ Đã xử lý xong', cls: 'ok', open: false, decided };
}

function inSummary() {
    let p1 = inRows(inData.p1?.rows), p2 = inRows(inData.p2?.rows), p3 = inRows(inData.p3), p5 = inRows(inData.p5);
    let s = {};
    s.p1Total = p1.length;
    s.p1Sai = p1.filter(([, r]) => inP1Calc(r).dung === false).length;
    s.p1KhongTyLe = p1.filter(([, r]) => inP1Calc(r).khongTyLe).length;
    s.p1Can = inData.p1?.header?.canOk || '';
    s.p1QcCheck = p1.some(([, r]) => r.qc);
    s.p1ThieuNhan = p1.filter(([, r]) => !r.nhan).length;
    s.p2Total = p2.length;
    s.p2HetHan = p2.filter(([, r]) => inP2Calc(r).conHan === false).length;
    s.p2DuCham = p2.filter(([, r]) => inP2Calc(r).duCham).length;
    s.p3Total = p3.length;
    s.p3ChuaKy = p3.filter(([, r]) => !r.qcKy).length;
    s.p3TheVang = p3.filter(([, r]) => r.qcKy && r.bangKeo !== 'BONG' && !r.goTheVang).map(([, r]) => r.may || '?');
    s.p3Bong = p3.filter(([, r]) => r.bangKeo === 'BONG').length;
    s.p3ViPham = p3.filter(([, r]) => inP3Calc(r).viPham).length;
    let rounds = IN_ROUNDS[inShift()];
    s.p4Done = rounds.filter(rd => inRows(inData.p4?.rounds?.[rd]?.rows).some(([, r]) => inP4Calc(r) !== '')).length;
    s.p4Rounds = rounds.length;
    let ng = [];
    rounds.forEach(rd => inRows(inData.p4?.rounds?.[rd]?.rows).forEach(([, r]) => { if (inP4Calc(r) === 'NG') ng.push({ rd, may: r.may || '?' }); }));
    s.p4Ng = ng;
    s.p4CanNuoc = rounds.reduce((n, rd) => n + inRows(inData.p4?.rounds?.[rd]?.rows).filter(([, r]) => r.c2 === 'NG').length, 0);
    s.p5Total = p5.length;
    s.p5Dang = p5.filter(([, r]) => inP5Calc(r).open).map(([, r]) => r.may || '?');
    s.p5ChoQd = p5.filter(([, r]) => !inP5Calc(r).open && !inP5Calc(r).decided && inNum(r.slGiu) > 0).length;
    return s;
}

// ===================== KHỞI ĐỘNG / LẮNG NGHE =====================
function inKhoiDong() {
    let dEl = document.getElementById('inDate'), sEl = document.getElementById('inShift');
    if (dEl && !dEl.value) dEl.value = getTodayISO();
    if (sEl && !inStarted) sEl.value = inDefaultShift();
    inStarted = true;
    inSubscribe();
}
function inSubscribe() {
    if (typeof db === 'undefined' || !db || !isEditMode) { renderTabIn(); return; }
    let path = inBase();
    if (inListenerPath === path) { renderTabIn(); return; }
    if (inListenerPath) db.ref(inListenerPath).off();
    inListenerPath = path;
    inData = {};
    inP4Round = null;
    renderTabIn();
    db.ref(path).on('value', snap => {
        if (inListenerPath !== path) return;
        inData = snap.val() || {};
        let ae = document.activeElement, root = document.getElementById('inRoot');
        if (root && ae && root.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && !/checkbox|radio/.test(ae.type)) { inPendingRender = true; return; }
        renderTabIn();
    });
}
function inStop() {
    if (inListenerPath && typeof db !== 'undefined' && db) db.ref(inListenerPath).off();
    inListenerPath = null; inData = {}; inStarted = false;
    let root = document.getElementById('inRoot'); if (root) root.innerHTML = '';
}
function onInDateShiftChange() { inSubscribe(); }

// ===================== RENDER CHÍNH =====================
function renderTabIn() {
    let root = document.getElementById('inRoot');
    if (!root || !isEditMode) return;
    let ae = document.activeElement, focusP = (ae && root.contains(ae)) ? ae.getAttribute('data-p') : null;
    let st = (ae && focusP && ae.selectionStart != null) ? ae.selectionStart : null;
    inPendingRender = false;
    let s = inSummary();
    let subs = [
        ['tong', '📊 Tổng quan ca'],
        ['p1', `🧪 P1 Pha mực <span class="badge in-cnt">${s.p1Total}</span>`],
        ['p2', `🥤 P2 Cấp mực & châm <span class="badge in-cnt">${s.p2Total}</span>`],
        ['p3', `🔰 P3 Mẫu đầu <span class="badge in-cnt">${s.p3Total}</span>${s.p3ChuaKy ? `<span class="badge bg-danger ms-1">${s.p3ChuaKy}</span>` : ''}`],
        ['p4', `🚶 P4 QC đi kiểm 2h <span class="badge in-cnt">${s.p4Done}/${s.p4Rounds}</span>`],
        ['p5', `🛑 P5 Dừng máy <span class="badge in-cnt">${s.p5Total}</span>${s.p5Dang.length ? `<span class="badge bg-danger ms-1">${s.p5Dang.length}</span>` : ''}`],
        ['qt', '📖 Quy trình']
    ];
    let nav = `<div class="in-subnav">${subs.map(([k, l]) => `<button type="button" class="in-subbtn ${inSub === k ? 'active' : ''}" data-act="sub" data-v="${k}">${l}</button>`).join('')}</div>`;
    let body = '';
    try {
        body = ({ tong: inRenderTong, p1: inRenderP1, p2: inRenderP2, p3: inRenderP3, p4: inRenderP4, p5: inRenderP5, qt: inRenderQt }[inSub] || inRenderTong)(s);
    } catch (e) { console.error(e); body = `<div class="alert alert-danger">Lỗi hiển thị: ${inEsc(e.message)}</div>`; }
    root.innerHTML = nav + `<div class="in-body">${body}</div>`;
    if (focusP) {
        let el = root.querySelector(`[data-p="${CSS.escape(focusP)}"]`);
        if (el) { el.focus(); try { if (st != null && el.setSelectionRange) el.setSelectionRange(st, st); } catch (e) { } }
    }
}

function inCyc(path, val, labels) {
    labels = labels || { OK: '✓', NG: '✗' };
    let cls = val === 'OK' ? 'ok' : val === 'NG' ? 'ng' : '';
    return `<button type="button" class="in-cyc ${cls}" data-act="cyc" data-path="${path}" title="Bấm để đổi: trống → ✓ → ✗">${val ? labels[val] : '·'}</button>`;
}
function inInput(path, val, opt) {
    opt = opt || {};
    let type = opt.type || 'text';
    return `<input type="${type}" class="form-control form-control-sm ${opt.cls || ''}" data-p="${path}" value="${inEsc(val)}" ${opt.ph ? `placeholder="${inEsc(opt.ph)}"` : ''} ${opt.attr || ''} ${type === 'number' ? 'inputmode="decimal" step="any" min="0"' : ''}>`;
}
function inSelect(path, val, options, opt) {
    opt = opt || {};
    return `<select class="form-select form-select-sm ${opt.cls || ''}" data-p="${path}">${opt.blank !== false ? '<option value="">—</option>' : ''}${options.map(o => {
        let [v, l] = Array.isArray(o) ? o : [o, o];
        return `<option value="${inEsc(v)}" ${String(val || '') === String(v) ? 'selected' : ''}>${inEsc(l)}</option>`;
    }).join('')}</select>`;
}
function inTimeBtn(path) { return `<button type="button" class="in-mini" data-act="now" data-path="${path}" title="Lấy giờ hiện tại">⏱</button>`; }
function inSign(stamp, act, path, enabled, label, why) {
    if (stamp && stamp.by) return `<span class="in-signed">✍️ ${inEsc(stamp.by)} · ${inEsc(stamp.at || '')} <button type="button" class="in-mini" data-act="unsign" data-path="${path}" title="Hủy chữ ký">✕</button></span>`;
    return `<button type="button" class="btn btn-sm ${enabled ? 'btn-3d-emerald' : 'btn-outline-secondary'} px-2" data-act="${act}" data-path="${path}" ${enabled ? '' : `disabled title="${inEsc(why || '')}"`}>${label}</button>`;
}
function inDel(path, what) { return `<button type="button" class="in-mini in-del" data-act="del" data-path="${path}" data-what="${inEsc(what || 'dòng')}" title="Xóa">🗑</button>`; }

// ---------- TỔNG QUAN ----------
function inRenderTong(s) {
    let kpi = (title, val, sub, tone) => `<div class="in-kpi ${tone || ''}"><div class="in-kpi-t">${title}</div><div class="in-kpi-v">${val}</div><div class="in-kpi-s">${sub || ''}</div></div>`;
    let tone = (bad, warn) => bad ? 'bad' : warn ? 'warn' : 'good';
    let rules = [
        ['1', 'Pha mực bằng cân, có nhãn', s.p1Total > 0 && s.p1Sai === 0 && s.p1KhongTyLe === 0 && s.p1ThieuNhan === 0 && s.p1Can === 'DUNG', s.p1Total === 0 ? 'Chưa có cốc nào' : `${s.p1Sai} cốc lệch · ${s.p1ThieuNhan} cốc chưa dán nhãn · cân đầu ca: ${s.p1Can === 'DUNG' ? 'đúng' : s.p1Can === 'SAI' ? 'SAI' : 'chưa thử'}`],
        ['2', 'Không tự đổ nước vào mực', s.p4CanNuoc === 0 && s.p2DuCham === 0, `${s.p4CanNuoc} lần thấy can nước tại máy · ${s.p2DuCham} cốc đã châm đủ 3 lần (phải thay)`],
        ['3', 'Không chạy loạt khi QC chưa ký mẫu đầu', s.p3ViPham === 0, s.p3ViPham ? `${s.p3ViPham} máy ghi giờ chạy loạt nhưng chưa có QC ký` : 'Không có vi phạm'],
        ['4', 'Thấy lỗi là dừng máy', s.p4Ng.length + s.p3Bong <= s.p5Total, `${s.p4Ng.length + s.p3Bong} lần phát hiện NG/bong · ${s.p5Total} phiếu dừng máy`],
        ['5', 'Ghi phiếu đủ', s.p1Total > 0 && s.p2Total > 0 && s.p3Total > 0 && s.p4Done >= s.p4Rounds, `P1 ${s.p1Total} · P2 ${s.p2Total} · P3 ${s.p3Total} · P4 ${s.p4Done}/${s.p4Rounds} vòng`]
    ];
    let chips = (arr, cls) => arr.length ? arr.map(m => `<span class="in-chip ${cls}">Máy ${inEsc(m)}</span>`).join('') : '<span class="opacity-75 small">Không có</span>';
    return `
    <div class="in-kpis">
        ${kpi('Cốc mực đã pha (P1)', s.p1Total, `${s.p1Sai} cốc lệch > 1 g · QC cân lại: ${s.p1QcCheck ? '✅ đã làm' : '⚠️ chưa'}`, tone(s.p1Sai > 0 || s.p1Can === 'SAI', !s.p1QcCheck && s.p1Total > 0))}
        ${kpi('Lượt cấp mực (P2)', s.p2Total, `${s.p2HetHan} cốc quá hạn 4h · ${s.p2DuCham} cốc châm đủ 3 lần`, tone(s.p2HetHan > 0, s.p2DuCham > 0))}
        ${kpi('Mẫu đầu (P3)', s.p3Total, `${s.p3ChuaKy} chưa QC ký · ${s.p3TheVang.length} xe thẻ vàng · ${s.p3Bong} bong`, tone(s.p3Bong > 0 || s.p3ViPham > 0, s.p3ChuaKy > 0 || s.p3TheVang.length > 0))}
        ${kpi('QC đi kiểm 2h (P4)', `${s.p4Done}/${s.p4Rounds}`, `${s.p4Ng.length} lượt máy NG`, tone(s.p4Ng.length > 0, s.p4Done < s.p4Rounds))}
        ${kpi('Dừng máy (P5)', s.p5Total, `${s.p5Dang.length} máy đang treo thẻ đỏ · ${s.p5ChoQd} lô chờ Phòng CL`, tone(s.p5Dang.length > 0, s.p5ChoQd > 0))}
    </div>
    <div class="row g-3 mt-1">
        <div class="col-lg-7">
            <div class="in-panel">
                <div class="in-panel-h">✅ 5 VIỆC GỐC – GIAI ĐOẠN 1 (ca này)</div>
                ${rules.map(([n, t, ok, d]) => `<div class="in-rule ${ok ? 'ok' : 'bad'}"><span class="in-rule-n">${n}</span><div><div class="fw-bold">${t}</div><div class="small opacity-75">${d}</div></div><span class="ms-auto fw-bold">${ok ? '✓ ĐẠT' : '✗ CHƯA'}</span></div>`).join('')}
            </div>
        </div>
        <div class="col-lg-5">
            <div class="in-panel">
                <div class="in-panel-h">🏷️ BẢNG THẺ TẠI XƯỞNG</div>
                <div class="mb-2"><div class="small fw-bold mb-1">🟥 Thẻ đỏ – máy đang dừng (chỉ QC gỡ)</div>${chips(s.p5Dang, 'red')}</div>
                <div class="mb-2"><div class="small fw-bold mb-1">🟨 Thẻ vàng – xe hàng chờ thử băng keo</div>${chips(s.p3TheVang, 'yellow')}</div>
                <div><div class="small fw-bold mb-1">⚠️ Máy NG khi QC đi kiểm</div>${s.p4Ng.length ? s.p4Ng.map(x => `<span class="in-chip red">Máy ${inEsc(x.may)} · ${x.rd}</span>`).join('') : '<span class="opacity-75 small">Không có</span>'}</div>
            </div>
        </div>
    </div>`;
}

// ---------- P1 PHA MỰC ----------
function inRenderP1() {
    let h = inData.p1?.header || {};
    let rows = inRows(inData.p1?.rows);
    let canSai = h.canOk === 'SAI';
    let qcDone = rows.some(([, r]) => r.qc);
    let html = `
    <div class="in-note">Nhựa <b>PVC</b>: nước = mực × 1,2 (tự tính). <b>ABS, PP</b>: chưa có tỷ lệ → hỏi tổ trưởng, <b>KHÔNG pha</b>. Lệch quá 1 g → báo SAI → thêm cho đúng hoặc đổ can thu hồi, pha lại. Hạn dùng = giờ pha + 4 giờ.</div>
    <div class="in-head">
        <label>Thử cân đầu ca (đặt quả cân thử) ${inSelect('p1/header/canOk', h.canOk, [['DUNG', '✓ Cân đúng'], ['SAI', '✗ Cân sai – không pha']], { cls: 'in-w160 ' + (canSai ? 'in-bad' : h.canOk === 'DUNG' ? 'in-good' : '') })}</label>
        <label>Người pha ${inInput('p1/header/nguoiPha', h.nguoiPha, { cls: 'in-w140', ph: 'Họ tên' })}</label>
        <span class="in-pill ${qcDone ? 'good' : 'warn'}">QC cân lại 1 cốc / ca: ${qcDone ? '✅ Đã làm' : '⚠️ Chưa làm'}</span>
        <button type="button" class="btn btn-sm btn-3d-primary px-3 ms-auto" data-act="addP1" ${canSai ? 'disabled title="Cân sai – báo tổ trưởng, không pha"' : ''}>➕ Cốc mới</button>
    </div>
    ${canSai ? '<div class="in-alert">⛔ CÂN SAI – báo tổ trưởng, KHÔNG PHA cho đến khi cân thử đúng.</div>' : ''}
    ${!h.canOk ? '<div class="in-alert warn">⚠️ Chưa ghi kết quả thử cân đầu ca.</div>' : ''}
    <div class="table-responsive"><table class="table table-bordered align-middle text-center in-table" style="min-width:1180px">
    <thead><tr><th>#</th><th>Giờ pha</th><th>Mã hàng</th><th>Màu / mã mực</th><th>Nhựa</th><th>Can nước đúng màu nhãn?</th><th>Gram mực</th><th>Gram nước PHẢI rót (tự)</th><th>Gram nước ĐÃ rót</th><th>Đúng? (tự)</th><th>Hạn dùng (tự)</th><th>Đã dán nhãn cốc</th><th>Người pha</th><th>QC cân lại</th><th></th></tr></thead><tbody>`;
    if (!rows.length) html += `<tr><td colspan="15" class="opacity-75 py-3">Chưa có cốc mực nào trong ca. Bấm “➕ Cốc mới” mỗi lần pha.</td></tr>`;
    rows.forEach(([id, r], i) => {
        let c = inP1Calc(r), p = `p1/rows/${id}`;
        html += `<tr class="${c.dung === false || c.khongTyLe ? 'in-row-bad' : ''}">
            <td>${i + 1}</td>
            <td><div class="d-flex gap-1">${inInput(p + '/gioPha', r.gioPha, { type: 'time', cls: 'in-w95' })}</div></td>
            <td>${inInput(p + '/maHang', r.maHang, { cls: 'in-w110' })}</td>
            <td>${inInput(p + '/mau', r.mau, { cls: 'in-w120' })}</td>
            <td>${inSelect(p + '/nhua', r.nhua || 'PVC', ['PVC', 'ABS', 'PP'], { blank: false, cls: 'in-w80' })}</td>
            <td>${inCyc(p + '/canNuoc', r.canNuoc)}</td>
            <td>${inInput(p + '/gramMuc', r.gramMuc, { type: 'number', cls: 'in-w80' })}</td>
            <td class="fw-bold">${c.khongTyLe ? '<span class="text-danger small">⛔ Chưa có tỷ lệ<br>hỏi tổ trưởng</span>' : (c.phai != null ? c.phai + ' g' : '—')}</td>
            <td>${inInput(p + '/gramNuoc', r.gramNuoc, { type: 'number', cls: 'in-w80' })}</td>
            <td>${c.dung == null ? '—' : c.dung ? '<span class="in-tag ok">ĐÚNG</span>' : '<span class="in-tag ng">SAI</span>'}</td>
            <td class="fw-bold">${c.han || '—'}</td>
            <td>${inCyc(p + '/nhan', r.nhan)}</td>
            <td>${inInput(p + '/nguoi', r.nguoi || h.nguoiPha || '', { cls: 'in-w110' })}</td>
            <td>${r.qc ? `<span class="in-signed">✍️ ${inEsc(r.qc.by)} · ${inEsc(r.qc.at)} ${r.qcKq === 'SAI' ? '<b class="text-danger">SAI</b>' : '<b class="text-success">ĐÚNG</b>'} <button type="button" class="in-mini" data-act="unsign" data-path="${p}/qc">✕</button></span>`
                : `<div class="d-flex gap-1 justify-content-center"><button type="button" class="in-mini ok" data-act="qcP1" data-path="${p}" data-v="DUNG" title="QC cân lại: đúng">✓ Đúng</button><button type="button" class="in-mini ng" data-act="qcP1" data-path="${p}" data-v="SAI" title="QC cân lại: sai → đổ bỏ, pha lại">✗ Sai</button></div>`}</td>
            <td>${inDel(p, 'cốc mực')}</td></tr>`;
        if (r.qcKq === 'SAI') html += `<tr class="in-row-bad"><td colspan="15" class="text-start small">⛔ QC cân lại SAI → đổ bỏ cốc này, pha lại, nhắc người pha.</td></tr>`;
    });
    html += `</tbody></table></div>
    <details class="in-details"><summary>📋 Bảng tra – dán cạnh cân (PVC, nước T-11-3009)</summary>
    <table class="table table-bordered table-sm text-center in-table mt-2" style="max-width:420px"><thead><tr><th>Gram MỰC</th><th>Gram NƯỚC</th><th>Tổng cốc</th></tr></thead><tbody>
    ${[50, 100, 150, 200, 250, 300, 350, 400, 450, 500].map(m => `<tr><td>${m}</td><td>${m * 1.2}</td><td>${m * 2.2}</td></tr>`).join('')}</tbody></table></details>`;
    return html;
}

// ---------- P2 CẤP MỰC ----------
function inRenderP2() {
    let h = inData.p2?.header || {};
    let rows = inRows(inData.p2?.rows);
    let cups = inRows(inData.p1?.rows).filter(([, r]) => r.gioPha);
    let html = `
    <div class="in-note">Cột <b>Còn hạn?</b> tự báo HẾT HẠN nếu giờ cấp quá 4 giờ sau giờ pha → <b>KHÔNG cấp</b>, đổ vào can thu hồi. Châm nước: chỉ <b>TỔ TRƯỞNG</b>, mỗi lần 1 lọ, gạch 1 vạch trên nhãn. Đủ 3 lần mà vẫn đặc → vét khay, thay cốc mới (dòng mới). Tại máy KHÔNG có can nước pha.</div>
    <div class="in-head">
        <label>Người cấp ${inInput('p2/header/nguoiCap', h.nguoiCap, { cls: 'in-w140', ph: 'Họ tên' })}</label>
        <button type="button" class="btn btn-sm btn-3d-primary px-3 ms-auto" data-act="addP2">➕ Lượt cấp mới</button>
    </div>
    <div class="table-responsive"><table class="table table-bordered align-middle text-center in-table" style="min-width:1320px">
    <thead><tr><th>#</th><th>Giờ cấp</th><th>Máy số</th><th>Lấy từ cốc P1</th><th>Màu / mã mực</th><th>Giờ pha (trên nhãn)</th><th>Còn hạn? (tự)</th><th>Đã đổ mực cũ vào can thu hồi</th><th>Người cấp</th><th>Thợ in ký nhận</th><th>Châm lần 1</th><th>Châm lần 2</th><th>Châm lần 3</th><th>Tổ trưởng ký</th><th>Ghi chú</th><th></th></tr></thead><tbody>`;
    if (!rows.length) html += `<tr><td colspan="16" class="opacity-75 py-3">Chưa có lượt cấp mực nào trong ca.</td></tr>`;
    rows.forEach(([id, r], i) => {
        let c = inP2Calc(r), p = `p2/rows/${id}`;
        let nextCham = !r.cham1 ? 1 : !r.cham2 ? 2 : !r.cham3 ? 3 : 0;
        let chamCell = n => {
            let v = r['cham' + n];
            if (v) return `<span class="in-signed">${inEsc(v)} <button type="button" class="in-mini" data-act="clr" data-path="${p}/cham${n}">✕</button></span>`;
            return n === nextCham && c.conHan !== false ? `<button type="button" class="in-mini warn" data-act="now" data-path="${p}/cham${n}" title="Tổ trưởng châm 1 lọ – ghi giờ">💧 Châm</button>` : '<span class="opacity-50">—</span>';
        };
        html += `<tr class="${c.conHan === false ? 'in-row-bad' : c.duCham ? 'in-row-warn' : ''}">
            <td>${i + 1}</td>
            <td><div class="d-flex gap-1">${inInput(p + '/gioCap', r.gioCap, { type: 'time', cls: 'in-w95' })}</div></td>
            <td>${inInput(p + '/may', r.may, { cls: 'in-w60' })}</td>
            <td><select class="form-select form-select-sm in-w140" data-pick="${p}"><option value="">— chọn cốc —</option>${cups.map(([cid, cr]) => `<option value="${cid}" ${r.cocId === cid ? 'selected' : ''}>${inEsc((cr.mau || '?') + ' · pha ' + cr.gioPha + (cr.maHang ? ' · ' + cr.maHang : ''))}</option>`).join('')}</select></td>
            <td>${inInput(p + '/mau', r.mau, { cls: 'in-w120' })}</td>
            <td>${inInput(p + '/gioPha', r.gioPha, { type: 'time', cls: 'in-w95' })}</td>
            <td>${c.conHan == null ? '—' : c.conHan ? `<span class="in-tag ok">CÒN HẠN</span><div class="small opacity-75">${Math.floor(c.tuoi / 60)}h${String(c.tuoi % 60).padStart(2, '0')}</div>` : '<span class="in-tag ng">HẾT HẠN</span><div class="small text-danger fw-bold">KHÔNG CẤP</div>'}</td>
            <td>${inCyc(p + '/doMucCu', r.doMucCu)}</td>
            <td>${inInput(p + '/nguoiCap', r.nguoiCap || h.nguoiCap || '', { cls: 'in-w100' })}</td>
            <td>${inInput(p + '/thoIn', r.thoIn, { cls: 'in-w100', ph: 'Tên thợ in' })}</td>
            <td>${chamCell(1)}</td><td>${chamCell(2)}</td><td>${chamCell(3)}</td>
            <td>${inInput(p + '/toTruong', r.toTruong, { cls: 'in-w100' })}</td>
            <td>${inInput(p + '/ghiChu', r.ghiChu, { cls: 'in-w140' })}</td>
            <td>${inDel(p, 'lượt cấp')}</td></tr>`;
        if (c.duCham) html += `<tr class="in-row-warn"><td colspan="16" class="text-start small">⚠️ Máy ${inEsc(r.may || '?')}: đã châm đủ ${IN_CHAM_TOI_DA} lần → KHÔNG châm nữa: vét khay vào can thu hồi, thay cốc mực mới (thêm lượt cấp mới).</td></tr>`;
    });
    html += `</tbody></table></div>`;
    return html;
}

// ---------- P3 MẪU ĐẦU ----------
function inRenderP3() {
    let rows = inRows(inData.p3);
    let html = `
    <div class="in-note">1 phiếu / máy / mỗi lần khởi động (đầu ca, đổi mã, đổi màu, mực mới, sau sửa máy, sau lỗi). <b>Chưa có chữ ký QC → chưa được chạy loạt.</b> Hàng chạy loạt để xe THẺ VÀNG đến khi 5 mẫu đầu sấy – nguội – thử băng keo không bong.</div>
    <div class="in-head"><button type="button" class="btn btn-sm btn-3d-primary px-3 ms-auto" data-act="addP3">➕ Phiếu mẫu đầu mới</button></div>`;
    if (!rows.length) html += `<div class="in-empty">Chưa có phiếu mẫu đầu nào trong ca.</div>`;
    rows.slice().reverse().forEach(([id, r]) => {
        let c = inP3Calc(r), p = `p3/${id}`;
        html += `<div class="in-card ${c.cls}">
        <div class="in-card-h">
            <div class="d-flex flex-wrap gap-2 align-items-center">
                <label>Máy số ${inInput(p + '/may', r.may, { cls: 'in-w60' })}</label>
                <label>Mã hàng ${inInput(p + '/maHang', r.maHang, { cls: 'in-w110' })}</label>
                <label>Màu ${inInput(p + '/mau', r.mau, { cls: 'in-w100' })}</label>
                <label>Nhựa ${inSelect(p + '/nhua', r.nhua, ['PVC', 'ABS', 'PP'], { cls: 'in-w80' })}</label>
                <label>Lý do ${inSelect(p + '/lyDo', r.lyDo, IN_P3_LYDO, { cls: 'in-w130' })}</label>
            </div>
            <div class="d-flex align-items-center gap-2"><span class="in-status ${c.cls}">${c.status}</span>${inDel(p, 'phiếu mẫu đầu')}</div>
        </div>
        ${c.viPham ? '<div class="in-alert">⛔ VI PHẠM: đã ghi giờ chạy loạt nhưng phiếu mẫu đầu CHƯA có QC ký.</div>' : ''}
        <div class="row g-3">
          <div class="col-xl-4 col-lg-5">
            <div class="in-sec">A. CHUẨN BỊ <span class="opacity-75">(thợ in đánh ✓)</span></div>
            ${IN_P3_PREP.map((t, i) => `<div class="in-check">${inCyc(`${p}/a/${i}`, (r.a || {})[i])}<span>${i + 1}. ${t}</span></div>`).join('')}
          </div>
          <div class="col-xl-8 col-lg-7">
            <div class="in-sec">B. XEM 5 SẢN PHẨM ĐẦU <span class="opacity-75">(tổ trưởng đánh ✓ / ✗, so mẫu chuẩn)</span></div>
            <table class="table table-bordered table-sm align-middle text-center in-table mb-2"><thead><tr><th class="text-start">Hạng mục</th><th>SP 1</th><th>SP 2</th><th>SP 3</th><th>SP 4</th><th>SP 5</th><th>Kết luận</th></tr></thead><tbody>
            ${IN_P3_CRIT.map((t, ci) => `<tr><td class="text-start">${ci + 1}. ${t}</td>${[0, 1, 2, 3, 4].map(si => `<td>${inCyc(`${p}/b/${ci}/${si}`, ((r.b || {})[ci] || {})[si])}</td>`).join('')}<td>${c.crit[ci] === 'OK' ? '<span class="in-tag ok">ĐẠT</span>' : c.crit[ci] === 'NG' ? '<span class="in-tag ng">KHÔNG</span>' : '—'}</td></tr>`).join('')}
            </tbody></table>
            <div class="d-flex flex-wrap gap-3 align-items-center">
                <button type="button" class="in-mini" data-act="allOk" data-path="${p}">✓ Đánh đạt cả 5 sp</button>
                <label>Tổ trưởng ký ${inInput(p + '/toTruong', r.toTruong, { cls: 'in-w120', ph: 'Họ tên' })}</label>
                <label>QC ký (cho phép chạy loạt) ${inSign(r.qcKy, 'signP3', p + '/qcKy', c.canSign, '✍️ QC ký cho chạy loạt', 'Cần đủ 6 mục chuẩn bị ✓ và cả 5 sp đạt 4 hạng mục')}</label>
            </div>
          </div>
        </div>
        <div class="in-sec mt-3">C. XE THẺ VÀNG & THỬ BĂNG KEO <span class="opacity-75">(QC)</span></div>
        <div class="d-flex flex-wrap gap-3 align-items-end">
            <label>Giờ bắt đầu chạy loạt ${inInput(p + '/gioChayLoat', r.gioChayLoat, { type: 'time', cls: 'in-w95' })}</label>
            <label>Xe số ${inInput(p + '/xeSo', r.xeSo, { cls: 'in-w60' })}</label>
            <label>Mẫu vào lò ${inInput(p + '/vaoLo', r.vaoLo, { type: 'time', cls: 'in-w95' })}</label>
            <label>Ra lò ${inInput(p + '/raLo', r.raLo, { type: 'time', cls: 'in-w95' })}</label>
            <label>Để nguội đến ${inInput(p + '/nguoiDen', r.nguoiDen, { type: 'time', cls: 'in-w95' })}</label>
            <label>Thử băng keo 5 mẫu ${inSelect(p + '/bangKeo', r.bangKeo, [['KHONG_BONG', '✓ KHÔNG BONG (đạt)'], ['BONG', '✗ BONG → DỪNG MÁY']], { cls: 'in-w180 ' + (r.bangKeo === 'BONG' ? 'in-bad' : r.bangKeo === 'KHONG_BONG' ? 'in-good' : '') })}</label>
            <label>Gỡ thẻ vàng ${inSign(r.goTheVang, 'goTheVang', p + '/goTheVang', r.qcKy && r.bangKeo === 'KHONG_BONG', '🟨 QC gỡ thẻ vàng', 'Cần QC ký mẫu đầu và băng keo không bong')}</label>
        </div>
        <div class="small opacity-75 mt-1">Cách thử: dán băng keo kín chỗ in, miết chặt, chờ 1 phút, giật mạnh. Soi băng keo: không dính mực là đạt.</div>
        ${r.bangKeo === 'BONG' ? `<div class="in-alert mt-2">🟥 BONG: DỪNG MÁY, giữ lại cả xe thẻ vàng → lập phiếu dừng máy. ${r.p5Id ? `<span class="ms-2">Đã lập P5 ✓</span>` : `<button type="button" class="btn btn-sm btn-3d-ruby px-3 ms-2" data-act="p5FromP3" data-path="${p}">🛑 Lập phiếu dừng máy (P5)</button>`}</div>` : ''}
        </div>`;
    });
    return html;
}

// ---------- P4 QC ĐI KIỂM ----------
function inRenderP4() {
    let rounds = IN_ROUNDS[inShift()];
    if (!inP4Round || !rounds.includes(inP4Round)) {
        let now = inToMin(inNowHM());
        inP4Round = rounds.slice().reverse().find(rd => { let d = inDiffMin(rd, inNowHM()); return d != null && d < 120; }) || rounds[0];
        if (now == null) inP4Round = rounds[0];
    }
    let rd = inP4Round;
    let rows = inRows(inData.p4?.rounds?.[rd]?.rows);
    let hdr = inData.p4?.rounds?.[rd] || {};
    let html = `
    <div class="in-note">QC đi 1 vòng / 2 giờ. Ghi <b>OK</b> hoặc <b>NG</b> cho từng máy. Có 1 ô NG → KẾT QUẢ báo NG → <b>DỪNG MÁY</b> đó, lập P5.</div>
    <div class="in-rounds">${rounds.map(x => {
        let rr = inRows(inData.p4?.rounds?.[x]?.rows);
        let done = rr.some(([, r]) => inP4Calc(r) !== ''), ng = rr.some(([, r]) => inP4Calc(r) === 'NG');
        return `<button type="button" class="in-round ${x === rd ? 'active' : ''} ${ng ? 'ng' : done ? 'ok' : ''}" data-act="round" data-v="${x}">⏰ ${x}${ng ? ' ✗' : done ? ' ✓' : ''}</button>`;
    }).join('')}</div>
    <div class="in-head">
        <label>QC vòng ${rd} ${inInput(`p4/rounds/${rd}/qc`, hdr.qc || '', { cls: 'in-w140', ph: inUser() })}</label>
        <label>Giờ đi kiểm thực tế ${inInput(`p4/rounds/${rd}/gio`, hdr.gio || '', { type: 'time', cls: 'in-w95' })}</label>
        <div class="ms-auto d-flex gap-2 flex-wrap">
            <button type="button" class="btn btn-sm btn-outline-info rounded-pill px-3" data-act="p4Prev">📋 Lấy danh sách máy vòng trước</button>
            <button type="button" class="btn btn-sm btn-outline-info rounded-pill px-3" data-act="p4FromP3">🔰 Lấy máy từ phiếu mẫu đầu</button>
            <button type="button" class="btn btn-sm btn-3d-primary px-3" data-act="addP4">➕ Thêm máy</button>
        </div>
    </div>
    <div class="table-responsive"><table class="table table-bordered align-middle text-center in-table" style="min-width:1080px">
    <thead><tr><th>Máy số</th><th>Mã hàng</th>${IN_P4_COLS.map(([, t]) => `<th>${t}</th>`).join('')}<th>KẾT QUẢ (tự)</th><th>Ghi chú</th><th></th></tr></thead><tbody>`;
    if (!rows.length) html += `<tr><td colspan="10" class="opacity-75 py-3">Chưa có máy nào trong vòng ${rd}. Thêm máy hoặc lấy danh sách từ vòng trước / phiếu mẫu đầu.</td></tr>`;
    rows.forEach(([id, r]) => {
        let p = `p4/rounds/${rd}/rows/${id}`, kq = inP4Calc(r);
        html += `<tr class="${kq === 'NG' ? 'in-row-bad' : ''}">
            <td>${inInput(p + '/may', r.may, { cls: 'in-w60' })}</td>
            <td>${inInput(p + '/maHang', r.maHang, { cls: 'in-w110' })}</td>
            ${IN_P4_COLS.map(([k]) => `<td>${inCyc(p + '/' + k, r[k], { OK: 'OK', NG: 'NG' })}</td>`).join('')}
            <td>${kq === 'OK' ? '<span class="in-tag ok">OK</span>' : kq === 'NG' ? `<span class="in-tag ng">NG</span><div class="mt-1">${r.p5Id ? '<span class="small">Đã lập P5 ✓</span>' : `<button type="button" class="in-mini ng" data-act="p5FromP4" data-path="${p}">🛑 Dừng máy – lập P5</button>`}</div>` : '—'}</td>
            <td>${inInput(p + '/ghiChu', r.ghiChu, { cls: 'in-w160' })}</td>
            <td>${inDel(p, 'máy')}</td></tr>`;
    });
    html += `</tbody></table></div>
    <div class="d-flex gap-2 mt-2"><button type="button" class="in-mini" data-act="p4AllOk">✓ Đánh OK các ô còn trống của vòng này</button></div>`;
    return html;
}

// ---------- P5 DỪNG MÁY ----------
function inRenderP5() {
    let rows = inRows(inData.p5);
    let html = `
    <div class="in-note">Có lỗi là <b>DỪNG MÁY</b>, treo THẺ ĐỎ (QC dừng không cần xin phép; chỉ QC được gỡ thẻ đỏ). Gom riêng hàng in từ lần kiểm đạt gần nhất, dán tem đỏ. Chỉ chạy lại khi mẫu đầu đạt. Hàng giữ lại: <b>chỉ Phòng Chất lượng</b> quyết định trong 24 giờ.</div>
    <div class="in-head"><button type="button" class="btn btn-sm btn-3d-ruby px-3 ms-auto" data-act="addP5">🛑 Phiếu dừng máy mới</button></div>`;
    if (!rows.length) html += `<div class="in-empty">Ca này chưa có lần dừng máy nào.</div>`;
    rows.slice().reverse().forEach(([id, r]) => {
        let c = inP5Calc(r), p = `p5/${id}`;
        let chk = (sub, list) => list.map(([k, t]) => `<label class="in-cb"><input type="checkbox" data-p="${p}/${sub}/${k}" ${(r[sub] || {})[k] ? 'checked' : ''}> ${t}</label>`).join('');
        html += `<div class="in-card ${c.cls}">
        <div class="in-card-h">
            <div class="d-flex flex-wrap gap-2 align-items-center">
                <label>Giờ dừng ${inInput(p + '/gioDung', r.gioDung, { type: 'time', cls: 'in-w95' })}</label>
                <label>Máy số ${inInput(p + '/may', r.may, { cls: 'in-w60' })}</label>
                <label>Mã hàng ${inInput(p + '/maHang', r.maHang, { cls: 'in-w110' })}</label>
                <label>Màu ${inInput(p + '/mau', r.mau, { cls: 'in-w100' })}</label>
            </div>
            <div class="d-flex align-items-center gap-2"><span class="in-status ${c.cls}">${c.status}</span>
            <button type="button" class="in-mini" data-act="zaloP5" data-path="${p}" title="Gửi cảnh báo Zalo">💬 Báo Zalo${r.zalo ? ' ✓' : ''}</button>${inDel(p, 'phiếu dừng máy')}</div>
        </div>
        <div class="in-grid">
            <div class="in-k">Phát hiện khi</div><div>${inSelect(p + '/phatHien', r.phatHien, IN_P5_PHATHIEN, { cls: 'in-w160' })}</div>
            <div class="in-k">Lỗi gì</div><div class="d-flex flex-wrap gap-2 align-items-center">${chk('loi', IN_P5_LOI)} ${inInput(p + '/loiKhac', r.loiKhac, { cls: 'in-w160', ph: 'Khác…' })}</div>
            <div class="in-k">Hàng giữ lại<br><span class="small opacity-75">(từ lần kiểm đạt gần nhất)</span></div>
            <div class="d-flex flex-wrap gap-3 align-items-center"><label>Số lượng ${inInput(p + '/slGiu', r.slGiu, { type: 'number', cls: 'in-w80' })}</label><label>Để ở ${inInput(p + '/deO', r.deO, { cls: 'in-w140' })}</label><label class="in-cb"><input type="checkbox" data-p="${p}/temDo" ${r.temDo ? 'checked' : ''}> Đã dán tem đỏ</label></div>
            <div class="in-k">Nguyên nhân tìm được</div><div class="d-flex flex-wrap gap-2 align-items-center">${chk('nn', IN_P5_NN)} ${inInput(p + '/nnKhac', r.nnKhac, { cls: 'in-w160', ph: 'Khác…' })}</div>
            <div class="in-k">Đã sửa gì</div><div>${inInput(p + '/daSua', r.daSua, { cls: 'w-100' })}</div>
            <div class="in-k">Làm lại mẫu đầu (P3)</div><div class="d-flex flex-wrap gap-3 align-items-center"><label>Giờ ${inInput(p + '/p3Gio', r.p3Gio, { type: 'time', cls: 'in-w95' })}</label><label>Kết quả ${inSelect(p + '/p3Kq', r.p3Kq, [['DAT', '✓ Đạt'], ['CHUA', '✗ Chưa đạt']], { cls: 'in-w130 ' + (r.p3Kq === 'DAT' ? 'in-good' : r.p3Kq === 'CHUA' ? 'in-bad' : '') })}</label></div>
            <div class="in-k">QC gỡ thẻ đỏ</div><div>${inSign(r.goTheDo, 'goTheDo', p + '/goTheDo', r.p3Kq === 'DAT', '🟥 QC gỡ thẻ đỏ – cho máy chạy lại', 'Chỉ gỡ khi mẫu đầu làm lại ĐẠT')}</div>
            <div class="in-k">Phòng Chất lượng quyết định hàng giữ lại</div>
            <div class="d-flex flex-wrap gap-3 align-items-center"><label>Dùng được ${inInput(p + '/qd/dung', r.qd?.dung, { type: 'number', cls: 'in-w80' })}</label><label>Tẩy in lại ${inInput(p + '/qd/tay', r.qd?.tay, { type: 'number', cls: 'in-w80' })}</label><label>Hủy ${inInput(p + '/qd/huy', r.qd?.huy, { type: 'number', cls: 'in-w80' })}</label><label>Người quyết định ${inInput(p + '/qd/by', r.qd?.by, { cls: 'in-w140', ph: 'Phòng CL' })}</label>
            ${(() => { let g = inNum(r.slGiu), t = (inNum(r.qd?.dung) || 0) + (inNum(r.qd?.tay) || 0) + (inNum(r.qd?.huy) || 0); return g && t && g !== t ? `<span class="in-tag ng">Tổng ${t} ≠ SL giữ ${g}</span>` : ''; })()}</div>
        </div></div>`;
    });
    return html;
}

// ---------- QUY TRÌNH (tham chiếu) ----------
function inRenderQt() {
    let qt = [
        ['CB-01 Pha mực', 'Đầu ca thử cân bằng quả cân · lấy can nước ĐÚNG MÀU NHÃN (PVC = xanh lá) · cân mực → TRỪ BÌ → nước = mực × 1,2 · lệch ≤ 1 g · khuấy 3–5 phút · dán nhãn: màu, giờ pha, HẠN (+4 giờ), người pha · QC cân lại 1 cốc / ca.'],
        ['CB-02 Cấp mực & khi mực đặc', 'Thợ in không tự lấy / pha mực · chỉ cấp cốc còn hạn · mực cũ đổ can thu hồi RIÊNG, cấm đổ vào cốc mới · tại máy KHÔNG có can nước · mực đặc: tổ trưởng châm 1 lọ, gạch 1 vạch, tối đa 3 lần rồi thay cốc · in thử 3 sp sau mỗi lần châm.'],
        ['CB-03 Mẫu đầu', 'Đầu ca / đổi mã / đổi màu / mực mới / sau sửa máy / sau lỗi → in 5 sp · tổ trưởng xem, QC KÝ mới chạy loạt · hàng loạt vào XE THẺ VÀNG · 5 mẫu sấy – nguội – thử băng keo · không bong: QC gỡ thẻ vàng · bong: DỪNG MÁY → CB-05.'],
        ['CB-04 In loạt – sấy – QC đi kiểm', 'Đeo găng cả ca · 30 phút soi nét 1 lần · KHÔNG tự chỉnh áp lực, KHÔNG để can nước, KHÔNG chạm tay chỗ in · xếp khay 1 lớp, sấy: PVC dẻo 50–55 °C, PVC cứng / ABS 55–60 °C, 20–30 phút, nguội ≥ 30 phút · QC 2 giờ / vòng (P4).'],
        ['CB-05 Có lỗi – dừng máy', 'DỪNG MÁY, thẻ đỏ (chỉ QC gỡ) · gom hàng từ lần kiểm đạt gần nhất, tem đỏ · tìm nguyên nhân mực / phôi / máy / lò · làm lại mẫu đầu · đạt → gỡ thẻ đỏ · Phòng CL quyết định hàng giữ trong 24 giờ.'],
        ['CB-06 Kiểm hàng & xuất', 'Chỉ hàng khô đủ 24 giờ và QC kiểm đạt (CS-IN-06) mới đóng gói, xuất · kho kiểm phiếu QC đạt, đủ 24 giờ, đúng số lượng (CS-IN-07).']
    ];
    return `<div class="in-note">Tóm tắt bộ quy trình Giai đoạn 1 – Cơ bản (GD1_Co_ban_xuong_in). Mục tiêu: cả xưởng làm đều 5 việc gốc trước khi chuyển Giai đoạn 2.</div>
    ${qt.map(([t, d]) => `<div class="in-panel mb-2"><div class="in-panel-h">${t}</div><div>${d}</div></div>`).join('')}`;
}

// ===================== SỰ KIỆN =====================
function inScheduleRender() { setTimeout(renderTabIn, 0); }

function inOnChange(e) {
    let el = e.target;
    if (el.dataset.pick) { // P2: chọn cốc từ P1
        let base = el.dataset.pick, cid = el.value;
        inWrite(base + '/cocId', cid || null);
        let cup = cid ? inData.p1?.rows?.[cid] : null;
        if (cup) { inWrite(base + '/mau', cup.mau || ''); inWrite(base + '/gioPha', cup.gioPha || ''); }
        inScheduleRender(); return;
    }
    let p = el.getAttribute('data-p');
    if (!p) return;
    let v = el.type === 'checkbox' ? el.checked : el.value.trim();
    inWrite(p, v);
    // Ghi nhận thời điểm QC ký mẫu đầu bị mất hiệu lực khi kết quả 5 sp thay đổi về NG
    inScheduleRender();
}

function inOnClick(e) {
    let b = e.target.closest('[data-act]');
    if (!b || !document.getElementById('inRoot').contains(b)) return;
    let act = b.dataset.act, path = b.dataset.path, v = b.dataset.v;
    if (!checkAuthOrAlert()) return;
    let t = Date.now();
    switch (act) {
        case 'sub': inSub = v; break;
        case 'round': inP4Round = v; break;
        case 'cyc': {
            let cur = inGet(path);
            inWrite(path, !cur ? 'OK' : cur === 'OK' ? 'NG' : null);
            let r4 = path.match(/^p4\/rounds\/([^/]+)\//);
            if (r4) { let R = inData.p4?.rounds?.[r4[1]] || {}; if (!R.qc) inWrite(`p4/rounds/${r4[1]}/qc`, inUser()); if (!R.gio) inWrite(`p4/rounds/${r4[1]}/gio`, inNowHM()); }
            // Mẫu đầu: nếu 5 sp / chuẩn bị đổi sang NG sau khi QC đã ký → hủy chữ ký
            let m = path.match(/^p3\/([^/]+)\/(a|b)\//);
            if (m && inGet(path) === 'NG' && inGet(`p3/${m[1]}/qcKy`)) { inWrite(`p3/${m[1]}/qcKy`, null); inToast('Mẫu đầu có mục ✗ – chữ ký QC đã bị hủy, phải ký lại.', true); }
            break;
        }
        case 'now': inWrite(path, inNowHM()); break;
        case 'clr': inWrite(path, null); break;
        case 'unsign': if (confirm('Hủy chữ ký này?')) inWrite(path, null); break;
        case 'del': if (confirm(`Xóa ${b.dataset.what}?`)) inWrite(path, null); break;
        case 'addP1': inWrite(`p1/rows/${inId()}`, { t, gioPha: inNowHM(), nhua: 'PVC', nguoi: inData.p1?.header?.nguoiPha || '' }); break;
        case 'qcP1': inWrite(path + '/qc', inStamp()); inWrite(path + '/qcKq', v); if (v === 'SAI') inToast('QC cân lại SAI → đổ bỏ cốc, pha lại, nhắc người pha.', true); break;
        case 'addP2': inWrite(`p2/rows/${inId()}`, { t, gioCap: inNowHM(), nguoiCap: inData.p2?.header?.nguoiCap || '' }); break;
        case 'addP3': inWrite(`p3/${inId()}`, { t, lyDo: inRows(inData.p3).length ? '' : 'Đầu ca' }); break;
        case 'allOk': {
            let b0 = {}; IN_P3_CRIT.forEach((_, ci) => { b0[ci] = { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'OK', 4: 'OK' }; });
            inWrite(path + '/b', b0); break;
        }
        case 'signP3': inWrite(path, inStamp()); inToast('✅ QC đã ký – cho phép chạy loạt. Hàng loạt vào xe THẺ VÀNG.'); break;
        case 'goTheVang': inWrite(path, inStamp()); break;
        case 'goTheDo': inWrite(path, inStamp()); inToast('✅ Đã gỡ thẻ đỏ – máy chạy lại.'); break;
        case 'p5FromP3': {
            let r = inGet(path) || {}, id = inId();
            inWrite(`p5/${id}`, { t, gioDung: inNowHM(), may: r.may || '', maHang: r.maHang || '', mau: r.mau || '', phatHien: 'Mẫu đầu', loi: { bangKeo: true }, p3Ref: path });
            inWrite(path + '/p5Id', id);
            inSub = 'p5'; inZaloP5(`p5/${id}`, true); break;
        }
        case 'addP4': inWrite(`p4/rounds/${inP4Round}/rows/${inId()}`, { t }); break;
        case 'p4Prev': {
            let rounds = IN_ROUNDS[inShift()], idx = rounds.indexOf(inP4Round);
            let src = null;
            for (let i = idx - 1; i >= 0 && !src; i--) { let rr = inRows(inData.p4?.rounds?.[rounds[i]]?.rows); if (rr.length) src = rr; }
            if (!src) { inToast('Không có vòng trước nào có danh sách máy.', true); break; }
            inP4AddMachines(src.map(([, r]) => ({ may: r.may, maHang: r.maHang })));
            break;
        }
        case 'p4FromP3': {
            let list = [], seen = {};
            inRows(inData.p3).forEach(([, r]) => { if (r.may) seen[r.may] = { may: r.may, maHang: r.maHang }; });
            Object.values(seen).forEach(x => list.push(x));
            if (!list.length) { inToast('Chưa có phiếu mẫu đầu nào ghi máy số.', true); break; }
            inP4AddMachines(list); break;
        }
        case 'p4AllOk': {
            inRows(inData.p4?.rounds?.[inP4Round]?.rows).forEach(([id, r]) => IN_P4_COLS.forEach(([k]) => { if (!r[k]) inWrite(`p4/rounds/${inP4Round}/rows/${id}/${k}`, 'OK'); }));
            break;
        }
        case 'p5FromP4': {
            let r = inGet(path) || {}, id = inId();
            let loi = {}; if (r.c4 === 'NG') loi.matNet = true; if (r.c5 === 'NG') loi.bangKeo = true;
            let nn = {}; if (r.c1 === 'NG' || r.c2 === 'NG') nn.muc = true;
            let ng = IN_P4_COLS.filter(([k]) => r[k] === 'NG').map(([, t]) => t).join('; ');
            inWrite(`p5/${id}`, { t, gioDung: inNowHM(), may: r.may || '', maHang: r.maHang || '', phatHien: 'QC đi kiểm', loi, nn, loiKhac: (r.c1 === 'NG' || r.c2 === 'NG' || r.c3 === 'NG') ? ng : '' });
            inWrite(path + '/p5Id', id);
            inSub = 'p5'; inZaloP5(`p5/${id}`, true); break;
        }
        case 'addP5': inWrite(`p5/${inId()}`, { t, gioDung: inNowHM() }); break;
        case 'zaloP5': inZaloP5(path, false); break;
    }
    renderTabIn();
}

function inP4AddMachines(list) {
    let have = {}; inRows(inData.p4?.rounds?.[inP4Round]?.rows).forEach(([, r]) => { if (r.may) have[r.may] = 1; });
    let n = 0, t = Date.now();
    list.forEach((x, i) => { if (x.may && !have[x.may]) { inWrite(`p4/rounds/${inP4Round}/rows/${inId()}`, { t: t + i, may: x.may, maHang: x.maHang || '' }); n++; } });
    inToast(n ? `Đã thêm ${n} máy vào vòng ${inP4Round}.` : 'Các máy đã có sẵn trong vòng này.');
}

async function inZaloP5(path, auto) {
    let r = inGet(path) || {};
    let loi = IN_P5_LOI.filter(([k]) => (r.loi || {})[k]).map(([, t]) => t);
    if (r.loiKhac) loi.push(r.loiKhac);
    let msg = `🛑 XƯỞNG IN – DỪNG MÁY ${r.may || '?'}\n📅 ${inDate()} ${inShift() === 'NGAY' ? 'Ca Ngày' : 'Ca Đêm'} · ${r.gioDung || inNowHM()}\n📦 Mã hàng: ${r.maHang || '-'} · Màu: ${r.mau || '-'}\n🔎 Phát hiện: ${r.phatHien || '-'}\n❌ Lỗi: ${loi.join(', ') || '-'}\n👤 QC: ${inUser()}\n➡️ Treo thẻ đỏ, giữ hàng từ lần kiểm đạt gần nhất.`;
    if (typeof sendZaloAlert !== 'function') return;
    let ok = await sendZaloAlert(msg, inDate());
    if (ok) { inWrite(path + '/zalo', inNowHM()); inToast('💬 Đã gửi cảnh báo Zalo.'); if (!auto) renderTabIn(); }
    else if (!auto) inToast('Không gửi được Zalo (chưa cài webhook?).', true);
}

// ===================== XUẤT EXCEL =====================
function exportTabInExcel() {
    if (typeof XLSX === 'undefined') { alert('Chưa tải được thư viện Excel.'); return; }
    let wb = XLSX.utils.book_new();
    let ca = inShift() === 'NGAY' ? 'Ca Ngày' : 'Ca Đêm';
    let head = t => [[t], [`Ngày: ${inDate()} · ${ca}`], []];
    let add = (name, aoa) => { let ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = (aoa[3] || []).map(() => ({ wch: 16 })); XLSX.utils.book_append_sheet(wb, ws, name); };
    let yn = v => v === 'OK' ? '✓' : v === 'NG' ? '✗' : '';
    let h1 = inData.p1?.header || {};
    add('P1 Pha muc', head('P1 · PHIẾU PHA MỰC').concat([[`Thử cân đầu ca: ${h1.canOk === 'DUNG' ? 'Đúng' : h1.canOk === 'SAI' ? 'Sai' : ''}`, `Người pha: ${h1.nguoiPha || ''}`]],
        [['STT', 'Giờ pha', 'Mã hàng', 'Màu / mã mực', 'Nhựa', 'Can nước đúng màu', 'Gram mực', 'Gram nước phải rót', 'Gram nước đã rót', 'Đúng?', 'Hạn dùng', 'Dán nhãn', 'Người pha', 'QC kiểm']],
        inRows(inData.p1?.rows).map(([, r], i) => { let c = inP1Calc(r); return [i + 1, r.gioPha || '', r.maHang || '', r.mau || '', r.nhua || 'PVC', yn(r.canNuoc), r.gramMuc || '', c.khongTyLe ? 'Chưa có tỷ lệ' : (c.phai ?? ''), r.gramNuoc || '', c.dung == null ? '' : c.dung ? 'ĐÚNG' : 'SAI', c.han, yn(r.nhan), r.nguoi || '', r.qc ? `${r.qc.by} ${r.qc.at} ${r.qcKq || ''}` : '']; })));
    add('P2 Cap muc', head('P2 · PHIẾU CẤP MỰC & CHÂM NƯỚC').concat([['STT', 'Giờ cấp', 'Máy số', 'Màu / mã mực', 'Giờ pha', 'Còn hạn?', 'Đổ mực cũ vào can thu hồi', 'Người cấp', 'Thợ in ký nhận', 'Châm 1', 'Châm 2', 'Châm 3', 'Tổ trưởng ký', 'Ghi chú']],
        inRows(inData.p2?.rows).map(([, r], i) => { let c = inP2Calc(r); return [i + 1, r.gioCap || '', r.may || '', r.mau || '', r.gioPha || '', c.conHan == null ? '' : c.conHan ? 'Còn hạn' : 'HẾT HẠN', yn(r.doMucCu), r.nguoiCap || '', r.thoIn || '', r.cham1 || '', r.cham2 || '', r.cham3 || '', r.toTruong || '', r.ghiChu || '']; })));
    add('P3 Mau dau', head('P3 · PHIẾU MẪU ĐẦU').concat([['Máy', 'Mã hàng', 'Màu', 'Nhựa', 'Lý do', ...IN_P3_PREP.map((t, i) => `A${i + 1}. ${t}`), ...IN_P3_CRIT.map((t, i) => `B${i + 1}. ${t}`), 'Tổ trưởng ký', 'QC ký', 'Giờ chạy loạt', 'Xe số', 'Vào lò', 'Ra lò', 'Nguội đến', 'Băng keo', 'Gỡ thẻ vàng', 'Trạng thái']],
        inRows(inData.p3).map(([, r]) => { let c = inP3Calc(r); return [r.may || '', r.maHang || '', r.mau || '', r.nhua || '', r.lyDo || '', ...IN_P3_PREP.map((_, i) => yn((r.a || {})[i])), ...c.crit.map(v => v === 'OK' ? 'Đạt' : v === 'NG' ? 'Không đạt' : ''), r.toTruong || '', r.qcKy ? `${r.qcKy.by} ${r.qcKy.at}` : '', r.gioChayLoat || '', r.xeSo || '', r.vaoLo || '', r.raLo || '', r.nguoiDen || '', r.bangKeo === 'BONG' ? 'BONG' : r.bangKeo === 'KHONG_BONG' ? 'Không bong' : '', r.goTheVang ? `${r.goTheVang.by} ${r.goTheVang.at}` : '', c.status]; })));
    let p4 = [['Vòng', 'QC', 'Máy số', 'Mã hàng', ...IN_P4_COLS.map(([, t]) => t), 'KẾT QUẢ', 'Ghi chú']];
    IN_ROUNDS[inShift()].forEach(rd => { let R = inData.p4?.rounds?.[rd] || {}; inRows(R.rows).forEach(([, r]) => p4.push([rd, R.qc || '', r.may || '', r.maHang || '', ...IN_P4_COLS.map(([k]) => r[k] || ''), inP4Calc(r), r.ghiChu || ''])); });
    add('P4 QC di kiem', head('P4 · PHIẾU QC ĐI KIỂM 2 GIỜ / LẦN').concat(p4));
    add('P5 Dung may', head('P5 · PHIẾU DỪNG MÁY / HÀNG LỖI').concat([['Giờ dừng', 'Máy', 'Mã hàng', 'Màu', 'Phát hiện khi', 'Lỗi', 'SL giữ', 'Để ở', 'Tem đỏ', 'Nguyên nhân', 'Đã sửa', 'Mẫu đầu lại (giờ)', 'KQ', 'Gỡ thẻ đỏ', 'Dùng được', 'Tẩy in lại', 'Hủy', 'Người QĐ', 'Trạng thái']],
        inRows(inData.p5).map(([, r]) => [r.gioDung || '', r.may || '', r.maHang || '', r.mau || '', r.phatHien || '', IN_P5_LOI.filter(([k]) => (r.loi || {})[k]).map(([, t]) => t).concat(r.loiKhac ? [r.loiKhac] : []).join('; '), r.slGiu || '', r.deO || '', r.temDo ? '✓' : '', IN_P5_NN.filter(([k]) => (r.nn || {})[k]).map(([, t]) => t).concat(r.nnKhac ? [r.nnKhac] : []).join('; '), r.daSua || '', r.p3Gio || '', r.p3Kq === 'DAT' ? 'Đạt' : r.p3Kq === 'CHUA' ? 'Chưa đạt' : '', r.goTheDo ? `${r.goTheDo.by} ${r.goTheDo.at}` : '', r.qd?.dung || '', r.qd?.tay || '', r.qd?.huy || '', r.qd?.by || '', inP5Calc(r).status])));
    XLSX.writeFile(wb, `Xuong_In_${inDate()}_${inShift()}.xlsx`);
}

// ===================== GẮN SỰ KIỆN =====================
document.addEventListener('DOMContentLoaded', () => {
    let root = document.getElementById('inRoot');
    if (!root) return;
    root.addEventListener('change', inOnChange);
    root.addEventListener('click', inOnClick);
    root.addEventListener('focusout', () => setTimeout(() => {
        let ae = document.activeElement;
        if (inPendingRender && !(ae && root.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName))) renderTabIn();
    }, 50));
});
