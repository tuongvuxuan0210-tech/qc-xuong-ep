/**
 * QC System - Tab 6: ĐIỀU KIỆN ÉP + NHẮC VIỆC ZALO
 * Xưởng Ép Nhựa Hải Tân
 *
 * 1) Bản điều kiện ép CHUẨN theo từng MÃ KHUÔN + MÁY (theo mẫu "Bảng điều kiện đúc nhựa – máy Haitian").
 *    Firebase: qc_dk_ep_chuan_v1/{mã khuôn}/{M<số máy>}
 * 2) QC xác nhận điều kiện ĐẦU CA và khi ĐỔI KHUÔN: nhập giá trị thực tế, phần mềm tự so chuẩn ± dung sai.
 *    Firebase: qc_dk_ep_check_v1/{ngày}/{M<số máy>_<ca>}/{mã khuôn}
 * 3) Bộ nhắc việc: quá 30 phút mà chưa làm thì gửi Zalo vào nhóm của xưởng (mỗi việc chỉ nhắc 1 lần):
 *      - chưa xác nhận điều kiện ép (đầu ca / sau khi MES đổi mã khuôn)
 *      - chưa kiểm SP định kỳ 2 giờ/lần (Tab 2)
 *      - có ảnh lỗi nhưng chưa đủ đối sách 4M (Tab 1 / Tab 2)
 *    Firebase: qc_nhac_v1/{ngày}/cur (khuôn đang chạy + giờ bắt đầu tính hạn), /log (việc đã nhắc)
 *    Bộ nhắc chạy trên mọi thiết bị đang mở phần mềm QC (điện thoại QC và máy "Hải Tân AI Control"). Khóa "log"
 *    đảm bảo nhiều máy cùng mở cũng chỉ tạo 1 tin.
 * 4) Gửi Zalo: tin KHÔNG gửi qua webhook mà xếp vào hộp chờ qc_nhac_v1/{ngày}/gui/{id}. Phần mềm "Hải Tân AI Control"
 *    (python -m haitan nhac-qc) mở trang QC này chạy ngầm, lấy tin trong hộp chờ (qcCauNoiChay) rồi gửi vào nhóm Zalo
 *    bằng Zalo của anh Tưởng, xong báo lại (qcCauNoiXong). Trạng thái tin: cho -> dang_gui -> da_gui | loi | qua_han.
 */

const DK_PATH_CHUAN = 'qc_dk_ep_chuan_v1';
const DK_PATH_CHECK = 'qc_dk_ep_check_v1';
const DK_PATH_NHAC = 'qc_nhac_v1';
const DK_HAN_PHUT = 30;          // hạn hoàn thành tính từ đầu ca / lúc đổi khuôn / đầu khung giờ / lúc chụp ảnh lỗi
const DK_TICK_MS = 120000;       // chu kỳ kiểm tra của bộ nhắc
const DK_TIN_QUA_HAN_PHUT = 180;  // tin chờ quá lâu (máy gửi Zalo tắt) thì bỏ, không gửi muộn
const DK_CAU_NOI_TRE_PHUT = 10;   // quá số phút này không thấy máy gửi Zalo -> cảnh báo trên Tab 6

// Nhóm Zalo theo xưởng (tên xưởng theo cách gọi tại xưởng: Xưởng 1 = M11-M21, Xưởng 2 = M1-M10)
const DK_NHOM_ZALO = {
    X1: { ma: 'X1', xuong: 'XƯỞNG 1 (M1-M11)', nhom: 'Nhóm Quản lí và TT 2NM' },
    X2: { ma: 'X2', xuong: 'XƯỞNG 2 (M1-M10)', nhom: 'SẢN XUẤT XƯỞNG ÉP MỚI' }
};
function dkNhomTheoMay(m) { return (parseInt(m) || 0) >= 11 ? DK_NHOM_ZALO.X1 : DK_NHOM_ZALO.X2; }
// Số máy gọi tại xưởng: Xưởng 1 đánh số M1-M11 (mã nội bộ / PM ép nhựa: M11-M21), Xưởng 2 M1-M10 (giữ nguyên).
// Dữ liệu Firebase và PM ép nhựa vẫn dùng mã nội bộ 1-21; chỉ đổi tên hiển thị.
const DK_THU_TU_MAY = QC_THU_TU_MAY;   // Xưởng 1 trước, rồi Xưởng 2 (xem js/config.js)
function dkSoMay(m) { return qcSoMay(m); }
function dkTenMay(m) { return qcTenMay(m); }
function dkTenMayDu(m) { return qcTenMayDu(m); }
function dkTenTuKhoa(k) { return qcTenMayDu(k); }   // 'M12' (mã nội bộ) -> 'M2 (Xưởng 1)'
function dkViTriMay(m) { let i = DK_THU_TU_MAY.indexOf(parseInt(m)); return i < 0 ? 99 : i; }

// ===================== 1. DANH MỤC THÔNG SỐ =====================
// kieu: 'pm' = chuẩn ± dung sai | 'min' = thực tế ≥ chuẩn | 'max' = thực tế ≤ chuẩn
// kt  : QC phải kiểm (mặc định) – kỹ thuật có thể bật/tắt trong từng bản chuẩn
// tam : △ thông số kiểm soát – QC bắt buộc tự nhập số đo thực tế (không dùng nút "đúng chuẩn")
function dkP(id, ten, dv, o) { return Object.assign({ id, ten, dv, kieu: 'pm', d: 0, kt: true, tam: false }, o || {}); }
function dkLuoi(tienTo, hang, cot, o) {
    let ds = [];
    hang.forEach(h => cot.forEach(c => ds.push(dkP(`${tienTo}_${h[0]}${c[0]}`, `${h[1]} – ${c[1]}`, h[2], o))));
    return ds;
}
const DK_HANG_ATV = [['ap', 'Áp suất', 'bar'], ['td', 'Tốc độ', '%'], ['vt', 'Vị trí', 'mm']];

const DK_NHOM = [
    { ma: 'NH', ten: '1. Nhiệt độ nòng súng (Barrel)', ds: [
        dkP('nh_voi', 'Vòi phun', '°C', { d: 3 }), dkP('nh_v1', 'Vùng 1', '°C', { d: 3 }), dkP('nh_v2', 'Vùng 2', '°C', { d: 3 }),
        dkP('nh_v3', 'Vùng 3', '°C', { d: 3 }), dkP('nh_v4', 'Vùng 4', '°C', { d: 3 }), dkP('nh_cophieu', 'Cổ phễu', '°C', { d: 3 }),
        dkP('nh_dau', 'Dầu thủy lực', '°C', { d: 5, kt: false })
    ] },
    { ma: 'KS', ten: 'Nhiệt khuôn – Sấy nhựa – Pha nhựa xay', ds: [
        dkP('kh_codinh', 'Nhiệt khuôn cố định', '°C', { d: 5 }), dkP('kh_didong', 'Nhiệt khuôn di động', '°C', { d: 5 }),
        dkP('say_nhiet', 'Nhiệt độ sấy nhựa', '°C', { d: 3 }), dkP('say_tg', 'Thời gian sấy', 'h', { kieu: 'min' }),
        dkP('pha_xay', 'Tỷ lệ pha nhựa xay (phế)', '%', { kieu: 'max', tam: true })
    ] },
    { ma: 'BK', ten: '2. Bắn keo (Injection) – cấp 1 → 4',
        ds: dkLuoi('bk', DK_HANG_ATV, [['1', 'Cấp 1'], ['2', 'Cấp 2'], ['3', 'Cấp 3'], ['4', 'Cấp 4']]) },
    { ma: 'BA', ten: 'Bảo áp (Holding pressure)',
        ds: dkLuoi('ba', [['ap', 'Áp suất', 'bar'], ['td', 'Tốc độ', '%'], ['tg', 'Thời gian', 's']], [['1', 'Bảo áp 1'], ['2', 'Bảo áp 2']]) },
    { ma: 'LN', ten: 'Lấy nhựa & hút lùi (Charging / Suck back)',
        // Khớp màn hình Haitian: Vị trí / ÁpL. (áp lực lấy nhựa) / Tđộ / L.Áp (lưng áp) – id cũ ln_ap* giữ nghĩa "áp suất lưng"
        ds: dkLuoi('ln', [['al', 'Áp lực lấy nhựa', 'bar'], ['ap', 'Áp suất lưng (L.Áp)', 'bar'], ['td', 'Tốc độ', '%'], ['vt', 'Vị trí', 'mm']], [['1', 'Lấy 1'], ['2', 'Lấy 2']])
            .concat([dkP('hl_vt', 'Hút lùi – Vị trí', 'mm'), dkP('hl_ap', 'Hút lùi – Áp suất', 'bar', { kt: false }), dkP('hl_td', 'Hút lùi – Tốc độ', '%', { kt: false })]) },
    { ma: 'VP', ten: 'Chuyển bảo áp & đệm keo (V/P – Cushion)', ds: [
        dkP('vp_vt', 'Vị trí chuyển V/P', 'mm'), dkP('vp_tgban', 'Thời gian bắn keo', 's', { d: 0.1, tam: true }),
        dkP('vp_dem', 'Đệm keo thực tế', 'mm', { d: 2, tam: true }), dkP('vp_tglay', 'Thời gian lấy nhựa', 's', { d: 1 })
    ] },
    { ma: 'CK', ten: 'Chu kỳ & trọng lượng', ds: [
        dkP('ck_lammat', 'Thời gian làm mát', 's', { d: 1 }), dkP('ck_chuky', 'Chu kỳ', 's', { d: 1, tam: true }),
        dkP('tl_sp', 'Trọng lượng SP / Run', 'g', { tam: true }), dkP('ck_luckep', 'Lực kẹp', 'Tấn', { kt: false })
    ] },
    { ma: 'DK', ten: '3. Đóng khuôn (Mold close)', thamKhao: true,
        ds: dkLuoi('dk', DK_HANG_ATV, [['1', 'Cấp 1'], ['2', 'Cấp 2'], ['3', 'Cấp 3'], ['t', 'Thấp áp'], ['c', 'Cao áp']], { kt: false }) },
    { ma: 'MK', ten: 'Mở khuôn (Mold open)', thamKhao: true,
        ds: dkLuoi('mk', DK_HANG_ATV, [['1', 'Cấp 1'], ['2', 'Cấp 2'], ['3', 'Cấp 3'], ['4', 'Cấp 4'], ['c', 'Cấp 5 (cuối)']], { kt: false }) },
    { ma: 'DS', ten: '4. Đẩy sản phẩm (Ejector)', thamKhao: true,
        ds: dkLuoi('ds', DK_HANG_ATV, [['1', 'Tiến 1'], ['2', 'Tiến 2'], ['l', 'Lùi 1'], ['l2', 'Lùi 2']], { kt: false })
            .concat([dkP('ds_solan', 'Số lần đẩy', 'lần', { kt: false })]) }
];
const DK_INFO = [
    ['model', 'Model máy'], ['maSP', 'Mã sản phẩm'], ['tenSP', 'Tên sản phẩm'], ['nhua', 'Tên nhựa'],
    ['mau', 'Màu / Hạt màu'], ['cavity', 'Số cavity'], ['dkVit', 'ĐK vít (mm)'], ['ghiChu', 'Ghi chú']
];

// ===================== 2. TRẠNG THÁI =====================
let dkChuan = {};                 // toàn bộ bản chuẩn
let dkChecks = {};                // { ngày: { M<m>_<ca>: { khuôn: bản ghi } } }
let dkNhacNgay = {};              // dữ liệu nhắc của ngày làm việc hiện tại (cur + log)
let dkBound = false, dkCheckListener = null;
let dkXem = { date: '', ca: '', xuong: 'ALL' };
let dkThuVienLoc = { xuong: 'ALL' };   // bộ lọc xưởng trong danh sách bản chuẩn (giữ lại giữa các lần mở)
let dkDangSua = null, dkDangKiem = null;
let dkModalChuan = null, dkModalKiem = null, dkModalThuVien = null;
let dkNhacTimer = null, dkNhacBusy = false, dkNhacLoi = '';
let dkCauNoiLuc = null;           // lần cuối máy gửi Zalo (AI Control) báo còn chạy; null = chưa đọc được

function dkSo(v) {
    if (v === undefined || v === null) return NaN;
    let s = String(v).trim().replace(',', '.');
    return s === '' ? NaN : parseFloat(s);
}
function dkISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function dkGio(ms) { let d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function dkNgayNgan(date) { let p = String(date).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : date; }

// Ca đang chạy: Ca Ngày 07:30-19:30, Ca Đêm 19:30-07:30 (ca đêm tính theo ngày bắt đầu ca)
function dkCaHienTai(now) {
    now = now || new Date();
    let phut = now.getHours() * 60 + now.getMinutes();
    let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let ca = (phut >= 450 && phut < 1170) ? 'Ca Ngày' : 'Ca Đêm';
    if (phut < 450) d.setDate(d.getDate() - 1);
    let batDau = new Date(d.getFullYear(), d.getMonth(), d.getDate(), ca === 'Ca Ngày' ? 7 : 19, 30, 0, 0).getTime();
    return { date: dkISO(d), ca, batDau, ketThuc: batDau + 12 * 3600000 };
}

// Mã khuôn đang chạy theo PM ép nhựa (nếu trong ca có nhiều lượt chạy thì lấy lượt mới nhất)
function dkKhuonDangChay(date, m, ca) {
    if (typeof mesSyncActive !== 'undefined' && mesSyncActive) {
        let recs = qcProdRecs(date, parseInt(m)).filter(r => qcShiftMatch(r, ca) && r.moldId);
        if (recs.length) return String(recs[recs.length - 1].moldId).trim();
    }
    return String(qcResolveMold(date, m, ca, '').mold || '').trim();
}

function dkLayChuan(moldId, m) {
    let k = getSafeFirebaseKey(moldId);
    return (k && dkChuan[k] && dkChuan[k][`M${parseInt(m)}`]) || null;
}
function dkLayCheck(date, m, ca, moldId) {
    let day = dkChecks[date] || {};
    let o = day[`M${parseInt(m)}_${ca}`];
    return (o && o[getSafeFirebaseKey(moldId)]) || null;
}
function dkThongSo(pid) {
    for (let g of DK_NHOM) { let f = g.ds.find(p => p.id === pid); if (f) return f; }
    return null;
}
// Chuẩn của 1 thông số trong 1 bản chuẩn: { c, d, kt } hoặc null nếu kỹ thuật không điền
function dkChuanCuaTS(std, p) {
    let t = std && std.ts && std.ts[p.id];
    if (!t) return null;
    let c = dkSo(t.c);
    if (isNaN(c)) return null;
    let d = dkSo(t.d);
    return { c, d: isNaN(d) ? 0 : Math.abs(d), kt: t.kt !== undefined ? !!t.kt : p.kt, xem: !!t.xem };
}
function dkChuText(p, s) {
    if (!s) return '—';
    if (p.kieu === 'min') return `≥ ${s.c}`;
    if (p.kieu === 'max') return `≤ ${s.c}`;
    return s.d > 0 ? `${s.c} ± ${s.d}` : `${s.c}`;
}
// ----- BẢN GỐC CỦA KHUÔN (dùng khi khuôn chạy trên máy chưa có bản chuẩn riêng) -----
// Thông số thuộc khuôn + nhựa: máy nào cũng phải giống -> so như bình thường
const DK_TS_KHUON = new Set(['nh_voi', 'nh_v1', 'nh_v2', 'nh_v3', 'nh_v4', 'nh_cophieu', 'kh_codinh', 'kh_didong',
    'say_nhiet', 'say_tg', 'pha_xay', 'ba_tg1', 'ba_tg2', 'vp_tgban', 'ck_lammat', 'ck_chuky', 'tl_sp']);
// Thông số vị trí (mm): quy đổi theo thể tích bắn khi biết đường kính vít 2 máy
const DK_TS_VITRI = new Set(['bk_vt1', 'bk_vt2', 'bk_vt3', 'bk_vt4', 'ln_vt1', 'ln_vt2', 'hl_vt', 'vp_vt', 'vp_dem']);
function dkLoaiTS(pid) { return DK_TS_KHUON.has(pid) ? 'khuon' : DK_TS_VITRI.has(pid) ? 'vitri' : 'may'; }

// Bản gốc của khuôn: bản được đánh dấu ⭐ gốc; chưa đánh dấu thì lấy bản cập nhật gần nhất. Bỏ qua máy boQuaM.
function dkLayChuanGoc(moldId, boQuaM) {
    let k = getSafeFirebaseKey(moldId), o = (k && dkChuan[k]) || {}, ds = [];
    Object.keys(o).forEach(mk => {
        let s = o[mk], m = parseInt(String(mk).replace('M', '')) || 0;
        if (s && typeof s === 'object' && s.ts && m && m !== parseInt(boQuaM)) ds.push({ m, std: s });
    });
    if (!ds.length) return null;
    ds.sort((a, b) => (b.std.goc ? 1 : 0) - (a.std.goc ? 1 : 0) || String(b.std.updatedAt || '').localeCompare(String(a.std.updatedAt || '')));
    return ds[0];
}
// Đường kính vít của 1 máy: QC đã nhập trên thiết bị này, không thì lấy từ bản chuẩn bất kỳ của máy đó
function dkVitCuaMay(m) {
    try { let v = dkSo(localStorage.getItem('qc_dk_vit_M' + parseInt(m))); if (v > 0) return v; } catch (e) {}
    for (let k of Object.keys(dkChuan || {})) {
        let s = dkChuan[k] && dkChuan[k][`M${parseInt(m)}`], v = s && s.info ? dkSo(s.info.dkVit) : NaN;
        if (v > 0) return v;
    }
    return NaN;
}
function dkLam1(x) { return Math.round(x * 10) / 10; }

// Chuẩn dùng để kiểm khuôn moldId trên máy m:
//  - có bản riêng của máy -> { std, goc: false }
//  - chưa có, nhưng khuôn có bản ở máy khác -> bản "hiệu lực" dựng từ bản gốc { std, goc: true, mGoc, stdGoc, heSo, vitGoc, vitMay }
//    thông số thuộc khuôn: giữ nguyên; vị trí: quy đổi nếu biết ĐK vít 2 máy, không thì chỉ tham khảo; còn lại: chỉ tham khảo
function dkChuanKiem(moldId, m) {
    let std = dkLayChuan(moldId, m);
    if (std) return { std, goc: false };
    let g = dkLayChuanGoc(moldId, m);
    if (!g) return null;
    let vitGoc = dkSo(g.std.info && g.std.info.dkVit), vitMay = dkVitCuaMay(m);
    let heSo = (vitGoc > 0 && vitMay > 0) ? Math.pow(vitGoc / vitMay, 2) : NaN;
    let ts = {};
    Object.keys(g.std.ts || {}).forEach(pid => {
        let t = Object.assign({}, g.std.ts[pid]), loai = dkLoaiTS(pid);
        if (loai === 'vitri' && !isNaN(heSo)) {
            let c = dkSo(t.c), d = dkSo(t.d);
            if (!isNaN(c)) t.c = dkLam1(c * heSo);
            if (!isNaN(d)) t.d = dkLam1(d * heSo);
        } else if (loai !== 'khuon') t.xem = true;
        ts[pid] = t;
    });
    return { std: Object.assign({}, g.std, { ts }), goc: true, mGoc: g.m, stdGoc: g.std, heSo, vitGoc, vitMay };
}

function dkDat(p, s, v) {
    if (s && s.xem) return true;          // thông số chỉ tham khảo (kiểm theo bản gốc ở máy khác) -> không tính NG
    if (isNaN(v)) return false;
    if (p.kieu === 'min') return v >= s.c - 1e-9;
    if (p.kieu === 'max') return v <= s.c + 1e-9;
    return Math.abs(v - s.c) <= s.d + 1e-9;
}

// ===================== 3. KẾT NỐI FIREBASE =====================
function dkKhoiDong() {
    if (!isConnected || !db || !isEditMode) return;
    dkDungKhung();
    if (typeof dkAiNghe === 'function') dkAiNghe();
    if (!dkBound) {
        dkBound = true;
        db.ref(DK_PATH_CHUAN).on('value', s => { dkChuan = s.val() || {}; dkRender(); },
            err => { dkNhacLoi = 'Chưa có quyền đọc nhánh ' + DK_PATH_CHUAN + ' (Firebase Rules)'; console.warn(err); dkRender(); });
    }
    dkNgheCheck();
    if (!dkNhacTimer) {
        dkNhacTimer = setInterval(dkNhacTick, DK_TICK_MS);
        setTimeout(dkNhacTick, 15000);
    }
    dkRender();
}
function dkStop() {
    if (db) {
        try { db.ref(DK_PATH_CHUAN).off(); } catch (e) {}
        if (dkCheckListener) { try { db.ref(`${DK_PATH_CHECK}/${dkCheckListener}`).off(); } catch (e) {} }
    }
    if (dkNhacTimer) { clearInterval(dkNhacTimer); dkNhacTimer = null; }
    dkBound = false; dkCheckListener = null; dkChuan = {}; dkChecks = {}; dkNhacNgay = {};
}
function dkNgheCheck() {
    if (!db || !isEditMode) return;
    let date = dkXem.date || dkCaHienTai().date;
    if (dkCheckListener === date) return;
    if (dkCheckListener) db.ref(`${DK_PATH_CHECK}/${dkCheckListener}`).off();
    dkCheckListener = date;
    db.ref(`${DK_PATH_CHECK}/${date}`).on('value', s => { dkChecks[date] = s.val() || {}; dkRender(); });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && dkNhacTimer) dkNhacTick(); });

// ===================== 4. BẢNG THEO DÕI (TAB 6) =====================
function dkDungKhung() {
    let root = document.getElementById('dkRoot');
    if (!root || root.dataset.ready === '1') return;
    root.dataset.ready = '1';
    let ht = dkCaHienTai();
    dkXem.date = ht.date; dkXem.ca = ht.ca;
    root.innerHTML = `
    <div class="card">
        <div class="qc-sticky-toolbar d-flex flex-wrap justify-content-between align-items-center gap-2">
            <div>
                <h5 class="fw-bold text-info m-0">Điều Kiện Ép – Xác Nhận Đầu Ca &amp; Khi Đổi Khuôn</h5>
                <small class="text-light opacity-75" style="font-size:11px;">QC nhập giá trị thực tế trên máy, phần mềm tự so với bản điều kiện chuẩn của khuôn.
                    Hạn: ${DK_HAN_PHUT} phút sau đầu ca hoặc sau khi PM ép nhựa đổi mã khuôn – quá hạn sẽ nhắc vào nhóm Zalo của xưởng.</small>
            </div>
            <div class="d-flex align-items-center gap-2 flex-wrap">
                <select id="dkLocXuong" class="form-select form-select-sm fw-bold" style="width:150px;" onchange="dkXem.xuong=this.value; dkRender()">
                    <option value="ALL">🌐 Toàn xưởng</option><option value="X1">🏭 Xưởng 1 (M1-11)</option><option value="X2">🏭 Xưởng 2 (M1-10)</option>
                </select>
                <select id="dkLocCa" class="form-select form-select-sm fw-bold" style="width:120px;" onchange="dkXem.ca=this.value; dkRender()">
                    <option value="Ca Ngày">☀️ Ca Ngày</option><option value="Ca Đêm">🌙 Ca Đêm</option>
                </select>
                <input type="date" id="dkNgay" class="form-control form-control-sm fw-bold text-center qc-date-input" style="width:140px;"
                    onchange="dkXem.date=this.value||dkCaHienTai().date; dkNgheCheck(); dkRender()">
                <button class="btn btn-sm btn-3d-primary px-3" onclick="dkMoThuVien()">📚 Bản điều kiện chuẩn</button>
                <button class="btn btn-sm px-3" id="dkBtnNhac" onclick="dkDoiNhac()"></button>
            </div>
        </div>
        <div id="dkCanhBao"></div>
        <div class="table-responsive">
            <table class="table table-bordered align-middle text-center" style="min-width:720px;">
                <thead><tr>
                    <th style="width:48px;" class="sticky-col">Máy</th>
                    <th style="width:150px;">Mã khuôn (PM ép)</th>
                    <th style="width:120px;">Bản chuẩn</th>
                    <th style="width:170px; background: linear-gradient(180deg,#0284c7 0%,#0369a1 100%) !important;">Xác nhận điều kiện</th>
                    <th style="width:130px;">QC / Giờ</th>
                    <th style="width:150px;">Thao tác</th>
                </tr></thead>
                <tbody id="dkTbody"></tbody>
            </table>
        </div>
    </div>`;
    document.getElementById('dkNgay').value = dkXem.date;
    document.getElementById('dkLocCa').value = dkXem.ca;
    root.addEventListener('click', dkClick);
}

function dkNhacBat() { try { return localStorage.getItem('qc_nhac_zalo_bat') !== '0'; } catch (e) { return true; } }
function dkDoiNhac() {
    let bat = !dkNhacBat();
    try { localStorage.setItem('qc_nhac_zalo_bat', bat ? '1' : '0'); } catch (e) {}
    dkRender();
    if (bat) dkNhacTick();
}

function dkRender() {
    let tbody = document.getElementById('dkTbody');
    if (!tbody || !isEditMode) return;
    let btn = document.getElementById('dkBtnNhac');
    if (btn) {
        btn.className = 'btn btn-sm px-3 ' + (dkNhacBat() ? 'btn-3d-emerald' : 'btn-outline-secondary');
        btn.innerHTML = dkNhacBat() ? '🔔 Nhắc Zalo: BẬT' : '🔕 Nhắc Zalo: TẮT';
        btn.title = 'Bật/tắt việc thiết bị này tự kiểm tra và gửi nhắc việc vào nhóm Zalo';
    }
    let cb = document.getElementById('dkCanhBao');
    if (cb) {
        let ds = [];
        if (!(typeof mesSyncActive !== 'undefined' && mesSyncActive)) ds.push('⚠️ Chưa kết nối PM ép nhựa – mã khuôn có thể chưa đúng và bộ nhắc việc tạm dừng phần điều kiện ép / kiểm 2 giờ.');
        if (dkNhacLoi) ds.push('⚠️ ' + escapeHtml(dkNhacLoi));
        if (dkCauNoiLuc !== null && Date.now() - dkCauNoiLuc > DK_CAU_NOI_TRE_PHUT * 60000)
            ds.push('⚠️ Máy gửi Zalo (Hải Tân AI Control) ' + (dkCauNoiLuc ? 'ngừng hoạt động từ ' + dkGio(dkCauNoiLuc) + ' ' + dkNgayNgan(dkISO(new Date(dkCauNoiLuc))) : 'chưa từng kết nối') + ' – tin nhắc đang nằm chờ, chưa vào nhóm Zalo.');
        cb.innerHTML = ds.map(t => `<div class="alert alert-warning py-1 px-2 my-2 small fw-bold">${t}</div>`).join('');
    }
    let date = dkXem.date, ca = dkXem.ca, ht = dkCaHienTai(), laCaHienTai = (date === ht.date && ca === ht.ca);
    let dsMay = DK_THU_TU_MAY.filter(m => m <= TOTAL_MACHINES && (dkXem.xuong === 'ALL' || dkNhomTheoMay(m).ma === dkXem.xuong));
    let html = '', now = Date.now();
    for (let m of dsMay) {
        if (dkXem.xuong === 'ALL' && (m === 1 || m === 11)) html += dkDongXuong(dkNhomTheoMay(m), 6);
        let mold = dkKhuonDangChay(date, m, ca);
        if (!mold) {
            html += `<tr class="opacity-50"><td class="fw-bold sticky-col">${dkTenMay(m)}</td><td colspan="5" class="small fst-italic">Máy không chạy</td></tr>`;
            continue;
        }
        let std = dkLayChuan(mold, m), chk = dkLayCheck(date, m, ca, mold);
        let goc = std ? null : dkLayChuanGoc(mold, m);
        let cur = laCaHienTai && dkNhacNgay.cur ? dkNhacNgay.cur[`M${m}_${ca}`] : null;
        let doiKhuon = cur && cur.mold === mold && cur.prev;
        let tt, nguoi = '—';
        if (chk) {
            let soNG = (chk.ng || []).length;
            tt = chk.kq === 'NG'
                ? `<span class="badge bg-danger px-2 py-2">❌ NG (${soNG} thông số)</span>`
                : `<span class="badge bg-success px-2 py-2">✅ ĐẠT</span>`;
            nguoi = `${escapeHtml(chk.by || '')}<br><small class="opacity-75">${chk.at ? dkGio(new Date(chk.at).getTime()) : ''} · ${chk.loai === 'doi_khuon' ? 'Đổi khuôn' : 'Đầu ca'}</small>`
                + (chk.theoGoc ? `<br><small class="text-info">📋 theo bản gốc ${escapeHtml(dkTenTuKhoa(chk.theoGoc))}</small>` : '');
        } else if (laCaHienTai) {
            let han = ((cur && cur.mold === mold && cur.since) || ht.batDau) + DK_HAN_PHUT * 60000;
            tt = now > han
                ? `<span class="badge bg-danger px-2 py-2">⏰ QUÁ HẠN (${dkGio(han)})</span>`
                : `<span class="badge bg-warning text-dark px-2 py-2">⏳ Chưa xác nhận · hạn ${dkGio(han)}</span>`;
        } else {
            tt = `<span class="badge bg-secondary px-2 py-2">Chưa xác nhận</span>`;
        }
        let chuanHtml = std
            ? `<button type="button" class="btn btn-sm btn-outline-info py-0 px-2 rounded-pill" data-act="chuan" data-m="${m}" data-mold="${escapeHtml(mold)}" style="font-size:11px;" title="Cập nhật ${escapeHtml(std.updatedAt || '')} – ${escapeHtml(std.updatedBy || '')}">📄 Đã có · sửa</button>`
            : goc
            ? `<div class="small fw-bold text-info">📋 Theo bản gốc ${dkTenMayDu(goc.m)}</div>
               <button type="button" class="btn btn-sm btn-3d-amber py-0 px-2 mt-1" data-act="chepgoc" data-m="${m}" data-mold="${escapeHtml(mold)}" style="font-size:11px;" title="Mở bản chuẩn mới cho ${dkTenMayDu(m)}, điền sẵn dữ liệu bản gốc ${dkTenMayDu(goc.m)} để kỹ thuật soát lại">📋 Lập bản riêng (chép ${dkTenMayDu(goc.m)})</button>`
            : `<button type="button" class="btn btn-sm btn-3d-amber py-0 px-2" data-act="chuan" data-m="${m}" data-mold="${escapeHtml(mold)}" style="font-size:11px;">➕ Lập bản chuẩn</button>`;
        let thaoTac = (std || goc)
            ? `<button type="button" class="btn btn-sm ${chk ? 'btn-outline-info' : 'btn-3d-emerald'} py-1 px-3 fw-bold" data-act="kiem" data-m="${m}" style="font-size:12px;">${chk ? '👁️ Xem / kiểm lại' : '📝 Kiểm tra'}</button>`
            : `<small class="text-warning fw-bold">Chưa có bản chuẩn</small>`;
        html += `<tr>
            <td class="fw-bold sticky-col">${dkTenMay(m)}</td>
            <td class="fw-bold text-warning">${escapeHtml(mold)}${doiKhuon ? `<br><small class="text-info">🔁 đổi khuôn ${dkGio(cur.since)}</small>` : ''}</td>
            <td>${chuanHtml}</td><td>${tt}</td><td class="small">${nguoi}</td><td>${thaoTac}</td></tr>`;
    }
    tbody.innerHTML = html;
}

function dkClick(e) {
    let b = e.target.closest('[data-act]');
    if (!b) return;
    let m = parseInt(b.dataset.m);
    if (b.dataset.act === 'chuan') dkMoChuan(b.dataset.mold, m);
    else if (b.dataset.act === 'kiem') dkMoKiemTra(dkXem.date, dkXem.ca, m);
    else if (b.dataset.act === 'chepgoc') dkMoChuanTuGoc(b.dataset.mold, m);
}

// ===================== 5. LẬP / SỬA BẢN ĐIỀU KIỆN CHUẨN =====================
function dkTaoModal(id, tieuDe, thanHtml, chanHtml, lon) {
    let el = document.getElementById(id);
    if (el) return el;
    let div = document.createElement('div');
    div.innerHTML = `
    <div class="modal fade" id="${id}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog ${lon ? 'modal-lg' : ''} modal-fullscreen-md-down modal-dialog-scrollable">
            <div class="modal-content qc-modal-content rounded-4">
                <div class="modal-header py-2" style="background: linear-gradient(90deg, #0284c7, #0369a1);">
                    <h6 class="modal-title fw-bold m-0 text-white" id="${id}Title">${tieuDe}</h6>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body p-2 p-md-3" id="${id}Body">${thanHtml || ''}</div>
                <div class="modal-footer py-2" id="${id}Foot">${chanHtml || ''}</div>
            </div>
        </div>
    </div>`;
    el = div.firstElementChild;
    document.body.appendChild(el);
    return el;
}

function dkDanhSachChuan() {
    let ds = [];
    Object.keys(dkChuan || {}).forEach(k => Object.keys(dkChuan[k] || {}).forEach(mk => {
        let s = dkChuan[k][mk];
        if (s && typeof s === 'object') ds.push({ k, mk, m: parseInt(String(mk).replace('M', '')) || 0, moldId: s.moldId || k, s });
    }));
    return ds.sort((a, b) => dkViTriMay(a.m) - dkViTriMay(b.m) || String(a.moldId).localeCompare(String(b.moldId), undefined, { numeric: true }));
}
// Dòng tiêu đề ngăn cách từng xưởng trong bảng
function dkDongXuong(nhom, soCot, soBan) {
    return `<tr class="dk-dong-xuong" data-xuong="${nhom.ma}"><td colspan="${soCot}" class="text-start fw-bold text-white py-1 px-2"
        style="background:linear-gradient(90deg,#0369a1,#0284c7) !important; font-size:12px; letter-spacing:.5px;">🏭 ${nhom.xuong}${soBan !== undefined ? ` · ${soBan} bản chuẩn` : ''}</td></tr>`;
}
// Danh sách mã khuôn để chọn: danh mục khuôn PM ép nhựa + các khuôn đã có bản chuẩn
function dkDsMaKhuon() {
    let set = {};
    let them = v => { v = String(v || '').trim(); if (v && !set[v.toLowerCase()]) set[v.toLowerCase()] = v; };
    try {
        if (typeof moldCatalog !== 'undefined' && moldCatalog)
            (Array.isArray(moldCatalog) ? moldCatalog : Object.values(moldCatalog)).forEach(k => { if (k) them(k.id || k.moldId); });
    } catch (e) {}
    document.querySelectorAll('#moldOptionsList option').forEach(o => them(o.value));
    Object.keys(dkChuan || {}).forEach(k => Object.keys(dkChuan[k] || {}).forEach(mk => { let x = dkChuan[k][mk]; if (x && typeof x === 'object') them(x.moldId); }));
    return Object.values(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
// Ô mã khuôn: chọn từ danh sách hoặc "Nhập bằng tay"
function dkChonMaKhuon(v) {
    let inp = document.getElementById('dkCMold');
    if (!inp) return;
    let tay = v === '__tay';
    inp.classList.toggle('d-none', !tay);
    if (tay) { inp.value = ''; inp.focus(); } else inp.value = v;
    if (typeof dkDongBoMes === 'function') dkDongBoMes();
}

function dkMoThuVien() {
    if (!checkAuthOrAlert()) return;
    let el = dkTaoModal('dkThuVienModal', '📚 BẢN ĐIỀU KIỆN ÉP CHUẨN (THEO KHUÔN + MÁY)', '',
        `<button type="button" class="btn btn-sm btn-3d-emerald px-3" onclick="dkModalThuVien.hide(); dkMoChuan('', 0)">➕ Lập bản chuẩn mới</button>`, true);
    let ds = dkDanhSachChuan();
    let dem = { X1: 0, X2: 0 };
    ds.forEach(x => { dem[dkNhomTheoMay(x.m).ma]++; });
    document.getElementById('dkThuVienModalBody').innerHTML = `
        <div class="d-flex gap-2 mb-2">
            <select id="dkThuVienXuong" class="form-select form-select-sm fw-bold" style="width:170px; flex:none;" onchange="dkLocThuVien()">
                <option value="ALL">🌐 Toàn xưởng</option><option value="X1">🏭 Xưởng 1 (M1-11)</option><option value="X2">🏭 Xưởng 2 (M1-10)</option>
            </select>
            <input type="text" id="dkThuVienTim" class="form-control form-control-sm" placeholder="🔎 Tìm mã khuôn / sản phẩm..." oninput="dkLocThuVien()">
        </div>
        <div class="table-responsive"><table class="table table-bordered table-sm align-middle text-center mb-0">
            <thead><tr><th>Mã khuôn</th><th>Máy</th><th title="Bản gốc của khuôn: dùng để kiểm khi khuôn chạy trên máy chưa có bản riêng">Gốc</th><th>Sản phẩm</th><th>Nhựa</th><th>Cập nhật</th><th></th></tr></thead>
            <tbody id="dkThuVienTbody">${ds.map((x, i) => `${(i === 0 || dkNhomTheoMay(ds[i - 1].m).ma !== dkNhomTheoMay(x.m).ma) ? dkDongXuong(dkNhomTheoMay(x.m), 7, dem[dkNhomTheoMay(x.m).ma]) : ''}
                <tr data-xuong="${dkNhomTheoMay(x.m).ma}" data-tim="${escapeHtml((x.moldId + ' ' + ((x.s.info || {}).tenSP || '') + ' ' + ((x.s.info || {}).maSP || '')).toLowerCase())}">
                    <td class="fw-bold text-warning">${escapeHtml(x.moldId)}</td><td class="fw-bold">${dkTenMay(x.m)}${x.s.tuGoc ? `<br><small class="fw-normal opacity-75">từ ${escapeHtml(dkTenTuKhoa(x.s.tuGoc))}</small>` : ''}</td>
                    <td><button type="button" class="btn btn-sm py-0 px-1 ${x.s.goc ? 'btn-warning' : 'btn-outline-secondary'}" style="font-size:13px;" onclick="dkDatGoc(${i})"
                        title="${x.s.goc ? 'Đang là bản gốc của khuôn' : 'Đặt làm bản gốc của khuôn (bản đã duyệt chạy hàng OK)'}">${x.s.goc ? '⭐' : '☆'}</button></td>
                    <td class="small">${escapeHtml((x.s.info || {}).tenSP || (x.s.info || {}).maSP || '')}</td>
                    <td class="small">${escapeHtml((x.s.info || {}).nhua || '')}</td>
                    <td class="small">${escapeHtml(String(x.s.updatedAt || '').substring(0, 10))}<br>${escapeHtml(x.s.updatedBy || '')}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-info py-0 px-2" onclick="dkMoTuThuVien(${i})">✏️ Sửa</button></td>
                </tr>`).join('') || '<tr><td colspan="7" class="fst-italic small">Chưa có bản chuẩn nào. Bấm "Lập bản chuẩn mới".</td></tr>'}
            </tbody></table></div>`;
    let loc = document.getElementById('dkThuVienXuong');
    if (loc) loc.value = dkThuVienLoc.xuong;
    dkLocThuVien();
    dkModalThuVien = bootstrap.Modal.getOrCreateInstance(el);
    dkModalThuVien.show();
}
// Đặt 1 bản làm ⭐ bản gốc của khuôn (bỏ dấu ở các máy khác của cùng khuôn)
function dkDatGoc(i) {
    let x = dkDanhSachChuan()[i];
    if (!x || !db || !checkAuthOrAlert()) return;
    if (x.s.goc) { if (!confirm(`Bỏ dấu bản gốc của khuôn ${x.moldId} (${dkTenMayDu(x.m)})?`)) return; }
    else if (!confirm(`Đặt bản ${dkTenMayDu(x.m)} làm BẢN GỐC của khuôn ${x.moldId}?\nKhi khuôn chạy trên máy chưa có bản riêng, QC sẽ kiểm theo bản này.`)) return;
    let up = {};
    Object.keys(dkChuan[x.k] || {}).forEach(mk => { if (dkChuan[x.k][mk] && typeof dkChuan[x.k][mk] === 'object') up[`${mk}/goc`] = null; });
    if (!x.s.goc) up[`${x.mk}/goc`] = true;
    db.ref(`${DK_PATH_CHUAN}/${x.k}`).update(up)
        .then(() => dkMoThuVien())
        .catch(err => alert('❌ Không lưu được: ' + err.message));
}
function dkLocThuVien() {
    let xEl = document.getElementById('dkThuVienXuong'), qEl = document.getElementById('dkThuVienTim');
    let xuong = xEl ? xEl.value : 'ALL', q = String(qEl ? qEl.value : '').trim().toLowerCase();
    dkThuVienLoc.xuong = xuong;
    let con = { X1: 0, X2: 0 };
    document.querySelectorAll('#dkThuVienTbody tr[data-tim]').forEach(tr => {
        let hien = (xuong === 'ALL' || tr.dataset.xuong === xuong) && (!q || tr.dataset.tim.includes(q));
        tr.style.display = hien ? '' : 'none';
        if (hien) con[tr.dataset.xuong]++;
    });
    // Ẩn dòng tiêu đề xưởng nếu xưởng đó không còn dòng nào đang hiện
    document.querySelectorAll('#dkThuVienTbody tr.dk-dong-xuong').forEach(tr => { tr.style.display = con[tr.dataset.xuong] ? '' : 'none'; });
}
function dkMoTuThuVien(i) {
    let x = dkDanhSachChuan()[i];
    if (!x) return;
    if (dkModalThuVien) dkModalThuVien.hide();
    dkMoChuan(x.moldId, x.m);
}

function dkMoChuan(moldId, m) {
    if (!checkAuthOrAlert()) return;
    let std = (moldId && m) ? dkLayChuan(moldId, m) : null;
    dkDangSua = { moldId: moldId || '', m: m || 0, coSan: !!std };
    let el = dkTaoModal('dkChuanModal', '', '',
        `<button type="button" class="btn btn-sm btn-outline-danger rounded-pill px-3 me-auto" id="dkBtnXoaChuan" onclick="dkXoaChuan()">🗑️ Xóa</button>
         <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>
         <button type="button" class="btn btn-sm btn-3d-emerald px-4" onclick="dkLuuChuan()">💾 Lưu bản chuẩn</button>`, true);
    document.getElementById('dkChuanModalTitle').textContent = '📄 BẢN ĐIỀU KIỆN ÉP CHUẨN – MÁY HAITIAN';
    document.getElementById('dkBtnXoaChuan').classList.toggle('d-none', !std);
    let ds = dkDanhSachChuan();
    let mayOpts = '';
    ['X1', 'X2'].forEach(x => {
        mayOpts += `<optgroup label="${DK_NHOM_ZALO[x].xuong}">` + DK_THU_TU_MAY.filter(i => i <= TOTAL_MACHINES && dkNhomTheoMay(i).ma === x)
            .map(i => `<option value="${i}" ${i === m ? 'selected' : ''}>${dkTenMay(i)} – Xưởng ${x === 'X1' ? 1 : 2}</option>`).join('') + '</optgroup>';
    });
    let dsKhuon = dkDsMaKhuon();
    let coTrongDs = !!moldId && dsKhuon.some(k => k.toLowerCase() === String(moldId).trim().toLowerCase());
    let nhapTay = !!moldId && !coTrongDs;   // mã khuôn không có trong danh sách -> mở sẵn ô nhập tay
    let body = `${typeof dkAiThanh === 'function' ? dkAiThanh('chuan') : ''}
        <div class="row g-2 mb-2">
            <div class="col-7 col-md-4"><label class="small fw-bold">Mã khuôn</label>
                <select class="form-select form-select-sm fw-bold" id="dkCMoldChon" onchange="dkChonMaKhuon(this.value)">
                    <option value="">— chọn mã khuôn —</option>
                    <option value="__tay" ${nhapTay ? 'selected' : ''}>✍️ Nhập bằng tay...</option>
                    ${dsKhuon.map(k => `<option value="${escapeHtml(k)}" ${coTrongDs && k.toLowerCase() === String(moldId).trim().toLowerCase() ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('')}
                </select>
                <input type="text" class="form-control form-control-sm fw-bold mt-1 ${nhapTay ? '' : 'd-none'}" id="dkCMold" placeholder="Gõ mã khuôn..." autocomplete="off"
                    oninput="if (typeof dkDongBoMes === 'function') dkDongBoMes()" value="${escapeHtml(moldId || '')}"></div>
            <div class="col-5 col-md-2"><label class="small fw-bold">Số máy</label>
                <select class="form-select form-select-sm fw-bold" id="dkCMay"><option value="">—</option>${mayOpts}</select></div>
            <div class="col-12 col-md-6"><label class="small fw-bold">Sao chép từ bản chuẩn khác</label>
                <select class="form-select form-select-sm" onchange="dkSaoChepChuan(this.value); this.value=''">
                    <option value="">— chọn để điền nhanh —</option>
                    ${ds.map((x, i) => `<option value="${i}">${dkTenMayDu(x.m)} · ${escapeHtml(x.moldId)}</option>`).join('')}
                </select></div>
        </div>
        <div class="row g-2 mb-2">${DK_INFO.map(f => `
            <div class="col-6 col-md-3"><label class="small">${f[1]}</label>
                <input type="text" class="form-control form-control-sm dk-info" data-info="${f[0]}"></div>`).join('')}
        </div>
        <div class="small opacity-75 mb-2">Điền <b>Chuẩn</b> và <b>± dung sai</b> (để trống dung sai = phải đúng bằng chuẩn). Thông số để trống chuẩn sẽ không kiểm.
            Tích <b>QC kiểm</b> cho thông số QC phải nhập giá trị thực tế. △ = thông số kiểm soát, QC bắt buộc tự nhập số đo.</div>
        ${DK_NHOM.map(g => `
        <details class="dk-nhom mb-2" ${g.thamKhao ? '' : 'open'}>
            <summary class="fw-bold text-info py-1">${g.ten}${g.thamKhao ? ' <small class="opacity-75">(tham khảo)</small>' : ''}</summary>
            <table class="table table-bordered table-sm align-middle text-center mb-0">
                <thead><tr><th class="text-start">Thông số</th><th style="width:52px;">ĐV</th><th style="width:92px;">Chuẩn</th><th style="width:78px;">± / loại</th><th style="width:60px;">QC kiểm</th></tr></thead>
                <tbody>${g.ds.map(p => `
                    <tr><td class="text-start small ${p.tam ? 'fw-bold' : ''}">${p.tam ? '△ ' : ''}${p.ten}</td><td class="small">${p.dv}</td>
                        <td><input type="text" inputmode="decimal" class="form-control form-control-sm text-center dk-c" data-pid="${p.id}"></td>
                        <td>${p.kieu === 'pm'
                            ? `<input type="text" inputmode="decimal" class="form-control form-control-sm text-center dk-d" data-pid="${p.id}" placeholder="${p.d}">`
                            : `<span class="small fw-bold">${p.kieu === 'min' ? '≥ chuẩn' : '≤ chuẩn'}</span>`}</td>
                        <td><input type="checkbox" class="form-check-input dk-kt" data-pid="${p.id}" ${p.kt ? 'checked' : ''}></td></tr>`).join('')}
                </tbody>
            </table>
        </details>`).join('')}`;
    document.getElementById('dkChuanModalBody').innerHTML = body;
    dkDienFormChuan(std);
    dkModalChuan = bootstrap.Modal.getOrCreateInstance(el);
    dkModalChuan.show();
}

function dkDienFormChuan(std) {
    let body = document.getElementById('dkChuanModalBody');
    if (!body) return;
    let info = (std && std.info) || {}, ts = (std && std.ts) || {};
    body.querySelectorAll('.dk-info').forEach(i => { i.value = info[i.dataset.info] || ''; });
    body.querySelectorAll('.dk-c').forEach(i => { let t = ts[i.dataset.pid]; i.value = (t && t.c !== undefined && t.c !== null) ? t.c : ''; });
    body.querySelectorAll('.dk-d').forEach(i => { let t = ts[i.dataset.pid]; i.value = (t && t.d !== undefined && t.d !== null) ? t.d : ''; });
    body.querySelectorAll('.dk-kt').forEach(i => { let t = ts[i.dataset.pid], p = dkThongSo(i.dataset.pid); i.checked = (t && t.kt !== undefined) ? !!t.kt : !!(p && p.kt); });
    if (typeof dkDongBoMes === 'function') dkDongBoMes();
}
function dkMoChuanTuGoc(moldId, m) {
    let g = dkLayChuanGoc(moldId, m);
    dkMoChuan(moldId, m);
    if (!g) return;
    let ck = dkChuanKiem(moldId, m) || {};
    // Thông số thuộc khuôn + vị trí đã quy đổi (nếu biết ĐK vít) -> điền sẵn; áp suất/tốc độ lấy theo bản gốc để kỹ thuật chỉnh
    let ts = {};
    Object.keys(g.std.ts || {}).forEach(pid => { ts[pid] = Object.assign({}, g.std.ts[pid], (ck.std && ck.std.ts[pid]) || {}); delete ts[pid].xem; });
    dkDienFormChuan(Object.assign({}, g.std, { ts, info: Object.assign({}, g.std.info, { model: '', dkVit: ck.vitMay > 0 ? String(ck.vitMay) : '' }) }));
    let tb = document.createElement('div');
    tb.className = 'alert alert-info py-1 px-2 small fw-bold mb-2';
    tb.textContent = `📋 Đã điền sẵn từ bản gốc ${dkTenMayDu(g.m)}` + (!isNaN(ck.heSo) ? ` (vị trí đã quy đổi theo ĐK vít ${ck.vitGoc} → ${ck.vitMay} mm)` : '')
        + '. Kỹ thuật soát lại áp suất, tốc độ, vị trí cho đúng máy này rồi bấm Lưu.';
    let body = document.getElementById('dkChuanModalBody');
    if (body) body.prepend(tb);
}
function dkSaoChepChuan(i) {
    let x = dkDanhSachChuan()[parseInt(i)];
    if (x) dkDienFormChuan(x.s);
}

function dkLuuChuan() {
    if (!checkAuthOrAlert() || !db) return;
    let body = document.getElementById('dkChuanModalBody');
    let moldId = document.getElementById('dkCMold').value.trim();
    let m = parseInt(document.getElementById('dkCMay').value) || 0;
    if (!moldId || !m) { alert('⚠️ Vui lòng nhập Mã khuôn và chọn Số máy.'); return; }
    let ts = {}, loi = [];
    body.querySelectorAll('.dk-c').forEach(i => {
        let raw = i.value.trim();
        if (raw === '') return;
        let c = dkSo(raw), p = dkThongSo(i.dataset.pid);
        if (isNaN(c)) { loi.push(p.ten); return; }
        let dEl = body.querySelector(`.dk-d[data-pid="${p.id}"]`);
        let d = dEl ? dkSo(dEl.value) : NaN;
        if (isNaN(d)) d = p.kieu === 'pm' ? p.d : 0;
        ts[p.id] = { c, d: Math.abs(d), kt: body.querySelector(`.dk-kt[data-pid="${p.id}"]`).checked };
    });
    if (loi.length) { alert('⚠️ Giá trị chuẩn không phải là số: ' + loi.join(', ')); return; }
    if (!Object.keys(ts).length) { alert('⚠️ Chưa điền thông số chuẩn nào.'); return; }
    let info = {};
    body.querySelectorAll('.dk-info').forEach(i => { if (i.value.trim()) info[i.dataset.info] = i.value.trim(); });
    let rec = { moldId, may: m, info, ts, updatedAt: new Date().toISOString(), updatedBy: (currentUser && currentUser.email) || '' };
    let cu = dkLayChuan(moldId, m);
    if (cu && cu.goc) rec.goc = true;
    let path = `${DK_PATH_CHUAN}/${getSafeFirebaseKey(moldId)}/M${m}`;
    // Sửa mã khuôn / số máy của bản cũ -> lưu sang vị trí mới, hỏi trước khi ghi đè bản đã có ở đó
    let khacViTri = dkDangSua && (dkDangSua.moldId !== moldId || dkDangSua.m !== m);
    if (khacViTri && dkLayChuan(moldId, m) && !confirm(`Khuôn ${moldId} trên ${dkTenMayDu(m)} đã có bản chuẩn. Ghi đè?`)) return;
    db.ref(path).set(rec).then(() => {
        if (dkModalChuan) dkModalChuan.hide();
        dkRender();
    }).catch(err => alert('❌ Không lưu được bản chuẩn: ' + err.message + '\n(Nếu báo "permission denied": cần mở quyền đọc/ghi nhánh ' + DK_PATH_CHUAN + ' trong Firebase Rules cho tài khoản đã đăng nhập.)'));
}

function dkXoaChuan() {
    if (!dkDangSua || !dkDangSua.coSan || !db) return;
    if (!confirm(`Xóa bản điều kiện chuẩn của khuôn ${dkDangSua.moldId} trên ${dkTenMayDu(dkDangSua.m)}?`)) return;
    db.ref(`${DK_PATH_CHUAN}/${getSafeFirebaseKey(dkDangSua.moldId)}/M${dkDangSua.m}`).remove()
        .then(() => { if (dkModalChuan) dkModalChuan.hide(); })
        .catch(err => alert('❌ Không xóa được: ' + err.message));
}

// ===================== 6. QC XÁC NHẬN ĐIỀU KIỆN =====================
function dkMoKiemTra(date, ca, m) {
    if (!checkAuthOrAlert()) return;
    let mold = dkKhuonDangChay(date, m, ca);
    let ck = mold ? dkChuanKiem(mold, m) : null;
    if (!ck) { alert('⚠️ Khuôn này chưa có bản điều kiện chuẩn trên máy nào.'); return; }
    let std = ck.std;
    let chk = dkLayCheck(date, m, ca, mold);
    let cur = dkNhacNgay.cur ? dkNhacNgay.cur[`M${m}_${ca}`] : null;
    let loai = chk ? chk.loai : ((cur && cur.mold === mold && cur.prev) ? 'doi_khuon' : 'dau_ca');
    dkDangKiem = { date, ca, m, mold, ck };
    let qcTen = (chk && chk.by) || (tab1Store[date] ? getShiftInspector(tab1Store[date], ca, m) : '') || '';
    if (!qcTen) { try { qcTen = localStorage.getItem('qc_dk_ten_qc') || ''; } catch (e) {} }
    let info = std.info || {};
    let el = dkTaoModal('dkKiemModal', '', '',
        `<span class="me-auto fw-bold small" id="dkKiemTong"></span>
         <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>
         <button type="button" class="btn btn-sm btn-3d-emerald px-4" onclick="dkLuuKiemTra()">💾 Lưu xác nhận</button>`, true);
    document.getElementById('dkKiemModalTitle').textContent = `📝 ĐIỀU KIỆN ÉP – ${dkTenMayDu(m)} · ${mold} · ${ca} ${dkNgayNgan(date)}`;
    let vals = (chk && chk.vals) || {};
    let hangTS = (p, s) => `
        <tr data-pid="${p.id}">
            <td class="text-start small ${p.tam ? 'fw-bold' : ''}">${p.tam ? '△ ' : ''}${p.ten} <span class="opacity-75">(${p.dv})</span></td>
            <td class="fw-bold ${s.xem ? 'opacity-75' : 'text-info'}">${dkChuText(p, s)}${s.xem ? '<br><small class="fw-normal">tham khảo</small>' : ''}</td>
            <td><input type="text" inputmode="decimal" class="form-control form-control-sm text-center fw-bold dk-v" data-pid="${p.id}"
                value="${vals[p.id] !== undefined ? vals[p.id] : ''}" oninput="dkCapNhatDong(this)"></td>
            <td class="dk-kq" style="width:44px;"></td></tr>`;
    let html = `${typeof dkAiThanh === 'function' ? dkAiThanh('kiem') : ''}
        <div class="row g-2 mb-2">
            <div class="col-7"><label class="small fw-bold">Tên QC kiểm</label>
                <input type="text" class="form-control form-control-sm fw-bold" id="dkKTen" value="${escapeHtml(qcTen)}"></div>
            <div class="col-5"><label class="small fw-bold">Loại kiểm</label>
                <select class="form-select form-select-sm fw-bold" id="dkKLoai">
                    <option value="dau_ca" ${loai !== 'doi_khuon' ? 'selected' : ''}>Đầu ca</option>
                    <option value="doi_khuon" ${loai === 'doi_khuon' ? 'selected' : ''}>Đổi khuôn / đổi mã hàng</option>
                </select></div>
        </div>
        ${ck.goc ? `
        <div class="alert alert-info py-2 px-2 small mb-2">
            <b>📋 ${dkTenMayDu(m)} chưa có bản chuẩn riêng – đang kiểm theo BẢN GỐC ${dkTenMayDu(ck.mGoc)}</b>${ck.stdGoc.goc ? ' ⭐' : ''}
            (cập nhật ${escapeHtml(String(ck.stdGoc.updatedAt || '').substring(0, 10))}).<br>
            • Nhiệt độ, nhiệt khuôn, sấy, thời gian bảo áp / bắn keo / làm mát, chu kỳ, trọng lượng SP: so như bình thường.<br>
            • Vị trí: ${!isNaN(ck.heSo) ? `đã quy đổi theo ĐK vít ${ck.vitGoc} mm (${dkTenMayDu(ck.mGoc)}) → ${ck.vitMay} mm (${dkTenMayDu(m)}).` : 'chỉ tham khảo – nhập ĐK vít 2 máy để quy đổi và so sánh.'}<br>
            • Áp suất, tốc độ, lực kẹp…: chỉ tham khảo, vẫn nhập số thực tế để lập bản riêng cho ${dkTenMayDu(m)}.
            <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
                <span>ĐK vít ${dkTenMayDu(ck.mGoc)}: <b>${ck.vitGoc > 0 ? ck.vitGoc + ' mm' : 'chưa có'}</b></span>
                <span>· ĐK vít ${dkTenMayDu(m)}:</span>
                <input type="text" inputmode="decimal" id="dkKVit" class="form-control form-control-sm text-center" style="width:80px;" value="${ck.vitMay > 0 ? ck.vitMay : ''}" placeholder="mm">
                <button type="button" class="btn btn-sm btn-outline-info py-0 px-2" onclick="dkApDungVit()">Áp dụng</button>
            </div>
        </div>` : ''}
        <div class="small mb-2 opacity-75">${[info.tenSP || info.maSP, info.nhua && ('Nhựa: ' + info.nhua), info.mau && ('Màu: ' + info.mau), info.cavity && ('Cavity: ' + info.cavity)].filter(Boolean).map(escapeHtml).join(' · ')}</div>`;
    let thamKhao = '';
    DK_NHOM.forEach(g => {
        let kiem = [], tk = [];
        g.ds.forEach(p => { let s = dkChuanCuaTS(std, p); if (!s) return; (s.kt ? kiem : tk).push([p, s]); });
        if (kiem.length) {
            let coThuong = kiem.some(x => !x[0].tam);
            html += `
            <div class="dk-nhom-kiem mb-2" data-nhom="${g.ma}">
                <div class="d-flex justify-content-between align-items-center py-1">
                    <span class="fw-bold text-info">${g.ten}</span>
                    ${coThuong ? `<button type="button" class="btn btn-sm btn-outline-success py-0 px-2 rounded-pill" style="font-size:11px;" onclick="dkNhomDungChuan('${g.ma}')" title="Điền giá trị chuẩn cho các thông số cài đặt của nhóm (không áp dụng cho thông số △)">✓ Cài đặt đúng chuẩn</button>` : ''}
                </div>
                <table class="table table-bordered table-sm align-middle text-center mb-0">
                    <thead><tr><th class="text-start">Thông số</th><th style="width:92px;">Chuẩn</th><th style="width:92px;">Thực tế</th><th></th></tr></thead>
                    <tbody>${kiem.map(x => hangTS(x[0], x[1])).join('')}</tbody>
                </table>
            </div>`;
        }
        if (tk.length) {
            thamKhao += `<div class="fw-bold small mt-2">${g.ten}</div><div class="small">` +
                tk.map(x => `${x[0].ten}: <b>${dkChuText(x[0], x[1])}</b> ${x[0].dv}`).join(' · ') + `</div>`;
        }
    });
    if (thamKhao) html += `<details class="mb-2"><summary class="fw-bold small text-info">Thông số tham khảo (không bắt buộc nhập)</summary>${thamKhao}</details>`;
    if (ck.goc) html += `
        <div class="form-check mb-2 p-2 border border-warning rounded-3">
            <input type="checkbox" class="form-check-input ms-0 me-2" id="dkKSpDau" ${chk && chk.spDauOK ? 'checked' : ''}>
            <label class="form-check-label small fw-bold" for="dkKSpDau">✅ Sản phẩm đầu tiên trên ${dkTenMayDu(m)} đã kiểm OK (trọng lượng trong dung sai, ngoại quan đạt) – bắt buộc khi kiểm theo bản gốc</label>
        </div>`;
    html += `<label class="small fw-bold">Ghi chú / xử lý khi NG</label>
        <textarea class="form-control form-control-sm" id="dkKGhiChu" rows="2" placeholder="Bắt buộc khi có thông số NG: đã báo ai, xử lý thế nào...">${escapeHtml((chk && chk.note) || '')}</textarea>`;
    document.getElementById('dkKiemModalBody').innerHTML = html;
    document.querySelectorAll('#dkKiemModalBody .dk-v').forEach(dkCapNhatDong);
    dkModalKiem = bootstrap.Modal.getOrCreateInstance(el);
    dkModalKiem.show();
}

function dkCapNhatDong(inp) {
    if (!dkDangKiem) return;
    let std = dkDangKiem.ck.std, p = dkThongSo(inp.dataset.pid), s = dkChuanCuaTS(std, p);
    let o = inp.closest('tr').querySelector('.dk-kq');
    let v = dkSo(inp.value);
    inp.classList.remove('is-valid', 'is-invalid');
    if (inp.value.trim() === '' || !s) o.innerHTML = '';
    else if (s.xem) o.innerHTML = '<span class="badge bg-secondary">TK</span>';
    else if (dkDat(p, s, v)) { o.innerHTML = '<span class="badge bg-success">OK</span>'; inp.classList.add('is-valid'); }
    else { o.innerHTML = '<span class="badge bg-danger">NG</span>'; inp.classList.add('is-invalid'); }
    let tat = [...document.querySelectorAll('#dkKiemModalBody .dk-v')];
    let daNhap = tat.filter(i => i.value.trim() !== '').length, ng = document.querySelectorAll('#dkKiemModalBody .dk-v.is-invalid').length;
    let tong = document.getElementById('dkKiemTong');
    if (tong) tong.innerHTML = `Đã nhập ${daNhap}/${tat.length}` + (ng ? ` · <span class="text-danger">${ng} NG</span>` : '');
}

function dkNhomDungChuan(maNhom) {
    if (!dkDangKiem) return;
    let std = dkDangKiem.ck.std;
    document.querySelectorAll(`#dkKiemModalBody .dk-nhom-kiem[data-nhom="${maNhom}"] .dk-v`).forEach(inp => {
        let p = dkThongSo(inp.dataset.pid), s = dkChuanCuaTS(std, p);
        if (!p || p.tam || !s || s.xem || inp.value.trim() !== '') return;
        inp.value = s.c;
        dkCapNhatDong(inp);
    });
}

async function dkLuuKiemTra() {
    if (!checkAuthOrAlert() || !db || !dkDangKiem) return;
    let { date, ca, m, mold, ck } = dkDangKiem;
    let std = ck.std;
    let ten = document.getElementById('dkKTen').value.trim();
    if (!ten) { alert('⚠️ Vui lòng nhập tên QC kiểm.'); return; }
    let vals = {}, ng = [], thieu = 0;
    document.querySelectorAll('#dkKiemModalBody .dk-v').forEach(inp => {
        let p = dkThongSo(inp.dataset.pid), s = dkChuanCuaTS(std, p), v = dkSo(inp.value);
        if (isNaN(v)) { thieu++; return; }
        vals[p.id] = v;
        if (s && !dkDat(p, s, v)) ng.push(p.id);
    });
    if (thieu) { alert(`⚠️ Còn ${thieu} thông số chưa nhập giá trị thực tế (hoặc không phải là số).`); return; }
    let note = document.getElementById('dkKGhiChu').value.trim();
    if (ng.length && !note) { alert('⚠️ Có thông số NG – vui lòng ghi chú cách xử lý / đã báo kỹ thuật.'); return; }
    let spDau = document.getElementById('dkKSpDau');
    if (ck.goc && !(spDau && spDau.checked)) { alert(`⚠️ Đang kiểm theo bản gốc ${dkTenMayDu(ck.mGoc)}: phải kiểm sản phẩm đầu tiên trên ${dkTenMayDu(m)} OK rồi tích xác nhận.`); return; }
    let rec = {
        moldId: mold, may: m, ca, loai: document.getElementById('dkKLoai').value, vals, ng,
        kq: ng.length ? 'NG' : 'OK', note, by: ten, email: (currentUser && currentUser.email) || '', at: new Date().toISOString()
    };
    if (ck.goc) {
        rec.theoGoc = `M${ck.mGoc}`; rec.spDauOK = true;
        if (!isNaN(ck.heSo)) { rec.heSo = Math.round(ck.heSo * 10000) / 10000; rec.vitGoc = ck.vitGoc; rec.vitMay = ck.vitMay; }
    }
    try {
        await db.ref(`${DK_PATH_CHECK}/${date}/M${m}_${ca}/${getSafeFirebaseKey(mold)}`).set(rec);
    } catch (err) {
        alert('❌ Không lưu được: ' + err.message + '\n(Nếu báo "permission denied": cần mở quyền đọc/ghi nhánh ' + DK_PATH_CHECK + ' trong Firebase Rules.)');
        return;
    }
    try { localStorage.setItem('qc_dk_ten_qc', ten); } catch (e) {}
    if (!dkChecks[date]) dkChecks[date] = {};
    if (!dkChecks[date][`M${m}_${ca}`]) dkChecks[date][`M${m}_${ca}`] = {};
    dkChecks[date][`M${m}_${ca}`][getSafeFirebaseKey(mold)] = rec;
    if (dkModalKiem) dkModalKiem.hide();
    dkRender();
    if (ng.length) {
        let nhom = dkNhomTheoMay(m);
        let dong = ng.map(pid => { let p = dkThongSo(pid), s = dkChuanCuaTS(std, p); return `  • ${p.ten}: thực tế ${vals[pid]} ${p.dv} (chuẩn ${dkChuText(p, s)})`; });
        dkXepTinZalo(nhom.ma, `🚨 [ĐIỀU KIỆN ÉP NG – ${nhom.xuong}]\n📅 ${dkNgayNgan(date)} · ${ca} · ${dkTenMay(m)} · Khuôn ${mold}`
            + (ck.goc ? ` (theo bản gốc ${dkTenMayDu(ck.mGoc)})` : '') + `\n👤 QC: ${ten}\n${dong.join('\n')}\n📝 ${note}`)
            .catch(e => console.warn('Không xếp được tin Zalo:', e));
    }
    // Kiểm theo bản gốc đạt + SP đầu OK -> đề nghị lưu số thực tế thành bản chuẩn riêng cho máy này
    if (ck.goc && !ng.length && confirm(`✅ Đã lưu xác nhận ${dkTenMayDu(m)} (theo bản gốc ${dkTenMayDu(ck.mGoc)}).\n\nLưu luôn các số thực tế vừa kiểm thành BẢN CHUẨN RIÊNG cho khuôn ${mold} trên ${dkTenMayDu(m)}?\n(Lần sau khuôn chạy ở ${dkTenMayDu(m)} sẽ so với bản này.)`))
        dkLuuThanhChuan(mold, m, ck, vals);
}

// Dựng bản chuẩn riêng cho máy m từ bản gốc + số thực tế QC vừa kiểm (đã xác nhận SP đầu OK)
function dkTaoChuanTuKiem(mold, m, ck, vals, nguoi) {
    let ts = {};
    Object.keys(ck.stdGoc.ts || {}).forEach(pid => {
        let g = ck.stdGoc.ts[pid], loai = dkLoaiTS(pid), cGoc = dkSo(g.c), dGoc = dkSo(g.d);
        if (isNaN(cGoc)) return;
        let quyDoi = loai === 'vitri' && !isNaN(ck.heSo);
        let d = isNaN(dGoc) ? 0 : (quyDoi ? dkLam1(dGoc * ck.heSo) : dGoc);
        let c;
        if (vals[pid] !== undefined) c = vals[pid];                       // số thực tế đang chạy OK
        else if (loai === 'khuon') c = cGoc;                              // thuộc khuôn: giống bản gốc
        else if (quyDoi) c = dkLam1(cGoc * ck.heSo);                     // vị trí quy đổi theo ĐK vít
        else return;                                                      // thuộc máy, không đo -> kỹ thuật bổ sung sau
        ts[pid] = { c, d, kt: g.kt !== undefined ? !!g.kt : !!(dkThongSo(pid) || {}).kt };
    });
    let info = Object.assign({}, ck.stdGoc.info || {});
    delete info.model;
    if (ck.vitMay > 0) info.dkVit = String(ck.vitMay); else delete info.dkVit;
    info.ghiChu = `Lập từ bản gốc ${dkTenMayDu(ck.mGoc)} + số thực tế QC kiểm (SP đầu OK)` + (info.ghiChu ? ' · ' + info.ghiChu : '');
    return { moldId: mold, may: m, info, ts, tuGoc: `M${ck.mGoc}`, updatedAt: new Date().toISOString(), updatedBy: nguoi || '' };
}
function dkLuuThanhChuan(mold, m, ck, vals) {
    if (!db) return;
    if (dkLayChuan(mold, m) && !confirm(`Khuôn ${mold} trên ${dkTenMayDu(m)} đã có bản chuẩn. Ghi đè?`)) return;
    let rec = dkTaoChuanTuKiem(mold, m, ck, vals, (currentUser && currentUser.email) || '');
    db.ref(`${DK_PATH_CHUAN}/${getSafeFirebaseKey(mold)}/M${m}`).set(rec)
        .then(() => { alert(`✅ Đã lưu bản chuẩn riêng cho ${mold} trên ${dkTenMayDu(m)} (${Object.keys(rec.ts).length} thông số).\nKỹ thuật vào "📄 Đã có · sửa" để soát lại và bổ sung thông số đóng/mở/đẩy nếu cần.`); dkRender(); })
        .catch(err => alert('❌ Không lưu được bản chuẩn: ' + err.message));
}
function dkApDungVit() {
    if (!dkDangKiem) return;
    let v = dkSo((document.getElementById('dkKVit') || {}).value);
    if (!(v > 0)) { alert('⚠️ Nhập đường kính vít (mm) của máy này.'); return; }
    try { localStorage.setItem('qc_dk_vit_M' + dkDangKiem.m, String(v)); } catch (e) {}
    // giữ các số đã nhập, mở lại bảng kiểm với chuẩn vị trí đã quy đổi
    let daNhap = {};
    document.querySelectorAll('#dkKiemModalBody .dk-v').forEach(i => { if (i.value.trim() !== '') daNhap[i.dataset.pid] = i.value; });
    let ten = (document.getElementById('dkKTen') || {}).value, note = (document.getElementById('dkKGhiChu') || {}).value;
    let { date, ca, m } = dkDangKiem;
    dkMoKiemTra(date, ca, m);
    document.querySelectorAll('#dkKiemModalBody .dk-v').forEach(i => { if (daNhap[i.dataset.pid] !== undefined) { i.value = daNhap[i.dataset.pid]; dkCapNhatDong(i); } });
    if (ten) document.getElementById('dkKTen').value = ten;
    if (note) document.getElementById('dkKGhiChu').value = note;
}

// ===================== 7. BỘ NHẮC VIỆC ZALO =====================
// Xếp 1 tin vào hộp chờ gửi Zalo (máy Hải Tân AI Control sẽ lấy và gửi vào nhóm)
function dkXepTinZalo(maNhom, text) {
    let nhom = DK_NHOM_ZALO[maNhom];
    if (!nhom || !db) return Promise.reject(new Error('Thiếu nhóm Zalo'));
    return db.ref(`${DK_PATH_NHAC}/${dkCaHienTai().date}/gui`).push({
        nhom: nhom.ma, tenNhom: nhom.nhom, text: String(text).substring(0, 2500), at: Date.now(),
        by: (currentUser && currentUser.email) || '', tt: 'cho', lan: 0
    });
}

async function dkNhacGiuCho(date, id, now) {
    // Giữ chỗ "đã nhắc" bằng transaction: nhiều thiết bị cùng mở cũng chỉ 1 thiết bị gửi
    let ref = db.ref(`${DK_PATH_NHAC}/${date}/log/${getSafeFirebaseKey(id).replace(/\s+/g, '_')}`);
    let r = await ref.transaction(cur => cur ? undefined : { at: now, by: (currentUser && currentUser.email) || '' });
    return !!r.committed;
}

async function dkNhacTick() {
    if (dkNhacBusy || !isEditMode || !isConnected || !db || !currentUser || !dkNhacBat()) return;
    dkNhacBusy = true;
    try {
        let now = Date.now(), ht = dkCaHienTai(new Date(now)), date = ht.date, ca = ht.ca;
        let doc = p => db.ref(p).once('value').then(s => s.val() || {});
        let [nhac, checks, t1, t2, act] = await Promise.all([
            doc(`${DK_PATH_NHAC}/${date}`), doc(`${DK_PATH_CHECK}/${date}`),
            doc(`qc_tab1_store_v1/${date}`), doc(`qc_tab2_store_v1/${date}`), doc(`qc_tab3_actions_v1/${date}`)
        ]);
        if (!nhac.cur) nhac.cur = {};
        let log = nhac.log || {};
        let daNhac = id => !!log[getSafeFirebaseKey(id).replace(/\s+/g, '_')];
        let viec = { X1: { dk: [], h2: [], m4: [] }, X2: { dk: [], h2: [], m4: [] } };
        let ungVien = [];   // { id, nhom, loai, dong }

        if (typeof mesSyncActive !== 'undefined' && mesSyncActive) {
            // Khung giờ kiểm 2h hiện tại
            let slots = ca === 'Ca Ngày' ? QC_SLOTS_DAY : QC_SLOTS_NIGHT;
            let idx = Math.min(slots.length - 1, Math.max(0, Math.floor((now - ht.batDau) / 7200000)));
            let slot = slots[idx], slotBatDau = ht.batDau + idx * 7200000;
            let thieu2h = { X1: [], X2: [] };

            for (let m = 1; m <= TOTAL_MACHINES; m++) {
                let mold = dkKhuonDangChay(date, m, ca);
                if (!mold) continue;
                let key = `M${m}_${ca}`, nhom = dkNhomTheoMay(m).ma;
                let cur = nhac.cur[key];
                if (!cur || cur.mold !== mold) {
                    // Lần đầu thấy trong ca -> tính hạn từ đầu ca; MES đổi sang khuôn khác -> tính hạn từ lúc này
                    let r = await db.ref(`${DK_PATH_NHAC}/${date}/cur/${key}`).transaction(c => {
                        if (!c) return { mold, since: ht.batDau };
                        if (c.mold !== mold) return { mold, since: now, prev: c.mold };
                        return undefined;
                    });
                    cur = r.snapshot.val() || { mold, since: ht.batDau };
                    nhac.cur[key] = cur;
                }
                // (a) Điều kiện ép
                let moldKey = getSafeFirebaseKey(mold);
                let daKiem = checks[key] && checks[key][moldKey];
                if (!daKiem && now > cur.since + DK_HAN_PHUT * 60000) {
                    let id = `DK_${key}_${moldKey}`;
                    if (!daNhac(id)) ungVien.push({ id, nhom, loai: 'dk',
                        dong: `  • ${dkTenMay(m)} – khuôn ${mold}` + (cur.prev ? ` (đổi khuôn lúc ${dkGio(cur.since)})` : '') + (dkLayChuan(mold, m) ? '' : (dkLayChuanGoc(mold, m) ? ` – 📋 chưa có bản riêng, kiểm theo bản gốc ${dkTenMay(dkLayChuanGoc(mold, m).m)} (kỹ thuật cần lập bản cho ${dkTenMay(m)})` : ' – ⚠️ chưa có bản điều kiện chuẩn')) });
                }
                // (b) Kiểm SP định kỳ 2 giờ/lần
                let rec2 = t2[`${key}_${slot}`];
                if (!(rec2 && (parseInt(rec2.totalCheck) || 0) > 0) && now > slotBatDau + DK_HAN_PHUT * 60000) thieu2h[nhom].push(`${dkTenMay(m)}`);
            }
            ['X1', 'X2'].forEach(nhom => {
                if (!thieu2h[nhom].length) return;
                let id = `2H_${ca}_${slot}_${nhom}`;
                if (!daNhac(id)) ungVien.push({ id, nhom, loai: 'h2', dong: `  • Khung ${getSlotRangeText(slot)}: ${thieu2h[nhom].join(', ')}` });
            });
            dkNhacNgay = nhac;
        }

        // (c) Ảnh lỗi chưa có đối sách 4M (Tab 1 + Tab 2)
        let xet4M = (tien, key, rec, laNG, moTa) => {
            if (!rec || typeof rec !== 'object' || key.endsWith('_inspector') || !laNG) return;
            let k = `${tien}_${key}`;
            let coAnh = rec.driveUrl || rec.driveFile || act[`${k}_drive_url`] || act[`${k}_drive_file`];
            if (!coAnh || qcDu4M(act[`${k}_4m`])) return;
            let tg = act[`${k}_img_time`] ? new Date(act[`${k}_img_time`]).getTime() : 0;
            if (tg && now <= tg + DK_HAN_PHUT * 60000) return;
            let p = key.split('_'), m = parseInt(String(p[0]).replace('M', '')) || 0;
            if (m < 1 || m > TOTAL_MACHINES) return;
            let id = `4M_${k}`;
            if (!daNhac(id)) ungVien.push({ id, nhom: dkNhomTheoMay(m).ma, loai: 'm4',
                dong: `  • ${p[0]} ${p[1] || ''}${p[2] ? ' [' + p[2] + ']' : ''} – khuôn ${rec.moldId || '?'}: ${String(moTa || '').substring(0, 80)}` });
        };
        Object.keys(t1).forEach(k => { let r = t1[k]; xet4M('T1', k, r, r && (r.moldCheckOverall === 'NG' || r.result === 'NG'), r && (r.note || 'Lỗi kiểm tra đầu ca')); });
        Object.keys(t2).forEach(k => {
            let r = t2[k]; if (!r || typeof r !== 'object') return;
            let tong = parseInt(r.totalCheck) || 0, loi = parseInt(r.defectCheck) || 0;
            xet4M('T2', k, r, r.overall === 'NG' || loi > 0 || (tong > 0 && loi / tong > 0.2), r.note || `Lỗi ${loi}/${tong} SP`);
        });

        for (let u of ungVien) {
            if (await dkNhacGiuCho(date, u.id, now)) viec[u.nhom][u.loai].push(u.dong);
        }
        for (let ma of ['X1', 'X2']) {
            let v = viec[ma], nhom = DK_NHOM_ZALO[ma];
            if (!v.dk.length && !v.h2.length && !v.m4.length) continue;
            let msg = `⏰ [NHẮC VIỆC QC – ${nhom.xuong}]\n📅 ${dkNgayNgan(date)} · ${ca} · ${dkGio(now)}`;
            if (v.dk.length) msg += `\n🔧 Chưa xác nhận ĐIỀU KIỆN ÉP (quá ${DK_HAN_PHUT} phút):\n` + v.dk.join('\n');
            if (v.h2.length) msg += `\n📋 Chưa kiểm SP định kỳ 2 giờ/lần (quá ${DK_HAN_PHUT} phút):\n` + v.h2.join('\n');
            if (v.m4.length) msg += `\n🚨 Có ảnh lỗi nhưng chưa có đối sách 4M:\n` + v.m4.join('\n');
            msg += `\n👉 QC vui lòng cập nhật ngay trên phần mềm QC.`;
            await dkXepTinZalo(ma, msg);
        }
        let cn = await doc(`${DK_PATH_NHAC}/cau_noi`);
        dkCauNoiLuc = cn.at || 0;
        dkNhacLoi = '';
    } catch (e) {
        console.warn('Bộ nhắc việc Zalo lỗi:', e);
        dkNhacLoi = /permission/i.test(String(e && e.message))
            ? 'Bộ nhắc việc chưa chạy được: cần mở quyền đọc/ghi các nhánh ' + DK_PATH_CHECK + ' và ' + DK_PATH_NHAC + ' trong Firebase Rules.'
            : 'Bộ nhắc việc lỗi: ' + (e && e.message);
    } finally {
        dkNhacBusy = false;
        dkRender();
    }
}

// ===================== 8. CẦU NỐI VỚI "HẢI TÂN AI CONTROL" (máy gửi Zalo) =====================
// Các hàm dưới đây do phần mềm trên máy tính gọi (Playwright page.evaluate) – không dùng trên giao diện.
function qcCauNoiTrangThai() {
    return {
        cauNoi: true, dangNhap: !!(isEditMode && currentUser), email: (currentUser && currentUser.email) || '',
        mes: !!(typeof mesSyncActive !== 'undefined' && mesSyncActive), mesTrangThai: (typeof mesState !== 'undefined' && mesState.status) || '',
        loi: dkNhacLoi || ''
    };
}

// Chạy 1 lượt kiểm tra rồi trả về các tin cần gửi (đã giữ chỗ để không máy nào khác gửi trùng)
async function qcCauNoiChay(tenMay) {
    if (!isEditMode || !currentUser || !db) return { ok: false, loi: 'chua_dang_nhap', tin: [] };
    try { localStorage.setItem('qc_nhac_zalo_bat', '1'); } catch (e) {}
    if (typeof mesRefresh === 'function') { try { await mesRefresh(false); } catch (e) {} }
    await dkNhacTick();
    let now = Date.now(), ht = dkCaHienTai(new Date(now));
    let homQua = new Date(now - 86400000);
    let ngay = [...new Set([ht.date, dkISO(new Date(now)), dkISO(homQua)])];
    let tin = [];
    for (let date of ngay) {
        let ds = (await db.ref(`${DK_PATH_NHAC}/${date}/gui`).once('value')).val() || {};
        for (let id of Object.keys(ds)) {
            let t = ds[id];
            if (!t || typeof t !== 'object') continue;
            let ket = t.tt === 'dang_gui' && now - (t.lay || 0) > 15 * 60000;      // máy gửi chết giữa chừng -> lấy lại
            if (t.tt !== 'cho' && !ket) continue;
            let ref = db.ref(`${DK_PATH_NHAC}/${date}/gui/${id}`);
            if (now - (t.at || 0) > DK_TIN_QUA_HAN_PHUT * 60000) { await ref.update({ tt: 'qua_han' }); continue; }
            // LƯU Ý Firebase: lần gọi đầu tiên của transaction thường nhận null (dữ liệu chưa có trong bộ nhớ đệm).
            // Phải trả về null (không phải undefined) để Firebase đọc giá trị thật từ máy chủ rồi gọi lại –
            // trả undefined sẽ HỦY transaction, khiến tin nằm mãi ở trạng thái "cho".
            let r = await ref.transaction(c => {
                if (!c) return c;
                if (!(c.tt === 'cho' || (c.tt === 'dang_gui' && now - (c.lay || 0) > 15 * 60000))) return undefined;
                c.tt = 'dang_gui'; c.lay = now; return c;
            });
            if (r.committed) tin.push({ date, id, nhom: t.nhom, tenNhom: t.tenNhom, text: t.text });
        }
    }
    await db.ref(`${DK_PATH_NHAC}/cau_noi`).set({ at: now, may: String(tenMay || 'AI Control').substring(0, 60) });
    return Object.assign({ ok: true, tin }, qcCauNoiTrangThai());
}

// Máy gửi Zalo báo kết quả: ok -> đã gửi; lỗi -> trả về hộp chờ (tối đa 3 lần)
async function qcCauNoiXong(date, id, ok, loi) {
    let ref = db.ref(`${DK_PATH_NHAC}/${date}/gui/${id}`);
    await ref.transaction(c => {
        if (!c) return c;   // null lần đầu = chưa có bộ nhớ đệm -> để Firebase đọc lại từ máy chủ
        if (ok) { c.tt = 'da_gui'; c.guiLuc = Date.now(); }
        else { c.lan = (c.lan || 0) + 1; c.tt = c.lan >= 3 ? 'loi' : 'cho'; c.loi = String(loi || '').substring(0, 300); }
        return c;
    });
    return true;
}
