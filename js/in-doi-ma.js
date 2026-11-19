/**
 * QC System - Tab 4 Xưởng in: PHIẾU CHECK ĐỔI MÃ HÀNG (BM-IN-01)
 * Chống sót bước in khi đổi mã: gọi deco bản mới nhất → A chuẩn bị → B lắp đặt (tick từng bước)
 * → đếm nét in so với deco → C QC kiểm 5 SP đầu. Phiếu luân chuyển ① KTV → ② tổ trưởng đếm lại (tùy chọn,
 * có thể bỏ qua) → ③ QC kết luận; bắt buộc có KTV và QC, đủ 2/3 người là được chạy đại trà.
 * mỗi người nhập tên mình (các tên tham gia phải khác nhau), ai đã bấm chuyển thì phần đó khóa lại.
 * Bộ phận in chưa có lệnh trên phần mềm sản xuất → phiếu chỉ ghi nhận và cảnh báo trên phần mềm QC.
 *
 * Dữ liệu Firebase:
 *   qc_in_deco_v1/sp/{khóa mã SP}    = sản phẩm theo file danh_muc_buoc_in.json (deco bản mới nhất)
 *   qc_in_deco_v1/meta              = { napLuc, napBoi, nguon, soSp, soBuoc }
 *   qc_in_deco_v1/cxn/{id}          = điểm "cần xác nhận": { ma_san_pham, ma_linh_kien, noi_dung, trang_thai, traLoi, xuLyBoi, xuLyLuc }
 *   qc_in_deco_v1/lichSuNap/{ts}    = lịch sử mỗi lần nạp danh mục
 *   qc_in_doima_v1/{YYYY-MM-DD}/{id} = phiếu đổi mã (chụp lại deco lúc lập phiếu để truy vết về sau)
 */

const DM_DECO = 'qc_in_deco_v1';
const DM_PHIEU = 'qc_in_doima_v1';
const DM_UV_TINH = false;   // false: bước in UV kỹ thuật số (打印) không tick lắp đặt, không tính vào số nét tampon (chờ xác nhận)
const DM_A = [
    'Deco đúng phiên bản (bản mới nhất trên phần mềm)',
    'Có mẫu chuẩn tại máy',
    'Đã dọn sạch hàng, bản in, mực, jig của mã trước',
    'Phôi đúng mã, đúng màu nền, đã qua đủ công đoạn trước',
    'Kỹ thuật viên đã đọc deco và đếm số bước in'
];
const DM_B = [['ban', 'Bản in đã lắp'], ['muc', 'Mực đúng mã'], ['jig', 'Jig đúng']];
const DM_C = ['Đủ vị trí in', 'Đúng màu', 'Đúng vị trí, không ngược trái/phải', 'Nét in rõ, không nhòe'];
// Thử băng keo (thay P3 khi đổi mã): 5 mẫu / linh kiện, không bong là đạt
const DM_KY = [['ktv', 'Kỹ thuật viên', 'ktv'], ['toTruong', 'Tổ trưởng', 'toTruong'], ['qc', 'QC', 'qcTen']];

let dmDeco = { sp: {}, cxn: {}, meta: null };
let dmDecoBound = false, dmDecoLoaded = false;
let dmPhieu = {}, dmPhieuPath = null, dmPhieuLoaded = false;
let dmPhieuTruoc = {};          // phiếu đổi mã của ngày hôm trước (ca đêm chạy qua 0 giờ)
let dmMo = null;                 // id phiếu đang mở (null = danh sách)
let dmXem = 'ds';                // 'ds' danh sách | 'ls' lịch sử
let dmTim = '', dmMaMoi = '', dmMayMoi = '';
let dmDecoTim = '', dmDecoMa = null, dmCxnLoc = 'chua';
let dmLs = { tu: '', den: '', tim: '', rows: null, dangTai: false };

// ===================== TIỆN ÍCH =====================
function dmKey(s) { return String(s || '').trim().replace(/[.#$\[\]\/]/g, '_'); }
function dmArr(x) { return Array.isArray(x) ? x : Object.keys(x || {}).sort((a, b) => a - b).map(k => x[k]); }
function dmNum(v) { if (v === '' || v == null) return null; let n = parseInt(String(v).replace(/\D/g, ''), 10); return isNaN(n) ? null : n; }
function dmHash(s) { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return 'x' + (h >>> 0).toString(36); }
function dmLuot(b) {
    let m = /IN\s*(\d+)\s*LƯỢT/i.exec(b.ghi_chu || '') || /印\s*(\d+)\s*次/.exec((b.mau_goc || '') + ' ' + (b.vi_tri_goc || ''));
    return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}
function dmLaUv(b) { return /IN UV kỹ thuật số|打印/.test(b.ghi_chu || ''); }
function dmTinh(b) { return DM_UV_TINH || !dmLaUv(b); }           // bước có tick lắp đặt và tính nét không
function dmLa10k(b) { return /1万|10\.000/.test(b.ghi_chu || ''); } // bản in mã ngày / mã UV chỉ in ~10.000 cái
function dmSig(sp) { return `${sp.phien_ban_deco || ''}|${sp.ngay_lap || ''}|${sp.tong_buoc_in || 0}`; }
function dmCaTen(c) { return c === 'DEM' ? '🌙 Ca đêm' : '☀️ Ca ngày'; }
function dmCoQuyenNap() { return typeof pqLaAdmin === 'function' ? (pqLaAdmin() || (typeof pqCoAdmin === 'function' && !pqCoAdmin())) : true; }
// Mỗi trình duyệt / điện thoại có 1 mã thiết bị riêng (lưu trong máy) để chặn 1 người nhập 2 tên trên cùng máy
function dmThietBi() {
    if (dmThietBi._v) return dmThietBi._v;
    let id = '';
    try { id = localStorage.getItem('qc_thiet_bi_id') || ''; if (!id) { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem('qc_thiet_bi_id', id); } }
    catch (e) { id = 'tam' + Math.random().toString(36).slice(2, 8); }
    let ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    let os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Máy';
    return (dmThietBi._v = { id, ten: `${os}·${id.slice(-4).toUpperCase()}` });
}
function dmGio() { let d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':'); }
function dmStamp(ten) { let tb = dmThietBi(); return { ten: ten || inUser(), acc: inUser(), at: dmGio(), ts: Date.now(), dev: tb.id, tb: tb.ten }; }
function dmKyHtml(s, coMay) { return s ? `${inEsc(s.ten || s.acc || '')} · ${inEsc(s.at || '')}${coMay && s.tb ? ` · 📱 ${inEsc(s.tb)}` : ''}` : ''; }
// Thiết bị đã dùng ở bước KTV / tổ trưởng (để bước sau không được làm trên cùng máy)
function dmTbBuoc(p, buoc) {
    let s = new Set(), add = x => { if (x && x.dev) s.add(x.dev); };
    if (buoc === 'KTV') {
        add((p.ky || {}).ktv); add((p.tenLuc || {}).ktv);
        Object.values(p.b || {}).forEach(lk => Object.values(lk || {}).forEach(st => DM_B.forEach(([k]) => add((st || {})[k]))));
        Object.values(p.demLuc || {}).forEach(add);
    } else {
        add((p.ky || {}).toTruong); add((p.tenLuc || {}).toTruong);
        Object.values(p.demTTLuc || {}).forEach(add);
    }
    return s;
}
// Trả về lý do chặn nếu máy đang dùng đã làm bước trước của phiếu, ngược lại ''
function dmChanMay(p) {
    let b = dmBuoc(p), me = dmThietBi().id;
    if (b === 'TT' && dmTbBuoc(p, 'KTV').has(me)) return 'Máy này đã dùng cho bước KỸ THUẬT VIÊN của phiếu – tổ trưởng phải dùng điện thoại / máy khác.';
    if (b === 'QC' && dmTbBuoc(p, 'KTV').has(me)) return 'Máy này đã dùng cho bước KỸ THUẬT VIÊN của phiếu – QC phải dùng điện thoại / máy khác.';
    if (b === 'QC' && dmTbBuoc(p, 'TT').has(me)) return 'Máy này đã dùng cho bước TỔ TRƯỞNG của phiếu – QC phải dùng điện thoại / máy khác.';
    return '';
}
function dmPhutGiua(a, b) { if (!a || !b) return ''; let g = Math.max(0, Math.round((b - a) / 1000)); return g < 60 ? `${g} giây` : g < 3600 ? `${Math.floor(g / 60)} phút ${g % 60} giây` : `${Math.floor(g / 3600)} giờ ${Math.floor(g % 3600 / 60)} phút`; }
function dmTenLucHtml(p, k) { let t = (p.tenLuc || {})[k]; return t ? `<span class="dm-who">Tên nhập lúc ${inEsc(t.at || '')}${t.tb ? ` · 📱 ${inEsc(t.tb)}` : ''}</span>` : ''; }

// ===================== LẮNG NGHE FIREBASE =====================
function dmVeLai() {
    if (!['dm', 'deco', 'tong'].includes(inSub)) return;
    let ae = document.activeElement, root = document.getElementById('inRoot');
    if (root && ae && root.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && !/checkbox|radio|file/.test(ae.type)) { inPendingRender = true; return; }
    renderTabIn();
}
function dmSubscribe() {
    if (typeof db === 'undefined' || !db || !isEditMode) return;
    if (!dmDecoBound) {
        dmDecoBound = true;
        db.ref(DM_DECO).on('value', snap => {
            let v = snap.val() || {};
            dmDeco = { sp: v.sp || {}, cxn: v.cxn || {}, meta: v.meta || null };
            dmDecoLoaded = true;
            dmVeLai();
        }, err => { dmDecoBound = false; inToast('⚠️ Không đọc được danh mục deco: ' + (err.code || err.message), true); });
    }
    let path = `${DM_PHIEU}/${inDate()}`;
    if (dmPhieuPath === path) return;
    if (dmPhieuPath) db.ref(dmPhieuPath).off();
    dmPhieuPath = path; dmPhieu = {}; dmPhieuLoaded = false; dmPhieuTruoc = {};
    let homTruoc = dmNgayTruoc(inDate());
    db.ref(`${DM_PHIEU}/${homTruoc}`).once('value').then(sn => { if (dmPhieuPath === path) { dmPhieuTruoc = sn.val() || {}; if (['tong', 'p4'].includes(inSub)) renderTabIn(); } }).catch(() => {});
    if (dmMo) dmMo = null;
    db.ref(path).on('value', snap => {
        if (dmPhieuPath !== path) return;
        dmPhieu = snap.val() || {};
        dmPhieuLoaded = true;
        dmVeLai();
    }, err => inToast('⚠️ Không đọc được phiếu đổi mã: ' + (err.code || err.message), true));
}
// ===================== ĐỐI CHIẾU VỚI QC ĐI KIỂM 2 GIỜ =====================
function dmNgayTruoc(d) { let x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
function dmChuanMay(m) { let s = String(m || '').toUpperCase().trim(), d = s.replace(/\D/g, ''); return d ? String(parseInt(d, 10)) : s.replace(/\s/g, ''); }
function dmChuanMa(m) { return String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
// Hai mã hàng coi là cùng mã nếu giống hệt, hoặc mã ghi tắt (≥ 4 ký tự) nằm trong mã đầy đủ: "93952" ~ "W93952-900004"
function dmCungMa(a, b) {
    let x = dmChuanMa(a), y = dmChuanMa(b);
    if (!x || !y) return false;
    if (x === y) return true;
    let ngan = x.length < y.length ? x : y, dai = x.length < y.length ? y : x;
    return ngan.length >= 4 && dai.includes(ngan);
}
// Tìm phiếu đổi mã cho máy + mã (hôm nay và hôm trước), ưu tiên phiếu đã ĐẠT, mới nhất
function dmTimPhieuDoiMa(may, ma) {
    let ds = [];
    Object.entries(dmPhieu || {}).forEach(([id, p]) => { if (p && typeof p === 'object') ds.push({ id, p, d: inDate() }); });
    Object.entries(dmPhieuTruoc || {}).forEach(([id, p]) => { if (p && typeof p === 'object') ds.push({ id, p, d: dmNgayTruoc(inDate()) }); });
    ds = ds.filter(x => dmChuanMay(x.p.may) === dmChuanMay(may) && dmCungMa(x.p.ma, ma));
    ds.sort((a, b) => ((b.p.kl === 'DAT') - (a.p.kl === 'DAT')) || ((b.p.t || 0) - (a.p.t || 0)));
    return ds[0] || null;
}
function dmStop() {
    if (typeof db !== 'undefined' && db) {
        if (dmPhieuPath) db.ref(dmPhieuPath).off();
        if (dmDecoBound) db.ref(DM_DECO).off();
    }
    dmPhieuPath = null; dmDecoBound = false; dmPhieuTruoc = {}; dmDecoLoaded = false; dmPhieuLoaded = false;
    dmPhieu = {}; dmDeco = { sp: {}, cxn: {}, meta: null }; dmMo = null;
}

// Ghi 1 trường của phiếu đang mở (ghi theo từng ô để nhiều người nhập cùng lúc không đè nhau)
function dmGet(p, rel) { return rel.split('/').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : undefined, p); }
function dmSetLocal(obj, rel, val) {
    let ks = rel.split('/'), o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (!o[ks[i]] || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    if (val === null || val === undefined || val === '') delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = val;
}
function dmWrite(id, rel, val) {
    if (val === '' || val === false) val = null;
    let p = dmPhieu[id]; if (!p) return;
    dmSetLocal(p, rel, val);
    if (typeof db !== 'undefined' && db && isConnected) {
        db.ref(`${DM_PHIEU}/${inDate()}/${id}/${rel}`).set(val === undefined ? null : val)
            .catch(err => inToast('⚠️ Không lưu được lên Firebase: ' + (err && err.message ? err.message : err), true));
    }
}
// ===================== LUÂN CHUYỂN: BẮT BUỘC KTV + QC, TỔ TRƯỞNG TÙY CHỌN =====================
// Thứ tự: KTV (A, B lắp đặt, đếm nét) → [Tổ trưởng đếm lại độc lập – tùy chọn, có thể bỏ qua] → QC (C, kết luận).
// Người nào bấm "hoàn thành" thì phần đó khóa lại, phiếu chuyển sang chờ người tiếp theo. Đủ KTV + QC (2/3) là được chạy đại trà.
const DM_BUOC = [
    ['KTV', '① Kỹ thuật viên', 'Lắp đặt & đếm nét', 'ktv'],
    ['TT', '② Tổ trưởng (tùy chọn)', 'Đếm lại nét in – có thể bỏ qua', 'toTruong'],
    ['QC', '③ QC', 'Kiểm 5 SP đầu & kết luận', 'qc']
];
function dmBuoc(p) { return p.kl === 'DAT' ? 'DAT' : (['KTV', 'TT', 'QC'].includes(p.buoc) ? p.buoc : 'KTV'); }
function dmTenChuan(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim(); }
function dmPhut(ts) { if (!ts) return ''; let m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút`; }

// ===================== TÍNH TOÁN TRẠNG THÁI =====================
function dmLks(p) { return dmArr(p.lk).map((lk, i) => [i, lk]).filter(([i, lk]) => lk && !(p.boLk || {})[i]); }
function dmTinhLk(p, i, lk) {
    let buoc = dmArr(lk.buoc), tinh = buoc.map((b, j) => [j, b]).filter(([, b]) => dmTinh(b));
    let bv = (p.b || {})[i] || {};
    let bCan = tinh.length * DM_B.length, bXong = 0;
    tinh.forEach(([j]) => DM_B.forEach(([k]) => { if (((bv[j] || {})[k] || {}).at) bXong++; }));
    let net = tinh.reduce((s, [, b]) => s + dmLuot(b), 0);
    let dem = dmNum((p.dem || {})[i]), demTT = dmNum((p.demTT || {})[i]);
    let cv = (p.c || {})[i] || {}, co = cv.co || {}, kq = cv.kq || {};
    let coXong = tinh.filter(([j]) => co[j]).length;
    let o = 0, ng = 0;
    DM_C.forEach((_, ci) => [0, 1, 2, 3, 4].forEach(si => { let v = (kq[ci] || {})[si]; if (v === 'OK') o++; else if (v === 'NG') ng++; }));
    return {
        buoc, tinh, bCan, bXong, bDu: bXong === bCan, net, dem, demTT,
        demDung: dem !== null && dem === net, demLech: dem !== null && dem !== net,
        ttDung: demTT !== null && demTT === net, ttLech: demTT !== null && demTT !== net,
        coXong, coDu: coXong === tinh.length, cOk: o === DM_C.length * 5, cNg: ng > 0,
        cDu: coXong === tinh.length && o === DM_C.length * 5
    };
}
// Thử băng keo: 5 mẫu / linh kiện, không hẹn giờ sấy/nguội – QC tự quyết định lúc nào thử rồi tick kết quả
function dmBangKeo(p, lks) {
    let kq = p.bkKq || {};
    let o = 0, ng = 0, can = lks.length * 5;
    lks.forEach(x => [0, 1, 2, 3, 4].forEach(si => { let v = ((kq[x.i] || {})[si]); if (v === 'OK') o++; else if (v === 'NG') ng++; }));
    return { ng: ng > 0, du: can > 0 && o === can, o, can };
}
function dmDecoCu(p) {
    if (p.kl === 'DAT') return false;
    let sp = dmDeco.sp[p.spKey];
    return !!(dmDecoLoaded && sp && dmSig(sp) !== p.decoSig);
}
function dmCalc(p) {
    let lks = dmLks(p).map(([i, lk]) => ({ i, lk, t: dmTinhLk(p, i, lk) }));
    let a = DM_A.map((_, i) => (p.a || {})[i]);
    let aOk = a.every(v => v === 'OK'), aNg = a.some(v => v === 'NG');
    let bCan = lks.reduce((s, x) => s + x.t.bCan, 0), bXong = lks.reduce((s, x) => s + x.t.bXong, 0);
    let co = lks.length > 0;
    let bDu = co && lks.every(x => x.t.bDu);
    let demDu = co && lks.every(x => x.t.demDung), demLech = lks.some(x => x.t.demLech);
    let ttDu = co && lks.every(x => x.t.ttDung), ttLech = lks.some(x => x.t.ttLech);
    let cDu = co && lks.every(x => x.t.cDu), cNg = lks.some(x => x.t.cNg);
    let bk = dmBangKeo(p, lks);
    let decoCu = dmDecoCu(p), buoc = dmBuoc(p);
    let ktvTen = String(p.ktv || '').trim(), ttTen = String(p.toTruong || '').trim(), qcTen = String(p.qcTen || '').trim();
    let ttTrung = ttTen && dmTenChuan(ttTen) === dmTenChuan(ktvTen);
    let qcTrung = qcTen && (dmTenChuan(qcTen) === dmTenChuan(ktvTen) || dmTenChuan(qcTen) === dmTenChuan(ttTen));
    let xongKTV = !decoCu && aOk && bDu && demDu && !!ktvTen;
    let xongTT = !decoCu && ttDu && !!ttTen && !ttTrung;
    let xongQC = !decoCu && cDu && !cNg && bk.du && !bk.ng && !!qcTen && !qcTrung;
    let lan = Object.keys(p.lan || {}).length;
    // thời điểm bắt đầu chờ bước hiện tại (nếu tổ trưởng bị bỏ qua thì tính từ lúc bỏ qua)
    let ky = p.ky || {};
    let tuLuc = buoc === 'TT' ? (ky.ktv || {}).ts : buoc === 'QC' ? ((ky.toTruong || p.ttBoQua || {}).ts) : (p.lamLaiTs || p.t);
    let st, cls;
    if (buoc === 'DAT') { st = 'ĐẠT – được chạy đại trà'; cls = 'ok'; }
    else if (decoCu) { st = 'Deco đã đổi bản – không dùng phiếu này'; cls = 'ng'; }
    else if (buoc === 'KTV') {
        if (!lks.length) { st = 'Chờ KTV: chọn linh kiện'; cls = 'warn'; }
        else if (aNg) { st = 'Chờ KTV: chuẩn bị KHÔNG ĐẠT'; cls = 'ng'; }
        else if (demLech) { st = 'Chờ KTV: KHÓA – đếm nét lệch deco'; cls = 'ng'; }
        else if (!aOk) { st = 'Chờ KTV: chuẩn bị (A)'; cls = 'warn'; }
        else if (!bDu) { st = `Chờ KTV: lắp đặt ${bXong}/${bCan}`; cls = 'warn'; }
        else if (!demDu) { st = 'Chờ KTV: đếm nét in'; cls = 'warn'; }
        else { st = 'Chờ KTV bấm hoàn thành'; cls = 'warn'; }
    } else if (buoc === 'TT') {
        if (ttLech) { st = 'Chờ TỔ TRƯỞNG: đếm lại không khớp'; cls = 'ng'; }
        else { st = 'Chờ TỔ TRƯỞNG đếm lại nét in'; cls = 'yellow'; }
    } else {
        if (bk.ng) { st = 'Chờ QC: BĂNG KEO BONG – dừng máy'; cls = 'ng'; }
        else if (cNg) { st = 'Chờ QC: có mục KHÔNG ĐẠT'; cls = 'ng'; }
        else if (!cDu) { st = 'Chờ QC kiểm 5 SP đầu'; cls = 'yellow'; }
        else { st = 'Chờ QC: thử băng keo'; cls = 'yellow'; }
    }
    if (lan && buoc !== 'DAT') st = `Làm lại lần ${lan + 1} · ` + st;
    return { bk, lks, a, aOk, aNg, bCan, bXong, bDu, demDu, demLech, ttDu, ttLech, cDu, cNg, decoCu, buoc, ktvTen, ttTen, qcTen, ttTrung, qcTrung,
        xongKTV, xongTT, xongQC, lan, tuLuc, st, cls, dat: buoc === 'DAT' };
}

// Điểm "cần xác nhận" còn mở liên quan tới 1 mã sản phẩm
function dmCxnCuaMa(ma, sp) {
    let vl = null;
    return Object.entries(dmDeco.cxn || {}).filter(([, x]) => {
        if (!x || x.trang_thai === 'da_xu_ly') return false;
        if (x.ma_san_pham === ma) return true;
        if (x.ma_san_pham !== '(nhiều mã)' || !sp) return false;
        let m = /Mã vật liệu\s*(\S*)\s*đi với/.exec(x.noi_dung || '');
        if (!m) return false;
        if (!vl) { vl = {}; dmArr(sp.linh_kien).forEach(lk => dmArr(lk.buoc_in).forEach(b => { vl[String(b.ma_vat_lieu || '').trim()] = 1; })); }
        return !!vl[m[1].trim()];
    });
}
function dmSoPhieuMo() { return Object.values(dmPhieu || {}).filter(p => p && p.kl !== 'DAT').length; }
function dmDemCho() {
    let r = { KTV: 0, TT: 0, QC: 0, DAT: 0 };
    Object.values(dmPhieu || {}).forEach(p => { if (p && typeof p === 'object') r[dmBuoc(p)]++; });
    return r;
}
function dmSoCxnMo() { return Object.values(dmDeco.cxn || {}).filter(x => x && x.trang_thai !== 'da_xu_ly').length; }

// ===================== VẼ: PHIẾU ĐỔI MÃ =====================
function dmRender() {
    if (!dmDecoLoaded || !dmPhieuLoaded) return `<div class="in-empty">Đang tải danh mục deco và phiếu đổi mã…</div>`;
    if (dmMo && dmPhieu[dmMo]) return dmRenderPhieu(dmMo);
    if (dmMo && !dmPhieu[dmMo]) dmMo = null;
    if (dmXem === 'ls') return dmRenderLichSu();
    return dmRenderDs();
}

function dmRenderDs() {
    let nSp = Object.keys(dmDeco.sp).length;
    let html = `<div class="in-note">Mỗi lần <b>đổi mã hàng</b>: gọi phiếu theo mã → <b>A</b> chuẩn bị → <b>B</b> kỹ thuật viên tick từng bước in đã lắp → <b>đếm nét in</b> trên SP đầu (lệch là khóa) → <b>C</b> QC kiểm 5 SP đầu. Phiếu <b>luân chuyển</b>: ① KTV làm xong bấm chuyển → ② tổ trưởng tự đếm lại nét (tùy chọn, có thể bỏ qua) → ③ QC kiểm 5 SP đầu rồi thử băng keo, kết luận. Bắt buộc có <b>KTV và QC</b> (đủ 2/3 người) mới được chạy đại trà. Mỗi người tham gia nhập tên mình, các tên phải khác nhau; ai đã chuyển thì phần của người đó bị khóa. Phiếu dùng deco <b>bản mới nhất</b> trên phần mềm.</div>`;
    html += `<div class="in-head">
        <button type="button" class="in-subbtn ${dmXem === 'ds' ? 'active' : ''}" data-dmact="xem" data-v="ds">📋 Phiếu ngày ${inEsc(inDate())}</button>
        <button type="button" class="in-subbtn ${dmXem === 'ls' ? 'active' : ''}" data-dmact="xem" data-v="ls">🕘 Lịch sử đổi mã</button>
    </div>`;
    if (!nSp) {
        return html + `<div class="in-empty">Chưa có danh mục deco trên phần mềm. Vào mục <b>📚 Danh mục deco</b> để nạp file <code>danh_muc_buoc_in.json</code>.</div>`;
    }
    let opts = Object.values(dmDeco.sp).filter(Boolean).sort((a, b) => String(a.ma_san_pham).localeCompare(String(b.ma_san_pham)))
        .map(s => `<option value="${inEsc(s.ma_san_pham)}">${inEsc(s.ten_san_pham || '')}</option>`).join('');
    html += `<div class="in-panel mb-3"><div class="in-panel-h">➕ Lập phiếu đổi mã mới</div>
        <div class="d-flex flex-wrap gap-2 align-items-end">
            <label>Mã hàng (chọn hoặc quét mã)<input type="text" class="form-control form-control-sm in-w180" list="dmMaList" data-dmf="maMoi" value="${inEsc(dmMaMoi)}" placeholder="VD: W93952-900004" autocomplete="off"></label>
            <datalist id="dmMaList">${opts}</datalist>
            <label>Máy in số<input type="text" class="form-control form-control-sm in-w95" data-dmf="mayMoi" value="${inEsc(dmMayMoi)}" placeholder="VD: 3"></label>
            <button type="button" class="btn btn-sm btn-3d-primary px-3" data-dmact="tao">Tạo phiếu</button>
        </div>
        ${dmGoiYMa(dmMaMoi)}
    </div>`;
    let thuTu = { QC: 0, TT: 1, KTV: 2, DAT: 3 };
    let ds = Object.entries(dmPhieu || {}).filter(([, p]) => p && typeof p === 'object')
        .sort((a, b) => (thuTu[dmBuoc(a[1])] - thuTu[dmBuoc(b[1])]) || ((b[1].t || 0) - (a[1].t || 0)));
    if (!ds.length) return html + `<div class="in-empty">Ngày ${inEsc(inDate())} chưa có phiếu đổi mã nào.</div>`;
    let dc = dmDemCho();
    html += `<div class="d-flex flex-wrap gap-2 mb-2">
        <span class="dm-chip ${dc.KTV ? 'now' : ''}">⏳ Chờ kỹ thuật viên: <b>${dc.KTV}</b></span>
        <span class="dm-chip ${dc.TT ? 'now' : ''}">⏳ Chờ tổ trưởng đếm lại: <b>${dc.TT}</b></span>
        <span class="dm-chip ${dc.QC ? 'now' : ''}">⏳ Chờ QC: <b>${dc.QC}</b></span>
        <span class="dm-chip ok">✅ Đạt: <b>${dc.DAT}</b></span></div>`;
    html += `<div class="table-responsive"><table class="table table-bordered table-sm align-middle in-table"><thead><tr>
        <th>Giờ lập</th><th>Ca</th><th>Mã hàng</th><th class="text-start">Tên SP</th><th>Deco</th><th>Máy</th><th>Đang ở bước</th><th>Đã chờ</th><th></th></tr></thead><tbody>`;
    ds.forEach(([id, p]) => {
        let c = dmCalc(p);
        html += `<tr><td>${inEsc(p.taoLuc || '')}</td><td>${dmCaTen(p.ca)}</td><td class="fw-bold">${inEsc(p.ma)}</td>
            <td class="text-start small">${inEsc(p.ten || '')}</td><td>${inEsc(p.phienBan || '')}</td><td>${inEsc(p.may || '')}</td>
            <td><span class="in-status ${c.cls}">${inEsc(c.st)}</span></td><td class="small">${c.dat ? '' : dmPhut(c.tuLuc)}</td>
            <td><button type="button" class="btn btn-sm btn-3d-primary px-2" data-dmact="mo" data-v="${id}">Mở</button></td></tr>`;
    });
    return html + `</tbody></table></div>`;
}
function dmGoiYMa(ma) {
    ma = String(ma || '').trim();
    if (!ma) return '';
    let sp = dmDeco.sp[dmKey(ma)];
    if (!sp) {
        let goi = Object.values(dmDeco.sp).filter(s => s && String(s.ma_san_pham).toLowerCase().includes(ma.toLowerCase())).slice(0, 6);
        return `<div class="small mt-2 text-warning">Không có mã "${inEsc(ma)}" trong danh mục.${goi.length ? ' Gần giống: ' + goi.map(s => `<b>${inEsc(s.ma_san_pham)}</b>`).join(', ') : ''}</div>`;
    }
    let cx = dmCxnCuaMa(sp.ma_san_pham, sp);
    let lks = dmArr(sp.linh_kien);
    return `<div class="small mt-2">📄 <b>${inEsc(sp.ten_san_pham || '')}</b> · deco bản <b>${inEsc(sp.phien_ban_deco || '?')}</b> (${inEsc(sp.ngay_lap || '')}) · ${lks.length} linh kiện · ${sp.tong_buoc_in || 0} bước in
        ${!sp.tong_buoc_in ? '<div class="in-alert mt-1">Mã này không có bước in (chỉ phun sơn) – không lập phiếu in.</div>' : ''}
        ${cx.length ? `<div class="in-alert warn mt-1">⚠️ Còn ${cx.length} điểm "cần xác nhận" chưa xử lý cho mã này – xem trong phiếu.</div>` : ''}</div>`;
}

// Thanh luân chuyển: ① KTV → ② Tổ trưởng → ③ QC → ĐẠT, tô rõ bước đang chờ
function dmThanhBuoc(p, c) {
    let ky = p.ky || {}, cur = c.buoc, thu = ['KTV', 'TT', 'QC', 'DAT'];
    let html = `<div class="dm-steps">`;
    DM_BUOC.forEach(([k, nhan, viec, kyK], n) => {
        let s = ky[kyK], xong = thu.indexOf(cur) > n, dang = cur === k, boQua = k === 'TT' && p.ttBoQua;
        let cls = boQua ? 'done skip' : xong ? 'done' : dang ? 'now' : 'wait';
        let truoc = n === 0 ? (p.lamLaiTs || p.t) : ((p.ky || {})[DM_BUOC[n - 1][3]] || {}).ts;
        let dong2 = boQua ? `⏭️ Đã bỏ qua lúc ${inEsc(p.ttBoQua.at || '')}${p.ttBoQua.tb ? `<br>📱 ${inEsc(p.ttBoQua.tb)}` : ''}`
            : xong && s ? `✍️ ${inEsc(s.ten || '')} · ${inEsc(s.at || '')}${s.tb ? `<br>📱 ${inEsc(s.tb)}` : ''}${truoc && s.ts ? `<br>⏱ làm trong ${dmPhutGiua(truoc, s.ts)}` : ''}`
            : dang ? `⏳ ĐANG CHỜ${c.tuLuc ? ` · ${dmPhut(c.tuLuc)}` : ''}` : 'Chưa tới lượt';
        html += `<div class="dm-step ${cls}"><div class="dm-step-t">${nhan}</div><div class="dm-step-v">${viec}</div><div class="dm-step-s">${dong2}</div></div>`;
        html += `<div class="dm-step-arrow">➜</div>`;
    });
    let me = dmThietBi();
    html += `<div class="dm-step ${cur === 'DAT' ? 'done ok' : 'wait'}"><div class="dm-step-t">✅ ĐẠT</div><div class="dm-step-v">Chạy đại trà</div><div class="dm-step-s">${cur === 'DAT' ? inEsc(p.klLuc || '') : ''}</div></div></div>
      <div class="dm-who mb-2">Máy bạn đang dùng: <b>📱 ${inEsc(me.ten)}</b> – mỗi bước phải làm trên một máy khác nhau.</div>`;
    return html;
}

function dmRenderPhieu(id) {
    let p = dmPhieu[id], c = dmCalc(p), ro = c.dat, buoc = c.buoc;
    let sp = dmDeco.sp[p.spKey], cx = dmCxnCuaMa(p.ma, sp);
    let lan = Object.entries(p.lan || {}).sort((a, b) => a[0] - b[0]);
    let suaKTV = buoc === 'KTV' && !c.decoCu;
    let html = `<div class="in-head">
        <button type="button" class="btn btn-sm btn-outline-info px-3" data-dmact="dong">← Danh sách phiếu</button>
        <span class="in-status ${c.cls}">${inEsc(c.st)}</span>
        ${buoc === 'KTV' && !Object.keys(p.b || {}).length && !lan.length ? `<button type="button" class="in-mini in-del ms-auto" data-dmact="xoa" data-v="${id}" title="Xóa phiếu">🗑 Xóa phiếu</button>` : ''}
    </div>
    <div class="in-card ${c.cls}">
      <div class="in-card-h">
        <div>
          <div class="fw-bold fs-6">BM-IN-01 · ${inEsc(p.ma)} – ${inEsc(p.ten || '')}</div>
          <div class="small opacity-75">Deco bản <b>${inEsc(p.phienBan || '?')}</b> · lập ${inEsc(p.ngayLapDeco || '')} · nguồn: ${inEsc(p.nguon || '')}</div>
          <div class="small opacity-75">Lập phiếu: ${inEsc(inDate())} ${inEsc(p.taoLuc || '')} · ${dmCaTen(p.ca)} · ${inEsc(p.taoBoi || '')}</div>
        </div>
        <div class="d-flex flex-wrap gap-2 align-items-end">
          <label>Máy in số<input type="text" class="form-control form-control-sm in-w80" data-dmp="may" value="${inEsc(p.may || '')}" ${suaKTV ? '' : 'disabled'}></label>
          <label>Lệnh SX / ghi chú<input type="text" class="form-control form-control-sm in-w180" data-dmp="lenh" value="${inEsc(p.lenh || '')}" ${ro ? 'disabled' : ''}></label>
        </div>
      </div>
      ${dmThanhBuoc(p, c)}`;
    if (c.decoCu) html += `<div class="in-alert mb-2">⛔ Deco của mã này trên phần mềm đã đổi sang bản <b>${inEsc(sp.phien_ban_deco || '?')}</b> (${sp.tong_buoc_in} bước). Phiếu này dùng bản ${inEsc(p.phienBan || '?')} – KHÔNG dùng tiếp, hãy lập phiếu mới.</div>`;
    if (cx.length && !ro) html += `<div class="in-alert warn mb-2">⚠️ Mã này còn ${cx.length} điểm deco "cần xác nhận" chưa xử lý – hỏi kỹ thuật trước khi chạy:<ul class="mb-0 mt-1 fw-normal">${cx.map(([, x]) => `<li>${x.ma_linh_kien ? `<b>${inEsc(x.ma_linh_kien)}</b>: ` : ''}${inEsc(x.noi_dung)}</li>`).join('')}</ul></div>`;
    if (lan.length) html += `<div class="in-alert warn mb-2">🔁 Đã KHÔNG ĐẠT ${lan.length} lần: ${lan.map(([n, l]) => `lần ${n} (${inEsc(l.boi || '')}, ${inEsc(l.at || '')}): ${inEsc(l.lyDo || '')}`).join(' · ')}</div>`;

    // ===== ① KỸ THUẬT VIÊN =====
    html += `<div class="dm-khoi ${buoc === 'KTV' ? 'now' : 'locked'}"><div class="dm-khoi-h">① KỸ THUẬT VIÊN – chuẩn bị, lắp đặt, đếm nét ${buoc !== 'KTV' && (p.ky || {}).ktv ? `<span class="dm-khoa">🔒 Đã chuyển – ${dmKyHtml(p.ky.ktv, 1)}</span>` : ''}</div>`;
    let gon = buoc !== 'KTV';
    if (gon) html += `<details class="dm-chitiet"><summary>Xem chi tiết phần kỹ thuật viên đã làm (A, ${c.bCan / DM_B.length} bước lắp đặt, số nét đếm)</summary>`;
    html += `<div class="d-flex flex-wrap gap-2 align-items-end mb-2"><label>Họ tên kỹ thuật viên<input type="text" class="form-control form-control-sm in-w180" data-dmp="ktv" value="${inEsc(p.ktv || '')}" placeholder="Nhập tên trước khi làm" ${suaKTV ? '' : 'disabled'}></label>${dmTenLucHtml(p, 'ktv')}</div>`;
    let lkAll = dmArr(p.lk);
    if (lkAll.length > 1) {
        html += `<div class="in-sec">LINH KIỆN IN LẦN NÀY <span class="opacity-75">(bỏ chọn linh kiện không chạy trên máy này)</span></div><div class="d-flex flex-wrap gap-3 mb-2">`;
        lkAll.forEach((lk, i) => {
            html += `<label class="d-flex align-items-center gap-1 small"><input type="checkbox" data-dmact="boLk" data-v="${i}" ${(p.boLk || {})[i] ? '' : 'checked'} ${suaKTV && !Object.keys(p.b || {}).length ? '' : 'disabled'}> <b>${inEsc(lk.ma)}</b> ${inEsc(lk.ten || '')} (${dmArr(lk.buoc).length} bước)</label>`;
        });
        html += `</div>`;
    }
    html += `<div class="in-sec mt-2">A. CHUẨN BỊ</div>${DM_A.map((t, i) => `<div class="in-check">${dmCyc(id, `a/${i}`, c.a[i], !suaKTV || !c.ktvTen)}<span>${i + 1}. ${t}</span></div>`).join('')}`;
    if (suaKTV && !c.ktvTen) html += `<div class="in-alert warn mt-1">Nhập họ tên kỹ thuật viên trước.</div>`;
    if (c.aNg) html += `<div class="in-alert mb-2">Chuẩn bị có mục ✗ – không lắp đặt cho đến khi xử lý xong.</div>`;
    c.lks.forEach(({ i, lk, t }) => { html += dmRenderLkKTV(id, p, c, i, lk, t, suaKTV); });
    if (buoc === 'KTV') {
        html += `<div class="dm-chuyen"><button type="button" class="btn btn-sm ${c.xongKTV ? 'btn-3d-emerald' : 'btn-outline-secondary'} px-3" data-dmact="xongKTV" ${c.xongKTV ? '' : 'disabled'}>✅ KTV hoàn thành – chuyển Tổ trưởng đếm lại</button>
          ${c.xongKTV ? '' : '<span class="small opacity-75">Mở khi: có tên KTV, A đủ 5 ✓, tick đủ mọi bước lắp đặt, số nét đếm khớp deco ở mọi linh kiện.</span>'}</div>`;
    }
    if (gon) html += `</details>`;
    html += `</div>`;

    // ===== ② TỔ TRƯỞNG =====
    let chan = dmChanMay(p);
    let suaTT = buoc === 'TT' && !c.decoCu && !chan;
    html += `<div class="dm-khoi ${buoc === 'TT' ? 'now' : buoc === 'KTV' ? 'wait' : 'locked'}"><div class="dm-khoi-h">② TỔ TRƯỞNG (tùy chọn) – đếm lại nét in độc lập ${p.ttBoQua ? `<span class="dm-khoa">⏭️ Đã bỏ qua lúc ${inEsc(p.ttBoQua.at || '')}</span>` : buoc !== 'TT' && (p.ky || {}).toTruong ? `<span class="dm-khoa">🔒 Đã chuyển – ${dmKyHtml(p.ky.toTruong, 1)}</span>` : ''}</div>`;
    if (buoc === 'KTV') html += `<div class="small opacity-75">Chờ kỹ thuật viên hoàn thành.</div>`;
    else if (p.ttBoQua) html += `<div class="small opacity-75">Đã bỏ qua bước này – chuyển thẳng sang QC.</div>`;
    else {
        if (buoc === 'TT' && chan) html += `<div class="in-alert mb-2">⛔ ${inEsc(chan)}</div>`;
        if (buoc === 'TT') html += `<div class="in-note py-1 px-2 mb-2">Bước này <b>không bắt buộc</b> – chỉ cần KTV và QC xác nhận là đủ (2/3) để chạy đại trà. Có thể bỏ qua nếu tổ trưởng không trực tiếp đếm lại.</div>`;
        html += `<div class="d-flex flex-wrap gap-2 align-items-end mb-2"><label>Họ tên tổ trưởng<input type="text" class="form-control form-control-sm in-w180 ${c.ttTrung ? 'in-bad' : ''}" data-dmp="toTruong" value="${inEsc(p.toTruong || '')}" placeholder="Khác tên KTV" ${suaTT ? '' : 'disabled'}></label>
            ${c.ttTrung ? '<span class="in-tag ng">Trùng tên KTV – phải là người khác</span>' : ''}${dmTenLucHtml(p, 'toTruong')}</div>
          <div class="small opacity-75 mb-1">Tự đếm số nét in trên sản phẩm đầu của từng linh kiện. Số của KTV và số theo deco được ẩn để đếm độc lập.</div>
          <table class="table table-bordered table-sm align-middle in-table mb-2" style="max-width:640px"><thead><tr><th class="text-start">Linh kiện</th><th>Tổ trưởng đếm</th><th>Kết quả</th>${buoc !== 'TT' ? '<th>KTV đếm</th><th>Deco</th>' : ''}</tr></thead><tbody>`;
        c.lks.forEach(({ i, lk, t }) => {
            html += `<tr><td class="text-start"><b>${inEsc(lk.ma)}</b> ${inEsc(lk.ten || '')}</td>
              <td><input type="number" inputmode="numeric" min="0" class="form-control form-control-sm in-w80 mx-auto ${t.ttLech ? 'in-bad' : t.ttDung ? 'in-good' : ''}" data-dmp="demTT/${i}" value="${t.demTT == null ? '' : t.demTT}" ${suaTT && c.ttTen && !c.ttTrung ? '' : 'disabled'}></td>
              <td>${t.ttDung ? '<span class="in-tag ok">KHỚP</span>' : t.ttLech ? '<span class="in-tag ng">KHÔNG KHỚP</span>' : '—'}</td>
              ${buoc !== 'TT' ? `<td>${t.dem == null ? '' : t.dem}</td><td>${t.net}</td>` : ''}</tr>`;
        });
        html += `</tbody></table>`;
        if (buoc === 'TT' && c.ttLech) html += `<div class="in-alert mb-2">⛔ Số tổ trưởng đếm KHÔNG khớp deco ở linh kiện tô đỏ. Kiểm tra lại sản phẩm; nếu thiếu nét thật thì bấm "Không đạt" để trả KTV làm lại.</div>`;
        if (buoc === 'TT') html += `<div class="dm-chuyen"><button type="button" class="btn btn-sm ${c.xongTT ? 'btn-3d-emerald' : 'btn-outline-secondary'} px-3" data-dmact="xongTT" ${c.xongTT && !chan ? '' : 'disabled'}>✅ Tổ trưởng xác nhận – chuyển QC</button>
            <button type="button" class="btn btn-sm btn-outline-secondary px-3" data-dmact="boQuaTT" ${chan ? 'disabled' : ''}>⏭️ Bỏ qua tổ trưởng – chuyển thẳng QC</button>
            ${c.xongTT ? '' : '<span class="small opacity-75">Xác nhận mở khi: có tên tổ trưởng (khác KTV) và số đếm khớp ở mọi linh kiện.</span>'}</div>`;
    }
    html += `</div>`;

    // ===== ③ QC =====
    let suaQC = buoc === 'QC' && !c.decoCu && !chan;
    html += `<div class="dm-khoi ${buoc === 'QC' ? 'now' : buoc === 'DAT' ? 'locked' : 'wait'}"><div class="dm-khoi-h">③ QC – kiểm 5 sản phẩm đầu & kết luận ${ro && (p.ky || {}).qc ? `<span class="dm-khoa">🔒 ${dmKyHtml(p.ky.qc, 1)}</span>` : ''}</div>`;
    if (buoc === 'KTV') html += `<div class="small opacity-75">Chờ kỹ thuật viên hoàn thành.</div>`;
    else if (buoc === 'TT') html += `<div class="small opacity-75">Chờ tổ trưởng đếm lại hoặc bỏ qua.</div>`;
    else {
        if (buoc === 'QC' && chan) html += `<div class="in-alert mb-2">⛔ ${inEsc(chan)}</div>`;
        html += `<div class="d-flex flex-wrap gap-2 align-items-end mb-2"><label>Họ tên QC<input type="text" class="form-control form-control-sm in-w180 ${c.qcTrung ? 'in-bad' : ''}" data-dmp="qcTen" value="${inEsc(p.qcTen || '')}" placeholder="Khác KTV và tổ trưởng" ${suaQC ? '' : 'disabled'}></label>
            ${c.qcTrung ? '<span class="in-tag ng">Trùng tên KTV / tổ trưởng – phải là người khác</span>' : ''}${dmTenLucHtml(p, 'qcTen')}</div>`;
        let moC = suaQC && c.qcTen && !c.qcTrung;
        c.lks.forEach(({ i, lk, t }) => { html += dmRenderLkQC(id, p, i, lk, t, !moC); });
        html += dmRenderBangKeo(p, c, !moC);
        if (buoc === 'QC') html += `<div class="dm-chuyen"><button type="button" class="btn btn-sm ${c.xongQC ? 'btn-3d-emerald' : 'btn-outline-secondary'} px-3" data-dmact="xongQC" ${c.xongQC && !chan ? '' : 'disabled'}>✅ QC kết luận ĐẠT – cho chạy đại trà</button>
            ${c.xongQC ? '' : `<span class="small opacity-75">Mở khi: có tên QC (khác người trước), tick đủ "SP đầu có nét", 5 SP đạt ${DM_C.length} mục và thử băng keo 5 mẫu không bong ở mọi linh kiện.</span>`}</div>`;
        if (ro) html += `<div class="alert alert-success py-2 mt-2 mb-0 fw-bold">✅ ĐẠT – được chạy đại trà lúc ${inEsc(p.klLuc || '')}. Bộ phận in chưa có lệnh trên phần mềm sản xuất, phiếu này là căn cứ ghi nhận.</div>`;
    }
    html += `</div>`;

    // ===== KHÔNG ĐẠT (tổ trưởng hoặc QC) =====
    if (buoc === 'TT' || buoc === 'QC') {
        html += `<div class="in-panel mt-2"><div class="in-panel-h">✗ KHÔNG ĐẠT → dừng, trả kỹ thuật viên làm lại từ bước lắp đặt</div>
            <div class="d-flex flex-wrap gap-2 align-items-end">
              <label class="flex-grow-1">Lý do không đạt / bước bị sót<input type="text" class="form-control form-control-sm" data-dmp="ngLyDo" value="${inEsc(p.ngLyDo || '')}" placeholder="VD: thiếu nét đuôi đèn trái – chưa lắp bản in"></label>
              <button type="button" class="btn btn-sm btn-3d-ruby px-3" data-dmact="khongDat" ${chan ? 'disabled' : ''}>✗ Không đạt – trả KTV</button>
            </div>
            <div class="small opacity-75 mt-1">Phần lắp đặt, số đếm, phần QC được xóa; phiếu quay về chờ kỹ thuật viên. Lần không đạt được lưu trong lịch sử phiếu.</div></div>`;
    }
    html += `</div>`;
    return html;
}

function dmRenderLkKTV(id, p, c, i, lk, t, sua) {
    let khoaB = !sua || !c.aOk || !c.ktvTen;
    let pre = `b/${i}`;
    let html = `<div class="in-panel mt-3">
      <div class="in-panel-h">🧩 ${inEsc(lk.ma)} – ${inEsc(lk.ten || '')} <span class="opacity-75 fw-normal">${inEsc(lk.ten_goc || '')}</span></div>
      <div class="small opacity-75 mb-2">Phôi đầu vào: <b>${inEsc(lk.phoi || '-')}</b> · Màu nền: ${inEsc(lk.mau_nen || '-')} · Vật liệu: ${inEsc(lk.vat_lieu || '-')}</div>
      <div class="in-sec">B. LẮP ĐẶT <span class="opacity-75">(tick từng bước: ${t.bXong}/${t.bCan})</span></div>
      ${sua && !c.aOk ? '<div class="in-alert warn mb-2">Hoàn thành mục A (đủ 5 ✓) trước khi lắp đặt.</div>' : ''}
      <div class="table-responsive"><table class="table table-bordered table-sm align-middle in-table dm-buoc mb-2"><thead><tr>
        <th>STT</th><th class="text-start">Vị trí in</th><th class="text-start">Màu</th><th>Mã mực</th><th>Máy / bản (deco)</th><th>Bản in</th>
        ${DM_B.map(([, n]) => `<th>${n}</th>`).join('')}<th>Mã jig</th><th class="text-start">Ghi chú deco</th></tr></thead><tbody>`;
    t.buoc.forEach((b, j) => {
        let tinh = dmTinh(b), bv = ((p.b || {})[i] || {})[j] || {}, luot = dmLuot(b);
        html += `<tr class="${tinh ? '' : 'dm-uv'}"><td class="fw-bold">${inEsc(b.stt)}${luot > 1 ? `<div><span class="in-tag ng">${luot} lượt</span></div>` : ''}</td>
          <td class="text-start">${inEsc(b.vi_tri || '')}<div class="small opacity-75">${inEsc(b.vi_tri_goc || '')}</div></td>
          <td class="text-start">${inEsc(b.mau || '')}<div class="small opacity-75">${inEsc(b.mau_goc || '')}</div></td>
          <td>${inEsc(b.ma_muc || '')}<div class="small opacity-75">${inEsc(b.ma_vat_lieu || '')}</div></td>
          <td>${inEsc(b.may_ban || '')}</td><td>${b.ban_in === 'MỚI' ? '<span class="in-tag ok">MỚI</span>' : inEsc(b.ban_in || '')}</td>`;
        if (!tinh) html += `<td colspan="${DM_B.length + 1}" class="small">In UV kỹ thuật số – không phải tampon, không tick (chờ xác nhận thuộc xưởng in hay không)</td>`;
        else {
            DM_B.forEach(([k, n]) => {
                let s = bv[k];
                html += `<td>${s && s.at ? `<button type="button" class="in-cyc ok dm-tick" data-dmact="tick" data-v="${pre}/${j}/${k}" title="${inEsc(n)} – bấm để bỏ" ${sua ? '' : 'disabled'}>✓</button><div class="dm-who">${dmKyHtml(s)}</div>`
                    : `<button type="button" class="in-cyc dm-tick" data-dmact="tick" data-v="${pre}/${j}/${k}" title="${inEsc(n)}" ${khoaB ? 'disabled' : ''}>·</button>`}</td>`;
            });
            html += `<td><input type="text" class="form-control form-control-sm in-w80" data-dmp="${pre}/${j}/jigMa" value="${inEsc(bv.jigMa || '')}" placeholder="ghi mã" ${sua ? '' : 'disabled'}></td>`;
        }
        html += `<td class="text-start small">${inEsc(b.ghi_chu || '')}${dmLa10k(b) ? '<div class="text-warning fw-bold">Bản in mã ngày / mã UV: thay sau ~10.000 cái</div>' : ''}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    let khoaDem = !sua || !t.bDu;
    html += `<div class="in-sec mt-2">ĐẾM NÉT IN TRÊN SẢN PHẨM ĐẦU (KTV)</div>
      <div class="d-flex flex-wrap gap-3 align-items-center mb-1">
        <span>Theo deco: <b class="fs-6">${t.net}</b> nét${t.tinh.some(([, b]) => dmLuot(b) > 1) ? ' <span class="small opacity-75">(đã tính số lượt in)</span>' : ''}</span>
        <label class="d-flex align-items-center gap-2">KTV đếm được <input type="number" inputmode="numeric" min="0" class="form-control form-control-sm in-w80 ${t.demLech ? 'in-bad' : t.demDung ? 'in-good' : ''}" data-dmp="dem/${i}" value="${t.dem == null ? '' : t.dem}" ${khoaDem ? 'disabled' : ''}></label>
        ${sua && !t.bDu ? '<span class="small opacity-75">Mở sau khi tick đủ bước B.</span>' : ''}
        ${t.demDung ? '<span class="in-tag ok">KHỚP DECO</span>' : ''}
      </div>
      ${t.demLech ? `<div class="in-alert mb-1">⛔ KHÓA: đếm ${t.dem} nét, deco có ${t.net} nét (lệch ${t.dem - t.net > 0 ? '+' : ''}${t.dem - t.net}). Tìm bước bị sót hoặc in thừa, sửa xong đếm lại.</div>` : ''}
    </div>`;
    return html;
}

function dmRenderBangKeo(p, c, khoa) {
    let bk = c.bk;
    let html = `<div class="in-panel mt-2"><div class="in-panel-h">🩹 THỬ BĂNG KEO <span class="opacity-75 fw-normal">(5 mẫu / linh kiện)</span></div>
      <table class="table table-bordered table-sm align-middle text-center in-table mb-1" style="max-width:640px"><thead><tr><th class="text-start">Linh kiện</th><th>Mẫu 1</th><th>Mẫu 2</th><th>Mẫu 3</th><th>Mẫu 4</th><th>Mẫu 5</th></tr></thead><tbody>
      ${c.lks.map(({ i, lk }) => `<tr><td class="text-start"><b>${inEsc(lk.ma)}</b> ${inEsc(lk.ten || '')}</td>${[0, 1, 2, 3, 4].map(si => {
          let v = ((p.bkKq || {})[i] || {})[si];
          return `<td><button type="button" class="in-cyc ${v === 'OK' ? 'ok' : v === 'NG' ? 'ng' : ''}" data-dmact="cyc" data-v="bkKq/${i}/${si}" title="Bấm: trống → ✓ không bong → ✗ bong" ${khoa ? 'disabled' : ''}>${v === 'OK' ? '✓' : v === 'NG' ? '✗' : '·'}</button></td>`;
      }).join('')}</tr>`).join('')}
      </tbody></table>
      <div class="small opacity-75">Cách thử: dán băng keo kín chỗ in, miết chặt, chờ 1 phút, giật mạnh. Không dính mực = ✓ không bong.</div>`;
    if (bk.ng) html += `<div class="in-alert mt-2">🟥 BĂNG KEO BONG: DỪNG MÁY, giữ hàng đã in → ghi lý do và bấm "Không đạt – trả KTV".</div>`;
    return html + `</div>`;
}
function dmRenderLkQC(id, p, i, lk, t, khoa) {
    return `<div class="in-panel mt-2">
      <div class="in-panel-h">🧩 ${inEsc(lk.ma)} – ${inEsc(lk.ten || '')}</div>
      <div class="row g-3"><div class="col-xl-5">
        <div class="small fw-bold mb-1">SP đầu CÓ nét in này (${t.coXong}/${t.tinh.length})</div>
        ${t.tinh.map(([j, b]) => {
            let on = ((((p.c || {})[i] || {}).co) || {})[j];
            return `<div class="in-check"><button type="button" class="in-cyc ${on ? 'ok' : ''}" data-dmact="co" data-v="c/${i}/co/${j}" ${khoa ? 'disabled' : ''}>${on ? '✓' : '·'}</button><span>${inEsc(b.stt)}. ${inEsc(b.vi_tri || '')} – ${inEsc(b.mau || '')}${dmLuot(b) > 1 ? ` (${dmLuot(b)} lượt)` : ''}</span></div>`;
        }).join('')}
      </div><div class="col-xl-7">
        <table class="table table-bordered table-sm align-middle text-center in-table mb-1"><thead><tr><th class="text-start">Hạng mục</th><th>SP 1</th><th>SP 2</th><th>SP 3</th><th>SP 4</th><th>SP 5</th></tr></thead><tbody>
        ${DM_C.map((n, ci) => `<tr><td class="text-start">${ci + 1}. ${n}</td>${[0, 1, 2, 3, 4].map(si => dmTdCyc(id, p, `c/${i}/kq/${ci}/${si}`, khoa)).join('')}</tr>`).join('')}
        </tbody></table>
        ${!khoa ? `<button type="button" class="in-mini" data-dmact="cAllOk" data-v="${i}">✓ Đánh đạt cả 5 SP</button>` : ''}
      </div></div>
    </div>`;
}

function dmCyc(id, rel, val, ro) {
    let cls = val === 'OK' ? 'ok' : val === 'NG' ? 'ng' : '';
    return `<button type="button" class="in-cyc ${cls}" data-dmact="cyc" data-v="${rel}" title="Bấm để đổi: trống → ✓ → ✗" ${ro ? 'disabled' : ''}>${val === 'OK' ? '✓' : val === 'NG' ? '✗' : '·'}</button>`;
}
function dmTdCyc(id, p, rel, ro) { return `<td>${dmCyc(id, rel, dmGet(p, rel), ro)}</td>`; }

// ===================== VẼ: LỊCH SỬ =====================
function dmRenderLichSu() {
    if (!dmLs.tu) { let d = new Date(inDate() + 'T00:00:00'); d.setDate(d.getDate() - 30); dmLs.tu = d.toISOString().slice(0, 10); }
    if (!dmLs.den) dmLs.den = inDate();
    let html = `<div class="in-head">
        <button type="button" class="in-subbtn" data-dmact="xem" data-v="ds">📋 Phiếu ngày ${inEsc(inDate())}</button>
        <button type="button" class="in-subbtn active" data-dmact="xem" data-v="ls">🕘 Lịch sử đổi mã</button></div>
      <div class="d-flex flex-wrap gap-2 align-items-end mb-2">
        <label>Từ ngày<input type="date" class="form-control form-control-sm" data-dmf="lsTu" value="${inEsc(dmLs.tu)}"></label>
        <label>Đến ngày<input type="date" class="form-control form-control-sm" data-dmf="lsDen" value="${inEsc(dmLs.den)}"></label>
        <button type="button" class="btn btn-sm btn-3d-primary px-3" data-dmact="lsTai">🔎 Xem</button>
        <label>Lọc mã / máy<input type="text" class="form-control form-control-sm in-w180" data-dmf="lsTim" value="${inEsc(dmLs.tim)}" placeholder="VD: W93952"></label>
        ${dmLs.rows && dmLs.rows.length ? `<button type="button" class="btn btn-sm btn-outline-info px-3" data-dmact="lsExcel">📊 Excel</button>` : ''}
      </div>`;
    if (dmLs.dangTai) return html + `<div class="in-empty">Đang tải…</div>`;
    if (!dmLs.rows) return html + `<div class="in-empty">Chọn khoảng ngày rồi bấm 🔎 Xem. Dùng để truy vết khi khách khiếu nại: tra mã hàng → xem lần đổi mã, ai lắp, ai kiểm, đếm bao nhiêu nét.</div>`;
    let q = dmLs.tim.trim().toLowerCase();
    let rows = dmLs.rows.filter(r => !q || String(r.p.ma).toLowerCase().includes(q) || String(r.p.may || '').toLowerCase() === q || String(r.p.ten || '').toLowerCase().includes(q));
    if (!rows.length) return html + `<div class="in-empty">Không có phiếu nào.</div>`;
    let dat = rows.filter(r => r.p.kl === 'DAT').length, lai = rows.reduce((s, r) => s + Object.keys(r.p.lan || {}).length, 0);
    html += `<div class="small mb-2">${rows.length} phiếu · <b class="text-success">${dat} đạt</b> · ${rows.length - dat} chưa xong · ${lai} lần không đạt phải làm lại</div>
      <div class="table-responsive"><table class="table table-bordered table-sm align-middle in-table"><thead><tr>
      <th>Ngày</th><th>Giờ</th><th>Ca</th><th>Mã hàng</th><th class="text-start">Tên SP</th><th>Deco</th><th>Máy</th><th>Nét deco / KTV / TT</th><th>Làm lại</th><th>Kết quả</th><th class="text-start">Người ký</th><th></th></tr></thead><tbody>`;
    rows.forEach(r => {
        let p = r.p, c = dmCalc(p);
        let net = c.lks.map(x => `${x.t.net}/${x.t.dem == null ? '–' : x.t.dem}/${x.t.demTT == null ? '–' : x.t.demTT}`).join(', ');
        let ky = DM_KY.map(([k, n]) => (p.ky || {})[k] ? `${n}: ${inEsc((p.ky[k].ten || p.ky[k].acc || ''))}` : '').filter(Boolean).join('<br>');
        html += `<tr><td>${inEsc(r.d)}</td><td>${inEsc(p.taoLuc || '')}</td><td>${dmCaTen(p.ca)}</td><td class="fw-bold">${inEsc(p.ma)}</td>
          <td class="text-start small">${inEsc(p.ten || '')}</td><td>${inEsc(p.phienBan || '')}</td><td>${inEsc(p.may || '')}</td><td>${net}</td>
          <td>${Object.keys(p.lan || {}).length || ''}</td><td><span class="in-status ${c.cls}">${inEsc(c.st)}</span></td><td class="text-start small">${ky}</td>
          <td><button type="button" class="btn btn-sm btn-3d-primary px-2" data-dmact="moLs" data-v="${inEsc(r.d)}|${r.id}">Mở</button></td></tr>`;
    });
    return html + `</tbody></table></div>`;
}
async function dmTaiLichSu() {
    if (typeof db === 'undefined' || !db) return;
    if (dmLs.tu > dmLs.den) { inToast('Ngày bắt đầu phải trước ngày kết thúc.', true); return; }
    dmLs.dangTai = true; renderTabIn();
    try {
        let snap = await db.ref(DM_PHIEU).orderByKey().startAt(dmLs.tu).endAt(dmLs.den).once('value');
        let v = snap.val() || {}, rows = [];
        Object.keys(v).forEach(d => Object.entries(v[d] || {}).forEach(([id, p]) => { if (p && typeof p === 'object') rows.push({ d, id, p }); }));
        rows.sort((a, b) => (b.p.t || 0) - (a.p.t || 0));
        dmLs.rows = rows;
    } catch (e) { inToast('⚠️ Không tải được lịch sử: ' + (e.code || e.message), true); }
    dmLs.dangTai = false; renderTabIn();
}
function dmXuatExcelLs() {
    if (typeof XLSX === 'undefined' || !dmLs.rows) return;
    let q = dmLs.tim.trim().toLowerCase();
    let rows = dmLs.rows.filter(r => !q || String(r.p.ma).toLowerCase().includes(q) || String(r.p.may || '').toLowerCase() === q || String(r.p.ten || '').toLowerCase().includes(q));
    let s1 = [['Ngày', 'Giờ lập', 'Ca', 'Mã hàng', 'Tên SP', 'Deco bản', 'Máy in', 'Lệnh SX', 'Linh kiện', 'Nét theo deco', 'KTV đếm', 'Tổ trưởng đếm', 'Số lần không đạt', 'Lý do không đạt', 'Kết quả', 'Giờ đạt', 'KTV chuyển', 'KTV máy', 'Tổ trưởng chuyển', 'Tổ trưởng máy', 'Tổ trưởng làm trong', 'QC kết luận', 'QC máy', 'QC làm trong', 'Băng keo kết quả']];
    let s2 = [['Ngày', 'Mã hàng', 'Máy in', 'Linh kiện', 'STT', 'Vị trí', 'Vị trí (gốc)', 'Màu', 'Màu (gốc)', 'Mã mực', 'Số lượt', 'Bản in đã lắp', 'Mực đúng mã', 'Jig đúng', 'Mã jig', 'SP đầu có nét']];
    rows.forEach(({ d, p }) => {
        let c = dmCalc(p), K = p.ky || {};
        let kyT = k => K[k] ? `${K[k].ten || K[k].acc} ${K[k].at}` : (k === 'toTruong' && p.ttBoQua ? '(bỏ qua)' : '');
        let may = k => (K[k] || {}).tb || (k === 'toTruong' && p.ttBoQua ? p.ttBoQua.tb || '' : '');
        s1.push([d, p.taoLuc || '', p.ca === 'DEM' ? 'Đêm' : 'Ngày', p.ma, p.ten || '', p.phienBan || '', p.may || '', p.lenh || '',
            c.lks.map(x => x.lk.ma).join(', '), c.lks.map(x => x.t.net).join(', '), c.lks.map(x => x.t.dem == null ? '' : x.t.dem).join(', '), c.lks.map(x => x.t.demTT == null ? '' : x.t.demTT).join(', '),
            Object.keys(p.lan || {}).length, Object.values(p.lan || {}).map(l => `${l.boi || l.by || ''}: ${l.lyDo}`).join(' | '), c.st, p.klLuc || '', kyT('ktv'), may('ktv'), kyT('toTruong'), may('toTruong'), dmPhutGiua((K.ktv || {}).ts, (K.toTruong || p.ttBoQua || {}).ts), kyT('qc'), may('qc'), dmPhutGiua((K.toTruong || p.ttBoQua || {}).ts, (K.qc || {}).ts),
            c.bk.ng ? 'BONG' : c.bk.du ? 'Không bong' : '']);
        c.lks.forEach(({ i, lk, t }) => t.buoc.forEach((b, j) => {
            let bv = ((p.b || {})[i] || {})[j] || {}, tk = k => bv[k] && bv[k].at ? `${bv[k].ten} ${bv[k].at}` : '';
            s2.push([d, p.ma, p.may || '', lk.ma, b.stt, b.vi_tri || '', b.vi_tri_goc || '', b.mau || '', b.mau_goc || '', b.ma_muc || '', dmLuot(b),
                dmTinh(b) ? tk('ban') : 'In UV', dmTinh(b) ? tk('muc') : '', dmTinh(b) ? tk('jig') : '', bv.jigMa || '', ((((p.c || {})[i] || {}).co) || {})[j] ? '✓' : '']);
        }));
    });
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), 'Phieu doi ma');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), 'Chi tiet buoc in');
    XLSX.writeFile(wb, `BM-IN-01_Doi_ma_${dmLs.tu}_${dmLs.den}.xlsx`);
}

// ===================== VẼ: DANH MỤC DECO =====================
function dmRenderDeco() {
    if (!dmDecoLoaded) return `<div class="in-empty">Đang tải danh mục deco…</div>`;
    let sps = Object.entries(dmDeco.sp || {}).filter(([, s]) => s);
    let m = dmDeco.meta, quyen = dmCoQuyenNap();
    let html = `<div class="in-note">Danh mục bước in theo deco (BM-IN-01). Phiếu đổi mã luôn lấy deco <b>bản mới nhất</b> ở đây. Khi có deco mới: cập nhật file <code>danh_muc_buoc_in.json</code> rồi nạp lại – mã nào đổi bản thì phiếu đang làm dở của mã đó sẽ bị chặn.</div>
      <div class="in-head">
        <span class="small">${m ? `📦 ${m.soSp} mã · ${m.soBuoc} bước in · nạp ${inEsc(m.napLuc || '')} bởi ${inEsc(m.napBoi || '')} · file ${inEsc(m.nguon || '')}` : 'Chưa nạp danh mục.'}</span>
        ${quyen ? `<label class="btn btn-sm btn-3d-primary px-3 ms-auto mb-0">📥 Nạp danh mục (file JSON)<input type="file" id="dmFile" accept=".json,application/json" hidden></label>`
            : '<span class="small opacity-75 ms-auto">Chỉ Admin được nạp danh mục.</span>'}
      </div>`;
    // Cần xác nhận
    let cxn = Object.entries(dmDeco.cxn || {}).filter(([, x]) => x).sort((a, b) => String(a[1].ma_san_pham).localeCompare(String(b[1].ma_san_pham)));
    let mo = cxn.filter(([, x]) => x.trang_thai !== 'da_xu_ly');
    let hien = dmCxnLoc === 'chua' ? mo : cxn;
    html += `<div class="in-panel mb-3"><div class="in-panel-h d-flex flex-wrap gap-2 align-items-center">⚠️ Điểm deco cần kỹ thuật xác nhận: ${mo.length} chưa xử lý / ${cxn.length}
        <button type="button" class="in-subbtn ${dmCxnLoc === 'chua' ? 'active' : ''} ms-auto" data-dmact="cxnLoc" data-v="chua">Chưa xử lý</button>
        <button type="button" class="in-subbtn ${dmCxnLoc === 'all' ? 'active' : ''}" data-dmact="cxnLoc" data-v="all">Tất cả</button></div>`;
    if (!hien.length) html += `<div class="small opacity-75">Không có điểm nào.</div>`;
    else {
        html += `<div class="table-responsive" style="max-height:420px;overflow:auto"><table class="table table-bordered table-sm align-middle in-table mb-0"><thead><tr><th>Mã SP</th><th>Linh kiện</th><th class="text-start">Nội dung</th><th class="text-start">Trả lời của kỹ thuật</th><th>Trạng thái</th></tr></thead><tbody>`;
        hien.forEach(([cid, x]) => {
            let xong = x.trang_thai === 'da_xu_ly';
            html += `<tr><td class="fw-bold">${inEsc(x.ma_san_pham)}</td><td>${inEsc(x.ma_linh_kien || '')}</td><td class="text-start small">${inEsc(x.noi_dung)}</td>
              <td><input type="text" class="form-control form-control-sm" data-dmcxn="${cid}" value="${inEsc(x.traLoi || '')}" placeholder="Kỹ thuật trả lời…"></td>
              <td>${xong ? `<span class="in-tag ok">ĐÃ XỬ LÝ</span><div class="dm-who">${inEsc(x.xuLyBoi || '')} ${inEsc(x.xuLyLuc || '')}</div><button type="button" class="in-mini mt-1" data-dmact="cxnMo" data-v="${cid}">Mở lại</button>`
                    : `<button type="button" class="btn btn-sm btn-3d-emerald px-2" data-dmact="cxnXong" data-v="${cid}">✓ Đã xử lý</button>`}</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }
    html += `</div>`;
    if (!sps.length) return html + `<div class="in-empty">Chưa có sản phẩm nào trong danh mục.</div>`;
    // Danh sách mã
    let q = dmDecoTim.trim().toLowerCase();
    let ds = sps.map(([k, s]) => s).filter(s => !q || String(s.ma_san_pham).toLowerCase().includes(q) || String(s.ten_san_pham || '').toLowerCase().includes(q))
        .sort((a, b) => String(a.ma_san_pham).localeCompare(String(b.ma_san_pham)));
    html += `<div class="d-flex flex-wrap gap-2 align-items-end mb-2"><label>Tìm mã / tên<input type="text" class="form-control form-control-sm in-w180" data-dmf="decoTim" value="${inEsc(dmDecoTim)}"></label><span class="small opacity-75">${ds.length} mã</span></div>
      <div class="row g-3"><div class="col-xl-5"><div class="table-responsive" style="max-height:640px;overflow:auto"><table class="table table-bordered table-sm align-middle in-table mb-0"><thead><tr><th>Mã SP</th><th class="text-start">Tên</th><th>Bản</th><th>LK</th><th>Bước</th><th>⚠️</th></tr></thead><tbody>`;
    ds.forEach(s => {
        let n = dmCxnCuaMa(s.ma_san_pham, s).length, sel = dmDecoMa === dmKey(s.ma_san_pham);
        html += `<tr class="${sel ? 'table-active' : ''}" style="cursor:pointer" data-dmact="decoMa" data-v="${inEsc(dmKey(s.ma_san_pham))}"><td class="fw-bold">${inEsc(s.ma_san_pham)}</td><td class="text-start small">${inEsc(s.ten_san_pham || '')}</td>
          <td>${inEsc(s.phien_ban_deco || '')}</td><td>${dmArr(s.linh_kien).length}</td><td>${s.tong_buoc_in || 0}</td><td>${n ? `<span class="in-tag ng">${n}</span>` : ''}</td></tr>`;
    });
    html += `</tbody></table></div></div><div class="col-xl-7">`;
    let s = dmDeco.sp[dmDecoMa];
    if (!s) html += `<div class="in-empty">Bấm vào một mã để xem các bước in.</div>`;
    else {
        html += `<div class="fw-bold">${inEsc(s.ma_san_pham)} – ${inEsc(s.ten_san_pham || '')}</div>
          <div class="small opacity-75 mb-2">Deco bản ${inEsc(s.phien_ban_deco || '?')} · lập ${inEsc(s.ngay_lap || '')} · ${inEsc(s.nguon_file || '')}</div>`;
        if (!s.tong_buoc_in) html += `<div class="in-alert warn">Mã này không có bước in – không lập phiếu in.</div>`;
        dmArr(s.linh_kien).forEach(lk => {
            let buoc = dmArr(lk.buoc_in), net = buoc.filter(dmTinh).reduce((a, b) => a + dmLuot(b), 0);
            html += `<div class="in-sec mt-2">${inEsc(lk.ma_linh_kien)} – ${inEsc(lk.ten || '')} <span class="opacity-75">${inEsc(lk.ten_goc || '')} · ${buoc.length} bước · ${net} nét</span></div>
              <div class="table-responsive"><table class="table table-bordered table-sm align-middle in-table mb-1"><thead><tr><th>STT</th><th class="text-start">Vị trí</th><th class="text-start">Màu</th><th>Mã mực</th><th>Máy/bản</th><th>Bản in</th><th class="text-start">Ghi chú</th></tr></thead><tbody>
              ${buoc.map(b => `<tr class="${dmTinh(b) ? '' : 'dm-uv'}"><td>${inEsc(b.stt)}${dmLuot(b) > 1 ? ` <span class="in-tag ng">${dmLuot(b)} lượt</span>` : ''}</td><td class="text-start">${inEsc(b.vi_tri || '')}<div class="small opacity-75">${inEsc(b.vi_tri_goc || '')}</div></td>
                <td class="text-start">${inEsc(b.mau || '')}<div class="small opacity-75">${inEsc(b.mau_goc || '')}</div></td><td>${inEsc(b.ma_muc || '')}</td><td>${inEsc(b.may_ban || '')}</td><td>${inEsc(b.ban_in || '')}</td><td class="text-start small">${inEsc(b.ghi_chu || '')}</td></tr>`).join('')}
              </tbody></table></div>`;
        });
    }
    return html + `</div></div>`;
}

// ===================== NẠP DANH MỤC =====================
async function dmNapFile(file) {
    if (!file) return;
    if (!dmCoQuyenNap()) { inToast('Chỉ Admin được nạp danh mục.', true); return; }
    let J;
    try { J = JSON.parse(await file.text()); } catch (e) { inToast('File không phải JSON hợp lệ: ' + e.message, true); return; }
    let list = J && Array.isArray(J.san_pham) ? J.san_pham : null;
    if (!list || !list.length || !list.every(s => s && s.ma_san_pham && Array.isArray(s.linh_kien))) { inToast('File không đúng cấu trúc danh_muc_buoc_in.json (cần san_pham[].ma_san_pham, linh_kien[]).', true); return; }
    let sp = {}, trung = [];
    list.forEach(s => {
        let k = dmKey(s.ma_san_pham);
        if (sp[k]) trung.push(s.ma_san_pham);
        let tong = s.linh_kien.reduce((a, lk) => a + (lk.buoc_in || []).length, 0);
        sp[k] = Object.assign({}, s, { tong_buoc_in: tong });
    });
    if (trung.length) { inToast('File có mã trùng: ' + trung.join(', '), true); return; }
    let cu = dmDeco.sp || {}, moi = [], doiBan = [], bo = [];
    Object.keys(sp).forEach(k => { if (!cu[k]) moi.push(sp[k].ma_san_pham); else if (dmSig(cu[k]) !== dmSig(sp[k])) doiBan.push(`${sp[k].ma_san_pham} (${cu[k].phien_ban_deco}→${sp[k].phien_ban_deco})`); });
    Object.keys(cu).forEach(k => { if (!sp[k]) bo.push(cu[k].ma_san_pham); });
    let soBuoc = Object.values(sp).reduce((a, s) => a + s.tong_buoc_in, 0);
    let cxnMoi = {}, cxnCu = dmDeco.cxn || {}, nCxnMoi = 0;
    (J.can_xac_nhan || []).forEach(x => {
        if (!x || !x.noi_dung) return;
        let id = dmHash(`${x.ma_san_pham}|${x.ma_linh_kien || ''}|${x.noi_dung}`);
        if (cxnCu[id]) cxnMoi[id] = cxnCu[id];
        else { cxnMoi[id] = { ma_san_pham: x.ma_san_pham || '', ma_linh_kien: x.ma_linh_kien || '', noi_dung: x.noi_dung, trang_thai: x.trang_thai === 'da_xu_ly' ? 'da_xu_ly' : 'chua_xu_ly' }; nCxnMoi++; }
    });
    // Giữ các điểm đã có trên phần mềm nhưng không còn trong file (đã xử lý hoặc nhập tay) để không mất lịch sử
    Object.keys(cxnCu).forEach(id => { if (!cxnMoi[id]) cxnMoi[id] = cxnCu[id]; });
    let tom = `Nạp danh mục từ "${file.name}":\n• ${Object.keys(sp).length} mã, ${soBuoc} bước in\n• Mã mới: ${moi.length}${moi.length && moi.length <= 10 ? ' (' + moi.join(', ') + ')' : ''}\n• Mã đổi bản deco: ${doiBan.length}${doiBan.length ? ' (' + doiBan.slice(0, 10).join(', ') + ')' : ''}\n• Mã không còn trong file (sẽ gỡ): ${bo.length}${bo.length ? ' (' + bo.slice(0, 10).join(', ') + ')' : ''}\n• Điểm cần xác nhận mới: ${nCxnMoi}\n\nTiếp tục?`;
    if (!confirm(tom)) return;
    let now = new Date(), at = `${now.toISOString().slice(0, 10)} ${inNowHM()}`;
    let meta = { napLuc: at, napBoi: inUser(), nguon: file.name, soSp: Object.keys(sp).length, soBuoc };
    try {
        await db.ref(DM_DECO).update({ sp, cxn: cxnMoi, meta, [`lichSuNap/${now.getTime()}`]: { at, by: inUser(), nguon: file.name, soSp: meta.soSp, soBuoc, moi: moi.join(', '), doiBan: doiBan.join(', '), bo: bo.join(', ') } });
        inToast(`✅ Đã nạp ${meta.soSp} mã, ${soBuoc} bước in.`);
    } catch (e) { inToast('⚠️ Không nạp được: ' + (e.code || e.message), true); }
}

// ===================== THAO TÁC =====================
function dmTaoPhieu() {
    if (!checkAuthOrAlert()) return;
    let fMa = document.querySelector('[data-dmf="maMoi"]'), fMay = document.querySelector('[data-dmf="mayMoi"]');
    if (fMa) dmMaMoi = fMa.value; if (fMay) dmMayMoi = fMay.value;
    let ma = dmMaMoi.trim(), sp = dmDeco.sp[dmKey(ma)];
    if (!sp) { inToast(`Không có mã "${ma}" trong danh mục deco.`, true); return; }
    if (!sp.tong_buoc_in) { inToast('Mã này không có bước in (chỉ phun sơn) – không lập phiếu in.', true); return; }
    let id = inId(), t = Date.now();
    let lk = dmArr(sp.linh_kien).map(l => ({
        ma: l.ma_linh_kien || '', ten: l.ten || '', ten_goc: l.ten_goc || '', phoi: l.phoi_dau_vao || '', mau_nen: l.mau_nen || '', vat_lieu: l.vat_lieu || '',
        buoc: dmArr(l.buoc_in).map(b => ({
            stt: b.stt, vi_tri: b.vi_tri || '', vi_tri_goc: b.vi_tri_goc || '', mau: b.mau || '', mau_goc: b.mau_goc || '', ma_muc: b.ma_muc || '',
            ma_vat_lieu: b.ma_vat_lieu || '', may_ban: b.may_ban || '', ban_in: b.ban_in || '', ghi_chu: b.ghi_chu || '', dong: b.dong_trong_deco || ''
        }))
    }));
    let p = {
        t, ca: inShift(), ma: sp.ma_san_pham, spKey: dmKey(sp.ma_san_pham), ten: sp.ten_san_pham || '', phienBan: sp.phien_ban_deco || '',
        ngayLapDeco: sp.ngay_lap || '', nguon: sp.nguon_file || '', decoSig: dmSig(sp), may: dmMayMoi.trim(), taoLuc: inNowHM(), taoBoi: inUser(), lk
    };
    dmPhieu[id] = JSON.parse(JSON.stringify(p));
    db.ref(`${DM_PHIEU}/${inDate()}/${id}`).set(p).catch(err => inToast('⚠️ Không lưu được phiếu: ' + (err.message || err), true));
    dmMo = id; dmMaMoi = ''; dmMayMoi = '';
}

// Trường nào được sửa ở bước nào (người đã chuyển bước thì phần của mình bị khóa)
function dmDuocSua(p, rel) {
    let b = dmBuoc(p);
    if (b === 'DAT' || dmDecoCu(p)) return false;
    if ((b === 'TT' || b === 'QC') && !/^lenh$/.test(rel) && dmChanMay(p)) return false;
    if (/^lenh$/.test(rel)) return true;
    if (/^(ktv|may|a|b|dem|boLk)(\/|$)/.test(rel)) return b === 'KTV';
    if (/^(toTruong|demTT)(\/|$)/.test(rel)) return b === 'TT';
    if (/^(qcTen|c|bk|bkKq)(\/|$)/.test(rel)) return b === 'QC';
    if (/^ngLyDo$/.test(rel)) return b === 'TT' || b === 'QC';
    return false;
}
function dmOnClick(e) {
    let b = e.target.closest('[data-dmact]');
    let root = document.getElementById('inRoot');
    if (!b || !root || !root.contains(b)) return;
    if (b.tagName === 'INPUT') return;   // checkbox linh kiện: xử lý ở sự kiện change
    let act = b.dataset.dmact, v = b.dataset.v;
    if (!checkAuthOrAlert()) return;
    let p = dmMo ? dmPhieu[dmMo] : null;
    const khong = msg => { inToast(msg, true); };
    switch (act) {
        case 'xem': dmXem = v; dmMo = null; break;
        case 'tao': dmTaoPhieu(); break;
        case 'mo': dmMo = v; break;
        case 'dong': dmMo = null; break;
        case 'xoa': if (confirm('Xóa phiếu đổi mã này?')) { db.ref(`${DM_PHIEU}/${inDate()}/${v}`).remove(); delete dmPhieu[v]; dmMo = null; } break;
        case 'moLs': {
            let [d, id] = v.split('|');
            let el = document.getElementById('inDate');
            if (el && el.value !== d) { el.value = d; onInDateShiftChange(); }
            dmSubscribe(); dmMo = id; dmXem = 'ds'; break;
        }
        case 'lsTai': dmTaiLichSu(); return;
        case 'lsExcel': dmXuatExcelLs(); return;
        case 'cyc': {
            if (!p || !dmDuocSua(p, v)) return khong(dmChanMay(p) || 'Phần này đã khóa hoặc chưa tới lượt.');
            if (/^a\//.test(v) && !String(p.ktv || '').trim()) return khong('Nhập họ tên kỹ thuật viên trước.');
            if (/^(c|bkKq)\//.test(v) && (!String(p.qcTen || '').trim() || dmCalc(p).qcTrung)) return khong('Nhập họ tên QC (khác KTV và tổ trưởng) trước.');
            let cur = dmGet(p, v);
            dmWrite(dmMo, v, !cur ? 'OK' : cur === 'OK' ? 'NG' : null); break;
        }
        case 'tick': {
            if (!p || !dmDuocSua(p, v)) return khong('Phần lắp đặt đã khóa hoặc chưa tới lượt.');
            let cur = dmGet(p, v);
            if (cur && cur.at) { dmWrite(dmMo, v, null); break; }
            if (!dmCalc(p).aOk) return khong('Hoàn thành mục A trước khi lắp đặt.');
            if (!String(p.ktv || '').trim()) return khong('Nhập họ tên kỹ thuật viên trước khi tick.');
            dmWrite(dmMo, v, dmStamp(p.ktv.trim())); break;
        }
        case 'co': {
            if (!p || !dmDuocSua(p, v)) return khong(dmChanMay(p) || 'Phần QC đã khóa hoặc chưa tới lượt.');
            if (!String(p.qcTen || '').trim() || dmCalc(p).qcTrung) return khong('Nhập họ tên QC (khác KTV và tổ trưởng) trước.');
            dmWrite(dmMo, v, dmGet(p, v) ? null : true); break;
        }
        case 'cAllOk': {
            if (!p || !dmDuocSua(p, `c/${v}`)) return;
            let kq = {}; DM_C.forEach((_, ci) => { kq[ci] = { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'OK', 4: 'OK' }; });
            dmWrite(dmMo, `c/${v}/kq`, kq); break;
        }
        case 'xongKTV': {
            if (!p || dmBuoc(p) !== 'KTV') return;
            let c = dmCalc(p); if (!c.xongKTV) return khong('Chưa đủ điều kiện hoàn thành.');
            if (!confirm(`${c.ktvTen}: xác nhận đã lắp đặt đủ ${c.bCan / DM_B.length} bước và đếm nét khớp deco?\nSau khi chuyển, phần của KTV bị khóa.`)) return;
            dmWrite(dmMo, 'ky/ktv', dmStamp(c.ktvTen)); dmWrite(dmMo, 'buoc', 'TT');
            inToast('➜ Đã chuyển – chờ TỔ TRƯỞNG đếm lại nét in.'); break;
        }
        case 'xongTT': {
            if (!p || dmBuoc(p) !== 'TT') return;
            if (dmChanMay(p)) return khong(dmChanMay(p));
            let c = dmCalc(p); if (!c.xongTT) return khong('Chưa đủ điều kiện xác nhận.');
            if (!confirm(`${c.ttTen}: xác nhận đã tự đếm lại và khớp deco?\nSau khi chuyển, phần của tổ trưởng bị khóa.`)) return;
            dmWrite(dmMo, 'ky/toTruong', dmStamp(c.ttTen)); dmWrite(dmMo, 'buoc', 'QC');
            inToast('➜ Đã chuyển – chờ QC kiểm 5 sản phẩm đầu.'); break;
        }
        case 'boQuaTT': {
            if (!p || dmBuoc(p) !== 'TT') return;
            if (!confirm('Bỏ qua bước Tổ trưởng đếm lại – chuyển thẳng sang QC kiểm tra?\nChỉ cần KTV và QC xác nhận (2/3) là đủ để chạy đại trà.')) return;
            dmWrite(dmMo, 'ttBoQua', dmStamp('(bỏ qua)')); dmWrite(dmMo, 'buoc', 'QC');
            inToast('⏭️ Đã bỏ qua Tổ trưởng – chờ QC kiểm 5 sản phẩm đầu.'); break;
        }
        case 'xongQC': {
            if (!p || dmBuoc(p) !== 'QC') return;
            if (dmChanMay(p)) return khong(dmChanMay(p));
            let c = dmCalc(p); if (!c.xongQC) return khong('Chưa đủ điều kiện kết luận.');
            if (!confirm(`${c.qcTen}: kết luận ĐẠT – cho chạy đại trà?`)) return;
            dmWrite(dmMo, 'ky/qc', dmStamp(c.qcTen)); dmWrite(dmMo, 'kl', 'DAT'); dmWrite(dmMo, 'klLuc', dmGio()); dmWrite(dmMo, 'buoc', 'DAT');
            inToast('✅ ĐẠT – được chạy đại trà.'); break;
        }
        case 'khongDat': {
            if (!p) return;
            let bc = dmBuoc(p); if (bc !== 'TT' && bc !== 'QC') return;
            if (dmChanMay(p)) return khong(dmChanMay(p));
            let ly = String(p.ngLyDo || '').trim();
            if (!ly) return khong('Ghi lý do không đạt / bước bị sót trước.');
            let nguoi = bc === 'TT' ? String(p.toTruong || '').trim() : String(p.qcTen || '').trim();
            if (!nguoi) return khong(`Nhập họ tên ${bc === 'TT' ? 'tổ trưởng' : 'QC'} trước.`);
            if (!confirm('Xác nhận KHÔNG ĐẠT: dừng máy, trả kỹ thuật viên làm lại từ bước lắp đặt?')) return;
            let n = Object.keys(p.lan || {}).length + 1;
            dmWrite(dmMo, `lan/${n}`, { lyDo: ly, buoc: bc, boi: nguoi, acc: inUser(), at: dmGio(), ts: Date.now(), dev: dmThietBi().id, tb: dmThietBi().ten, ktv: p.ktv || '', ky: p.ky || null, b: p.b || null, dem: p.dem || null, demTT: p.demTT || null, c: p.c || null, bk: p.bk || null, bkKq: p.bkKq || null, p5Id: p.p5Id || null });
            ['b', 'dem', 'demTT', 'demLuc', 'demTTLuc', 'c', 'bk', 'bkKq', 'p5Id', 'ky', 'kl', 'ngLyDo'].forEach(k => dmWrite(dmMo, k, null));
            dmWrite(dmMo, 'buoc', 'KTV'); dmWrite(dmMo, 'lamLaiTs', Date.now());
            inToast(`Đã ghi KHÔNG ĐẠT lần ${n} – phiếu quay về chờ KTV lắp đặt lại.`, true);
            break;
        }
        case 'cxnLoc': dmCxnLoc = v; break;
        case 'cxnXong': {
            let inp = document.querySelector(`[data-dmcxn="${CSS.escape(v)}"]`);
            let tl = inp ? inp.value.trim() : '';
            if (!tl) return khong('Ghi câu trả lời của kỹ thuật trước khi đánh dấu đã xử lý.');
            db.ref(`${DM_DECO}/cxn/${v}`).update({ traLoi: tl, trang_thai: 'da_xu_ly', xuLyBoi: inUser(), xuLyLuc: `${getTodayISO()} ${inNowHM()}` });
            break;
        }
        case 'cxnMo': db.ref(`${DM_DECO}/cxn/${v}`).update({ trang_thai: 'chua_xu_ly' }); break;
        case 'decoMa': dmDecoMa = v; break;
        default: return;
    }
    renderTabIn();
}

function dmOnChange(e) {
    let el = e.target, root = document.getElementById('inRoot');
    if (!root || !root.contains(el)) return;
    if (el.id === 'dmFile') { let f = el.files && el.files[0]; el.value = ''; dmNapFile(f); return; }
    if (el.dataset.dmact === 'boLk') {
        let p = dmMo && dmPhieu[dmMo];
        if (!p || !checkAuthOrAlert()) return;
        let rel = `boLk/${el.dataset.v}`;
        if (!dmDuocSua(p, rel)) { renderTabIn(); return; }
        dmWrite(dmMo, rel, el.checked ? null : true); renderTabIn(); return;
    }
    if (el.dataset.dmcxn) { db.ref(`${DM_DECO}/cxn/${el.dataset.dmcxn}/traLoi`).set(el.value.trim() || null); return; }
    let rel = el.dataset.dmp;
    if (rel && dmMo && dmPhieu[dmMo]) {
        if (!checkAuthOrAlert()) return;
        let p = dmPhieu[dmMo];
        if (!dmDuocSua(p, rel)) { inToast(dmChanMay(p) || 'Phần này đã khóa hoặc chưa tới lượt.', true); renderTabIn(); return; }
        let val = el.value.trim();
        if (/^(dem|demTT)\//.test(rel)) val = dmNum(val);
        if (dmGet(p, rel) === (val === '' ? undefined : val)) return;
        dmWrite(dmMo, rel, val === null ? null : val);
        if (['ktv', 'toTruong', 'qcTen'].includes(rel)) dmWrite(dmMo, `tenLuc/${rel}`, val ? dmStamp(val) : null);
        let md = /^(dem|demTT)\/(\d+)$/.exec(rel);
        if (md) dmWrite(dmMo, `${md[1]}Luc/${md[2]}`, val == null ? null : dmStamp(md[1] === 'dem' ? p.ktv : p.toTruong));
        dmVeSau(); return;
    }
    let f = el.dataset.dmf;
    if (f) {
        if (f === 'maMoi') dmMaMoi = el.value; else if (f === 'mayMoi') dmMayMoi = el.value;
        else if (f === 'lsTu') { dmLs.tu = el.value; } else if (f === 'lsDen') { dmLs.den = el.value; }
        dmVeSau();
    }
}

// Vẽ lại hơi trễ: để cú bấm nút ngay sau khi rời ô nhập vẫn ăn (không bị mất vì nút bị vẽ lại)
function dmVeSau() { clearTimeout(dmVeSau._t); dmVeSau._t = setTimeout(renderTabIn, 250); }
function dmOnInput(e) {
    let el = e.target, f = el.dataset && el.dataset.dmf;
    if (!f) return;
    if (f === 'decoTim') { dmDecoTim = el.value; renderTabIn(); }
    else if (f === 'lsTim') { dmLs.tim = el.value; renderTabIn(); }
    else if (f === 'maMoi') { dmMaMoi = el.value; }
    else if (f === 'mayMoi') { dmMayMoi = el.value; }
}

document.addEventListener('DOMContentLoaded', () => {
    let root = document.getElementById('inRoot');
    if (!root) return;
    root.addEventListener('click', dmOnClick);
    root.addEventListener('change', dmOnChange);
    root.addEventListener('input', dmOnInput);
});
