/**
 * QC System - Tab 7: KIỂM TRA KIỆN HÀNG ĐẦU TIÊN (首件检查报告)
 * Xưởng Ép Nhựa Hải Tân
 *
 * Theo mẫu giấy "BÁO CÁO KIỂM TRA KIỆN HÀNG ĐẦU TIÊN" – in khổ A5, ký tay sau khi in.
 *  - Phiếu tự tạo (trạng thái "chờ kiểm") khi: LÊN KHUÔN (PM ép nhựa đổi mã khuôn so với ca trước hoặc trong ca),
 *    ĐỔI MÀU / LÔ LIỆU (màu đơn hàng đổi). Không kiểm theo đầu ca.
 *    Sửa khuôn / chạy lại: bấm "➕ Tạo phiếu".
 *  - Phần sản xuất: lấy từ PM ép nhựa (danh mục khuôn + đơn hàng): khách hàng, mã đơn, tên SP, màu, nhựa.
 *  - Phần QC: Ngoại quan · Màu sắc · Kích thước (đo theo mẫu kích thước của khuôn) · Lắp ráp · Thông số máy (lấy kết quả Tab 6)
 *    + mục kiểm riêng của khuôn + ảnh.
 *  - Không đạt: gửi Zalo cảnh báo ngay, lập đối sách 4M (dùng chung phiếu 4M Tab 3), sau khi chỉnh máy tạo phiếu "Chạy lại".
 *  - Chặn Tab 2: máy có phiếu của khuôn đang chạy mà phiếu mới nhất chưa ĐẠT thì không nhập được kiểm 2 giờ.
 *  - Nhắc Zalo: phiếu chưa kiểm quá 30 phút; phiếu không đạt chưa có đối sách 4M quá 30 phút.
 *
 * Firebase:
 *   qc_fai_v1/{ngày}/{id phiếu}       – phiếu
 *   qc_fai_mau_v1/{mã khuôn}          – mẫu kiểm của khuôn: danh sách kích thước + mục kiểm riêng
 *   qc_fai_cfg_v1                     – { chanTab2: true/false, batDau: 'YYYY-MM-DD' }
 */

const FAI_PATH = 'qc_fai_v1';
const FAI_PATH_MAU = 'qc_fai_mau_v1';
const FAI_PATH_CFG = 'qc_fai_cfg_v1';
const FAI_HAN_PHUT = 30;
const FAI_BAT_DAU_MAC_DINH = '2026-11-13';   // ngày bắt đầu áp dụng (trước ngày này không chặn Tab 2, không nhắc)

const FAI_LY_DO = {
    dau_ca:    { ten: 'Đầu ca',               zh: '', an: true },   // không dùng nữa – giữ để hiện phiếu cũ
    len_khuon: { ten: 'Lên khuôn',            zh: '' },
    doi_mau:   { ten: 'Đổi màu / đổi lô liệu', zh: '' },
    sua_khuon: { ten: 'Sửa khuôn',            zh: '' },
    chay_lai:  { ten: 'Chạy lại',             zh: '' }
};
// 5 mục kiểm cố định của mẫu giấy
const FAI_MUC = [
    { ma: 'ngoai',  ten: 'Ngoại quan', zh: '外观' },
    { ma: 'mau',    ten: 'Màu sắc',    zh: '颜色' },
    { ma: 'kt',     ten: 'Kích thước', zh: '尺寸' },
    { ma: 'lapRap', ten: 'Lắp ráp',    zh: '装配' },
    { ma: 'tsMay',  ten: 'Thông số máy', zh: '参数' }
];

let faiStore = {};          // ngày -> { id -> phiếu }
let faiNgheNgay = {};       // ngày đang nghe realtime
let faiMau = {};            // mã khuôn (key an toàn) -> mẫu
let faiCfg = { chanTab2: true, batDau: FAI_BAT_DAU_MAC_DINH };
let faiBound = false;
let faiTimer = null;
let faiBusy = false;
let faiXem = { date: '', xuong: 'ALL', ca: 'ALL' };
let faiDangSua = null;      // { date, id, rec }
let faiAnhTam = [];         // ảnh mới chụp trong phiếu đang mở: [{ file, data }]
let faiModal = null, faiModalMau = null;
let faiAct = {};            // ngày -> qc_tab3_actions_v1 (để biết đối sách 4M)

// ===================== 0. TIỆN ÍCH =====================
function faiCaKey(ca) { return String(ca).includes('Đêm') ? 'Dem' : 'Ngay'; }
function faiNhom(m) { return typeof dkNhomTheoMay === 'function' ? dkNhomTheoMay(m) : { ma: m >= 11 ? 'X1' : 'X2', xuong: m >= 11 ? 'XƯỞNG 1 (M1-M11)' : 'XƯỞNG 2 (M1-M10)' }; }
function faiToSX(m) { return (parseInt(m) || 0) >= 11 ? 'Xưởng 1 (M1–M11)' : 'Xưởng 2 (M1–M10)'; }
function faiSo(v) { let n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.')); return isNaN(n) ? NaN : n; }
function faiKhoaMau(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function faiDsNgay(date) { let o = faiStore[date] || {}; return Object.keys(o).map(id => Object.assign({ id }, o[id])).filter(r => r && r.may && !r.daXoa); }
// Lý do hiển thị trong danh sách chọn (bỏ "Đầu ca")
function faiLyDoChon() { return Object.keys(FAI_LY_DO).filter(k => !FAI_LY_DO[k].an); }
// Khuôn chạy gần nhất trên máy trước ca này (lùi tối đa 4 ca) – để biết đầu ca có phải vừa thay khuôn không
function faiKhuonCaTruoc(date, ca, m) {
    let d = date, c = ca;
    for (let i = 0; i < 4; i++) {
        if (c === 'Ca Ngày') { let x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); d = dkISO(x); c = 'Ca Đêm'; }
        else c = 'Ca Ngày';
        let k = dkKhuonDangChay(d, m, c);
        if (k) return k;
    }
    return '';
}
function faiDoc(p) { return db.ref(p).once('value').then(s => s.val() || {}); }
function faiCa(date, ca) { let ht = dkCaHienTai(); return date === ht.date && ca === ht.ca; }

// Phiếu mới nhất của máy + ca + khuôn (theo giờ tạo)
function faiPhieuMoiNhat(date, m, ca, mold) {
    let ds = faiDsNgay(date).filter(r => parseInt(r.may) === parseInt(m) && r.ca === ca && String(r.moldId || '') === String(mold || ''));
    ds.sort((a, b) => (b.taoLuc || 0) - (a.taoLuc || 0));
    return ds[0] || null;
}

// ===================== 1. ĐƠN HÀNG TỪ PM ÉP NHỰA =====================
// Đơn đang chạy của khuôn: ưu tiên đơn giao đúng máy, chưa xong, không tạm dừng; mới nhất trước
function faiDonHang(mold, m) {
    let ds = (typeof mesOrders !== 'undefined' && Array.isArray(mesOrders)) ? mesOrders : [];
    let t = String(mold || '').trim().toLowerCase();
    ds = ds.filter(o => o && String(o.moldId || '').trim().toLowerCase() === t);
    if (!ds.length) return null;
    let soMay = o => String(o.assignedMachine || '').replace(/\D/g, '');
    let diem = o => (o.isCompleted ? 0 : 4) + (o.isPaused ? 0 : 2) + (soMay(o) === String(parseInt(m)) ? 1 : 0);
    ds.sort((a, b) => diem(b) - diem(a) || String(b.startDate || '').localeCompare(String(a.startDate || '')));
    return ds[0];
}
// Thông tin phần sản xuất lấy từ MES
function faiThongTinSX(mold, m) {
    let k = typeof dkThongTinMes === 'function' ? dkThongTinMes(mold) : {};
    let d = faiDonHang(mold, m) || {};
    return {
        to: faiToSX(m),
        khach: String(d.customer || '').trim(),
        donHang: String(d.id || '').trim(),
        tenSP: k.tenSP || String(d.partName || '').trim(),
        maSP: k.maSP || '',
        mau: String(d.colorNote || '').trim() || k.mau || '',
        nhua: String(d.resinType || '').trim() || k.nhua || ''
    };
}

// ===================== 2. KHỞI ĐỘNG / NGHE DỮ LIỆU =====================
function faiKhoiDong() {
    if (!isConnected || !db || !isEditMode) return;
    if (!faiBound) {
        faiBound = true;
        db.ref(FAI_PATH_CFG).on('value', s => { faiCfg = Object.assign({ chanTab2: true, batDau: FAI_BAT_DAU_MAC_DINH }, s.val() || {}); faiRender(); faiVeLaiTab2(); });
        db.ref(FAI_PATH_MAU).on('value', s => { faiMau = s.val() || {}; });
    }
    let ht = dkCaHienTai();
    if (!faiXem.date) faiXem.date = ht.date;
    faiNghe(ht.date);
    faiNghe(faiXem.date);
    if (!faiTimer) {
        faiTimer = setInterval(faiTick, 120000);
        setTimeout(faiTick, 20000);
    }
    faiRender();
}
function faiStop() {
    if (db) {
        try { db.ref(FAI_PATH_CFG).off(); db.ref(FAI_PATH_MAU).off(); } catch (e) {}
        Object.keys(faiNgheNgay).forEach(d => { try { db.ref(`${FAI_PATH}/${d}`).off(); } catch (e) {} });
    }
    if (faiTimer) { clearInterval(faiTimer); faiTimer = null; }
    faiBound = false; faiNgheNgay = {}; faiStore = {}; faiMau = {};
}
function faiNghe(date) {
    if (!date || faiNgheNgay[date] || !db) return;
    faiNgheNgay[date] = true;
    db.ref(`${FAI_PATH}/${date}`).on('value', s => {
        faiStore[date] = s.val() || {};
        faiRender();
        faiVeLaiTab2();
        if (typeof debouncedRenderTab3 === 'function' && Object.values(faiStore[date]).some(r => r && r.trangThai === 'khong_dat')) debouncedRenderTab3();
    }, err => { console.warn('Không đọc được phiếu kiểm hàng đầu tiên', err); delete faiNgheNgay[date]; });
}
function faiVeLaiTab2() { if (typeof debouncedRenderTab2 === 'function') debouncedRenderTab2(); }

// ===================== 3. TỰ TẠO PHIẾU + NHẮC VIỆC =====================
// Tạo phiếu "chờ kiểm" nếu chưa có (id cố định -> nhiều thiết bị cùng chạy cũng chỉ 1 phiếu)
async function faiTaoPhieuTuDong(date, ca, m, mold, lyDo, mauDon, sinceMs) {
    let id = `${faiCaKey(ca)}_M${m}_${getSafeFirebaseKey(mold)}_${lyDo}` + (lyDo === 'doi_mau' ? '_' + (faiKhoaMau(mauDon) || 'x') : '');
    let rec = faiPhieuMoi(date, ca, m, mold, lyDo, true);
    if (sinceMs) rec.taoLuc = sinceMs;
    let r = await db.ref(`${FAI_PATH}/${date}/${id}`).transaction(c => (c === null ? rec : undefined));
    return r.committed;
}
function faiPhieuMoi(date, ca, m, mold, lyDo, tuDong) {
    let now = Date.now();
    let sx = faiThongTinSX(mold, m);
    let stt = Object.values(faiStore[date] || {}).filter(r => r && parseInt(r.may) === parseInt(m)).length + 1;
    let p = String(date).split('-');
    return {
        soPhieu: `FAI-${p[0].slice(2)}${p[1]}${p[2]}-${qcTenMayGon(m).replace('-', '')}-${String(stt).padStart(2, '0')}${tuDong ? '' : 'T'}`,
        date, ca, may: parseInt(m), moldId: mold, lyDo, tuDong: !!tuDong,
        taoLuc: now, taoBoi: (currentUser && currentUser.email) || '',
        sx: Object.assign(sx, { slKiem: '', loai: 'TP' }),
        trangThai: 'cho'
    };
}

async function faiTick() {
    if (faiBusy || !isEditMode || !isConnected || !db || !currentUser) return;
    if (typeof dkNhacBat === 'function' && !dkNhacBat()) return;
    faiBusy = true;
    try {
        let now = Date.now(), ht = dkCaHienTai(new Date(now)), date = ht.date, ca = ht.ca;
        if (date < (faiCfg.batDau || FAI_BAT_DAU_MAC_DINH)) return;
        faiNghe(date);
        let ds = await faiDoc(`${FAI_PATH}/${date}`);
        faiStore[date] = ds;
        let nhacCur = (await faiDoc(`${DK_PATH_NHAC}/${date}/cur`)) || {};

        // (a) Tự tạo phiếu: lên khuôn (đổi khuôn trong ca, hoặc khuôn đầu ca khác khuôn ca trước) / đổi màu
        if (typeof mesSyncActive !== 'undefined' && mesSyncActive) {
            for (let m = 1; m <= TOTAL_MACHINES; m++) {
                let mold = dkKhuonDangChay(date, m, ca);
                if (!mold) continue;
                let cur = nhacCur[`M${m}_${ca}`];
                let cuaKhuon = faiDsNgay(date).filter(r => parseInt(r.may) === m && r.ca === ca && r.moldId === mold);
                let coPhieuXoa = Object.values(faiStore[date] || {}).some(r => r && r.daXoa && parseInt(r.may) === m && r.ca === ca && r.moldId === mold);
                if (!cuaKhuon.length) {
                    if (coPhieuXoa) continue;                                   // đã xóa phiếu của khuôn này -> không tạo lại
                    let since = 0;
                    if (cur && cur.mold === mold && cur.prev) since = cur.since;          // đổi khuôn giữa ca
                    else {
                        let truoc = faiKhuonCaTruoc(date, ca, m);
                        if (truoc && truoc !== mold) since = ht.batDau;                     // đầu ca đã là khuôn mới
                    }
                    if (since) await faiTaoPhieuTuDong(date, ca, m, mold, 'len_khuon', '', since);
                    continue;
                }
                // Đổi màu: màu đơn hàng hiện tại khác màu ghi trên phiếu gần nhất
                let mauNay = faiThongTinSX(mold, m).mau;
                cuaKhuon.sort((a, b) => (b.taoLuc || 0) - (a.taoLuc || 0));
                let mauCu = (cuaKhuon[0].sx && cuaKhuon[0].sx.mau) || '';
                if (mauNay && mauCu && faiKhoaMau(mauNay) !== faiKhoaMau(mauCu))
                    await faiTaoPhieuTuDong(date, ca, m, mold, 'doi_mau', mauNay, now);
            }
            ds = await faiDoc(`${FAI_PATH}/${date}`);
            faiStore[date] = ds;
        }

        // (b) Nhắc: chưa kiểm quá 30 phút; không đạt chưa có 4M quá 30 phút
        let act = await faiDoc(`qc_tab3_actions_v1/${date}`);
        faiAct[date] = act;
        let viec = { X1: { cho: [], m4: [] }, X2: { cho: [], m4: [] } };
        for (let id of Object.keys(ds)) {
            let r = ds[id];
            if (!r || !r.may || r.ca !== ca) continue;
            // phiếu của khuôn không còn chạy trên máy -> bỏ qua
            if (r.trangThai === 'cho' && dkKhuonDangChay(date, r.may, ca) && dkKhuonDangChay(date, r.may, ca) !== r.moldId) continue;
            let nhom = faiNhom(r.may).ma;
            if (r.trangThai === 'cho' && now > (r.taoLuc || 0) + FAI_HAN_PHUT * 60000) {
                if (await dkNhacGiuCho(date, `FAI_${id}`, now))
                    viec[nhom].cho.push(`  • ${qcTenMay(r.may)} – khuôn ${r.moldId} (${(FAI_LY_DO[r.lyDo] || {}).ten || r.lyDo}, từ ${dkGio(r.taoLuc)})`);
            }
            if (r.trangThai === 'khong_dat' && !qcDu4M(act[`FAI_${id}_4m`]) && now > ((r.qc && r.qc.kiemLuc) || 0) + FAI_HAN_PHUT * 60000) {
                if (await dkNhacGiuCho(date, `FAI4M_${id}`, now))
                    viec[nhom].m4.push(`  • ${qcTenMay(r.may)} – khuôn ${r.moldId} – phiếu ${r.soPhieu}`);
            }
        }
        for (let ma of ['X1', 'X2']) {
            let v = viec[ma];
            if (!v.cho.length && !v.m4.length) continue;
            let msg = `⏰ [NHẮC VIỆC QC – ${DK_NHOM_ZALO[ma].xuong}]\n📅 ${dkNgayNgan(date)} · ${ca} · ${dkGio(now)}`;
            if (v.cho.length) msg += `\n🧪 Chưa KIỂM HÀNG ĐẦU TIÊN (quá ${FAI_HAN_PHUT} phút) – Tab 2 đang bị khóa ở các máy này:\n` + v.cho.join('\n');
            if (v.m4.length) msg += `\n🚨 Hàng đầu tiên KHÔNG ĐẠT chưa có đối sách 4M:\n` + v.m4.join('\n');
            msg += `\n👉 QC vui lòng cập nhật ngay ở Tab 7 phần mềm QC.`;
            await dkXepTinZalo(ma, msg);
        }
    } catch (e) {
        console.warn('Tab 7 – lỗi tự tạo phiếu / nhắc việc:', e);
    } finally {
        faiBusy = false;
        faiRender();
    }
}

// ===================== 4. CHẶN TAB 2 =====================
// Trả về lý do chặn (chuỗi) hoặc '' nếu được nhập
function faiLyDoChanTab2(date, m, ca, mold) {
    if (!faiCfg || faiCfg.chanTab2 === false) return '';
    if (!mold || !date || date < (faiCfg.batDau || FAI_BAT_DAU_MAC_DINH)) return '';
    faiNghe(date);
    if (!faiStore[date]) return '';            // chưa tải xong -> không chặn nhầm
    let p = faiPhieuMoiNhat(date, m, ca, mold);
    if (!p || p.trangThai === 'dat') return '';   // không thay khuôn -> không cần phiếu
    if (p.trangThai === 'khong_dat') return '🔒 Hàng đầu tiên KHÔNG ĐẠT – chỉnh máy rồi kiểm lại (Tab 7)';
    return '🔒 Chờ KIỂM HÀNG ĐẦU TIÊN (Tab 7)';
}
// Gọi từ renderTab2 cho từng dòng
function faiChanDongTab2(tr, date, m, ca, mold) {
    let lyDo = faiLyDoChanTab2(date, m, ca, mold);
    if (!lyDo) return;
    tr.classList.add('fai-khoa');
    tr.title = lyDo;
    tr.querySelectorAll('select, input').forEach(el => {
        if (el.classList.contains('t2-shift-inspector')) return;
        el.disabled = true;
    });
    tr.querySelectorAll('label.btn').forEach(el => { el.style.pointerEvents = 'none'; el.style.opacity = '.4'; });
    let note = tr.querySelector('.t2-note');
    if (note) { note.value = note.value || ''; note.placeholder = lyDo; note.classList.add('border-danger'); }
    let o = tr.querySelector('.t2-overall-cell');
    if (o) o.innerHTML = `<span class="badge bg-secondary" title="${escapeHtml(lyDo)}" style="cursor:pointer;" onclick="faiMoTuTab2('${date}', '${ca}', ${parseInt(m)})">🔒 Tab 7</span>`;
}
function faiMoTuTab2(date, ca, m) {
    let mold = dkKhuonDangChay(date, m, ca);
    let p = faiPhieuMoiNhat(date, m, ca, mold);
    if (p && p.trangThai !== 'dat') faiMoPhieu(date, p.id);
    else faiTaoPhieuTay(date, ca, m, 'len_khuon');
}

// ===================== 5. GIAO DIỆN TAB 7 =====================
function faiRender() {
    let root = document.getElementById('faiRoot');
    if (!root || !isEditMode) return;
    if (!faiXem.date) faiXem.date = dkCaHienTai().date;
    if (!document.getElementById('faiTbody')) {
        root.innerHTML = `
        <div class="qc-card p-2 p-md-3">
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                <div>
                    <h5 class="fw-bold text-info m-0">🧪 Kiểm Tra Kiện Hàng Đầu Tiên <span class="opacity-75">首件检查</span></h5>
                    <div class="small opacity-75">Phiếu tự tạo khi thay khuôn (lên khuôn) và đổi màu; sửa khuôn / chạy lại bấm "Tạo phiếu". Phiếu chưa ĐẠT thì Tab 2 của máy bị khóa. Không đạt → Zalo + đối sách 4M. In A5, ký tay.</div>
                </div>
                <div class="d-flex flex-wrap gap-2">
                    <button type="button" class="btn btn-sm btn-3d-emerald px-3" onclick="faiTaoPhieuTay()">➕ Tạo phiếu</button>
                    <button type="button" class="btn btn-sm btn-3d-primary px-3" onclick="faiMoMau()">📏 Mẫu kiểm theo khuôn</button>
                    <button type="button" class="btn btn-sm btn-outline-success px-3" onclick="faiXuatExcel()">📊 Excel</button>
                    <button type="button" class="btn btn-sm px-3" id="faiBtnChan" onclick="faiDoiChan()"></button>
                </div>
            </div>
            <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                <input type="date" class="form-control form-control-sm fw-bold" style="width:150px;" id="faiDate" onchange="faiXem.date=this.value; faiNghe(this.value); faiRender()">
                <select class="form-select form-select-sm fw-bold" style="width:160px;" onchange="faiXem.xuong=this.value; faiRender()">
                    <option value="ALL">Tất cả xưởng</option><option value="X1">Xưởng 1 (M1–M11)</option><option value="X2">Xưởng 2 (M1–M10)</option>
                </select>
                <select class="form-select form-select-sm fw-bold" style="width:130px;" onchange="faiXem.ca=this.value; faiRender()">
                    <option value="ALL">Cả 2 ca</option><option value="Ca Ngày">Ca Ngày</option><option value="Ca Đêm">Ca Đêm</option>
                </select>
                <span class="small fw-bold ms-auto" id="faiTongHop"></span>
            </div>
            <div class="table-responsive">
                <table class="table table-bordered table-sm align-middle text-center mb-0">
                    <thead><tr>
                        <th>Số phiếu</th><th>Máy</th><th>Ca</th><th>Mã khuôn / SP</th><th>Lý do</th><th>Trạng thái</th><th>QC / giờ</th><th>Thao tác</th>
                    </tr></thead>
                    <tbody id="faiTbody"></tbody>
                </table>
            </div>
        </div>`;
    }
    let dEl = document.getElementById('faiDate');
    if (dEl && dEl.value !== faiXem.date) dEl.value = faiXem.date;
    let b = document.getElementById('faiBtnChan');
    if (b) {
        let bat = faiCfg.chanTab2 !== false;
        b.className = 'btn btn-sm px-3 ' + (bat ? 'btn-3d-amber' : 'btn-outline-secondary');
        b.textContent = bat ? '🔒 Chặn Tab 2: BẬT' : '🔓 Chặn Tab 2: TẮT';
        b.title = `Bật: máy chưa có phiếu ĐẠT thì không nhập được kiểm 2 giờ ở Tab 2 (áp dụng từ ${dkNgayNgan(faiCfg.batDau || FAI_BAT_DAU_MAC_DINH)})`;
    }
    let ds = faiDsNgay(faiXem.date).filter(r =>
        (faiXem.xuong === 'ALL' || faiNhom(r.may).ma === faiXem.xuong) && (faiXem.ca === 'ALL' || r.ca === faiXem.ca));
    ds.sort((a, b) => (a.may - b.may) || String(a.ca).localeCompare(String(b.ca)) || (a.taoLuc || 0) - (b.taoLuc || 0));
    let act = Object.assign({}, faiAct[faiXem.date] || {}, (typeof tab3ActionNotesStore !== 'undefined' && tab3ActionNotesStore[faiXem.date]) || {});
    let now = Date.now();
    let html = ds.map(r => {
        let tt;
        if (r.trangThai === 'dat') tt = '<span class="badge bg-success px-2 py-2">✅ ĐẠT</span>';
        else if (r.trangThai === 'khong_dat') tt = '<span class="badge bg-danger px-2 py-2">❌ KHÔNG ĐẠT</span>'
            + (qcDu4M(act[`FAI_${r.id}_4m`]) ? '<br><small class="text-success">4M ✓</small>' : '<br><small class="text-warning">chưa có 4M</small>');
        else tt = (now > (r.taoLuc || 0) + FAI_HAN_PHUT * 60000 && faiCa(r.date, r.ca))
            ? `<span class="badge bg-danger px-2 py-2">⏰ QUÁ HẠN (${dkGio((r.taoLuc || 0) + FAI_HAN_PHUT * 60000)})</span>`
            : '<span class="badge bg-warning text-dark px-2 py-2">⏳ Chờ kiểm</span>';
        let qc = r.qc && r.qc.nguoiKiem ? `${escapeHtml(r.qc.nguoiKiem)}<br><small class="opacity-75">${r.qc.kiemLuc ? dkGio(r.qc.kiemLuc) : ''}</small>` : '—';
        let sp = (r.sx && (r.sx.tenSP || r.sx.maSP)) || '';
        return `<tr>
            <td class="small fw-bold">${escapeHtml(r.soPhieu || '')}</td>
            <td class="fw-bold">${qcOMay(r.may)}</td>
            <td class="small">${escapeHtml(r.ca)}</td>
            <td class="text-start"><div class="fw-bold text-warning">${escapeHtml(r.moldId || '')}</div><div class="small opacity-75 text-truncate" style="max-width:260px;">${escapeHtml(sp)}</div></td>
            <td class="small">${escapeHtml((FAI_LY_DO[r.lyDo] || {}).ten || r.lyDo || '')}${r.tuDong ? '<br><small class="opacity-75">tự tạo</small>' : ''}</td>
            <td>${tt}</td>
            <td class="small">${qc}</td>
            <td class="text-nowrap">
                <button type="button" class="btn btn-sm ${r.trangThai === 'cho' ? 'btn-3d-emerald' : 'btn-outline-info'} py-0 px-2" onclick="faiMoPhieu('${r.date}', '${r.id}')">${r.trangThai === 'cho' ? '📝 Kiểm' : '👁️ Xem'}</button>
                <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="faiIn('${r.date}', '${r.id}')" title="In phiếu khổ A5">🖨️</button>
                ${r.trangThai === 'khong_dat' ? `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="faiMo4M('${r.date}', '${r.id}')" title="Đối sách 4M">4M</button>` : ''}
                <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="faiXoaPhieu('${r.date}', '${r.id}')" title="Xóa phiếu tạo nhầm">🗑️</button>
            </td></tr>`;
    }).join('');
    let tb = document.getElementById('faiTbody');
    if (tb) tb.innerHTML = html || `<tr><td colspan="8" class="small fst-italic">Chưa có phiếu nào trong ngày${faiStore[faiXem.date] ? '' : ' (đang tải…)'}.</td></tr>`;
    let th = document.getElementById('faiTongHop');
    if (th) {
        let dat = ds.filter(r => r.trangThai === 'dat').length, kd = ds.filter(r => r.trangThai === 'khong_dat').length, cho = ds.length - dat - kd;
        th.innerHTML = `Tổng ${ds.length} · <span class="text-success">Đạt ${dat}</span> · <span class="text-danger">Không đạt ${kd}</span> · <span class="text-warning">Chờ ${cho}</span>`;
    }
}

function faiDoiChan() {
    if (!checkAuthOrAlert() || !db) return;
    let bat = faiCfg.chanTab2 !== false;
    if (!confirm(bat ? 'TẮT chặn Tab 2? (QC nhập kiểm 2 giờ được cả khi chưa có phiếu kiểm hàng đầu tiên đạt)' : 'BẬT chặn Tab 2? (máy chưa có phiếu ĐẠT thì không nhập được kiểm 2 giờ)')) return;
    db.ref(FAI_PATH_CFG).update({ chanTab2: !bat, batDau: faiCfg.batDau || FAI_BAT_DAU_MAC_DINH, capNhatBoi: (currentUser && currentUser.email) || '', capNhatLuc: Date.now() })
        .catch(e => alert('❌ Không lưu được: ' + e.message));
}

// Xóa phiếu: chỉ đánh dấu daXoa (giữ dấu vết; phiếu tự tạo sẽ không bị tạo lại)
function faiXoaPhieu(date, id) {
    if (!checkAuthOrAlert() || !db) return;
    let r = (faiStore[date] || {})[id];
    if (!r) return;
    let canhBao = r.trangThai !== 'cho' ? `\n⚠️ Phiếu này ĐÃ KIỂM (${r.trangThai === 'dat' ? 'ĐẠT' : 'KHÔNG ĐẠT'}) – xóa sẽ mất kết quả.` : '';
    if (!confirm(`Xóa phiếu ${r.soPhieu} (${qcTenMayDu(r.may)} · ${r.moldId})?${canhBao}`)) return;
    db.ref(`${FAI_PATH}/${date}/${id}`).update({ daXoa: true, xoaBoi: (currentUser && currentUser.email) || '', xoaLuc: Date.now() })
        .catch(e => alert('❌ Không xóa được: ' + e.message));
}

// ===================== 6. TẠO PHIẾU TAY =====================
function faiTaoPhieuTay(date, ca, m, lyDo) {
    if (!checkAuthOrAlert() || !db) return;
    let ht = dkCaHienTai();
    date = date || ht.date; ca = ca || ht.ca;
    let el = dkTaoModal('faiTaoModal', '➕ TẠO PHIẾU KIỂM HÀNG ĐẦU TIÊN', '',
        `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>
         <button type="button" class="btn btn-sm btn-3d-emerald px-4" onclick="faiLuuTaoTay()">Tạo phiếu</button>`);
    let mayOpts = '';
    qcDsMay('ALL').forEach(i => { mayOpts += `<option value="${i}" ${i === parseInt(m) ? 'selected' : ''}>${qcTenMay(i)} – Xưởng ${qcSoXuong(i)}</option>`; });
    document.getElementById('faiTaoModalBody').innerHTML = `
        <div class="row g-2">
            <div class="col-6"><label class="small fw-bold">Ngày</label><input type="date" class="form-control form-control-sm" id="faiTNgay" value="${date}"></div>
            <div class="col-6"><label class="small fw-bold">Ca</label><select class="form-select form-select-sm" id="faiTCa">
                <option ${ca === 'Ca Ngày' ? 'selected' : ''}>Ca Ngày</option><option ${ca === 'Ca Đêm' ? 'selected' : ''}>Ca Đêm</option></select></div>
            <div class="col-6"><label class="small fw-bold">Máy</label><select class="form-select form-select-sm fw-bold" id="faiTMay" onchange="faiTGoiYKhuon()"><option value="">—</option>${mayOpts}</select></div>
            <div class="col-6"><label class="small fw-bold">Nguyên nhân đưa kiểm</label><select class="form-select form-select-sm" id="faiTLyDo">
                ${faiLyDoChon().map(k => `<option value="${k}" ${k === (lyDo || 'len_khuon') ? 'selected' : ''}>${FAI_LY_DO[k].ten}</option>`).join('')}</select></div>
            <div class="col-12"><label class="small fw-bold">Mã khuôn</label><input type="text" class="form-control form-control-sm fw-bold" id="faiTKhuon" list="moldOptionsList" placeholder="Tự lấy theo PM ép nhựa"></div>
        </div>`;
    bootstrap.Modal.getOrCreateInstance(el).show();
    faiTGoiYKhuon();
}
function faiTGoiYKhuon() {
    let m = parseInt((document.getElementById('faiTMay') || {}).value), d = (document.getElementById('faiTNgay') || {}).value, ca = (document.getElementById('faiTCa') || {}).value;
    let k = document.getElementById('faiTKhuon');
    if (k && m && d) k.value = dkKhuonDangChay(d, m, ca) || k.value;
}
async function faiLuuTaoTay() {
    let date = document.getElementById('faiTNgay').value, ca = document.getElementById('faiTCa').value;
    let m = parseInt(document.getElementById('faiTMay').value), lyDo = document.getElementById('faiTLyDo').value;
    let mold = document.getElementById('faiTKhuon').value.trim();
    if (!date || !m || !mold) { alert('⚠️ Chọn ngày, máy và mã khuôn.'); return; }
    faiNghe(date);
    let rec = faiPhieuMoi(date, ca, m, mold, lyDo, false);
    try {
        let ref = await db.ref(`${FAI_PATH}/${date}`).push(rec);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('faiTaoModal')).hide();
        if (!faiStore[date]) faiStore[date] = {};
        faiStore[date][ref.key] = rec;
        faiXem.date = date;
        faiRender();
        faiMoPhieu(date, ref.key);
    } catch (e) { alert('❌ Không tạo được phiếu: ' + e.message); }
}

// ===================== 7. PHIẾU KIỂM =====================
function faiMauKhuon(mold) { return faiMau[getSafeFirebaseKey(mold)] || {}; }
function faiDanhSach(v) { return Array.isArray(v) ? v.filter(Boolean) : (v && typeof v === 'object' ? Object.values(v).filter(Boolean) : []); }

async function faiMoPhieu(date, id) {
    if (!checkAuthOrAlert()) return;
    let rec = (faiStore[date] || {})[id];
    if (!rec) { alert('Không tìm thấy phiếu.'); return; }
    faiDangSua = { date, id, rec };
    faiAnhTam = [];
    let qc = rec.qc || {}, muc = qc.muc || {}, sx = rec.sx || {};
    let mau = faiMauKhuon(rec.moldId);
    let kichThuoc = faiDanhSach(qc.kichThuoc).length ? faiDanhSach(qc.kichThuoc) : faiDanhSach(mau.kichThuoc).map(k => ({ ten: k.ten, chuan: k.chuan, d: k.d }));
    let them = faiDanhSach(qc.them).length ? faiDanhSach(qc.them) : faiDanhSach(mau.them).map(t => ({ ten: typeof t === 'string' ? t : t.ten }));

    // Thông số máy: kết quả xác nhận điều kiện ép (Tab 6) của máy + ca + khuôn
    let chk = null;
    try { chk = (await db.ref(`${DK_PATH_CHECK}/${date}/M${rec.may}_${rec.ca}/${getSafeFirebaseKey(rec.moldId)}`).once('value')).val(); } catch (e) {}
    faiDangSua.chk = chk;
    // Khuôn có bản điều kiện chuẩn (riêng hoặc bản gốc) -> bắt buộc lấy kết quả Tab 6; chưa có bản chuẩn nào -> QC tự nhận xét
    let coChuan = typeof dkChuanKiem === 'function' && !!dkChuanKiem(rec.moldId, rec.may);
    faiDangSua.tsMayTay = !chk && !coChuan;
    let tsMayCu = (muc.tsMay || {});
    let tsMay = chk ? (chk.kq === 'NG' ? 'KDAT' : 'DAT') : (faiDangSua.tsMayTay ? (tsMayCu.kq || '') : '');
    let tsMayMoTa = chk ? `Tab 6: ${chk.kq === 'NG' ? 'NG ' + (chk.ng || []).length + ' thông số' : 'ĐẠT'} – ${chk.by || ''} ${chk.at ? dkGio(new Date(chk.at).getTime()) : ''}${chk.theoGoc ? ' (theo bản gốc ' + chk.theoGoc + ')' : ''}`
        : faiDangSua.tsMayTay ? (tsMayCu.loi || '') : '⚠️ Chưa xác nhận điều kiện ép ở Tab 6 – xác nhận trước rồi mở lại phiếu';

    let el = dkTaoModal('faiModal', '', '',
        `<span class="me-auto fw-bold small" id="faiKetLuan"></span>
         <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" onclick="faiIn('${date}', '${id}')">🖨️ In A5</button>
         <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>
         <button type="button" class="btn btn-sm btn-3d-emerald px-4" onclick="faiLuuPhieu()">💾 Lưu kết quả</button>`, true);
    let foot = document.getElementById('faiModalFoot');
    if (foot) foot.innerHTML = `<span class="me-auto fw-bold small" id="faiKetLuan"></span>
         <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" onclick="faiIn('${date}', '${id}')">🖨️ In A5</button>
         <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>
         <button type="button" class="btn btn-sm btn-3d-emerald px-4" onclick="faiLuuPhieu()">💾 Lưu kết quả</button>`;
    document.getElementById('faiModalTitle').textContent = `🧪 ${rec.soPhieu} · ${qcTenMayDu(rec.may)} · ${rec.moldId}`;

    let chonKq = (ma, v, khoa) => `
        <div class="btn-group btn-group-sm" role="group">
            <input type="radio" class="btn-check" name="faiKq_${ma}" id="faiKq_${ma}_D" value="DAT" ${v === 'DAT' ? 'checked' : ''} ${khoa ? 'disabled' : ''} onchange="faiTinhKetLuan()">
            <label class="btn btn-outline-success fw-bold" for="faiKq_${ma}_D">Đạt</label>
            <input type="radio" class="btn-check" name="faiKq_${ma}" id="faiKq_${ma}_K" value="KDAT" ${v === 'KDAT' ? 'checked' : ''} ${khoa ? 'disabled' : ''} onchange="faiTinhKetLuan()">
            <label class="btn btn-outline-danger fw-bold" for="faiKq_${ma}_K">Không đạt</label>
        </div>`;
    let dongMuc = m => {
        let v = m.ma === 'tsMay' ? tsMay : ((muc[m.ma] || {}).kq || '');
        let loi = m.ma === 'tsMay' ? tsMayMoTa : ((muc[m.ma] || {}).loi || '');
        return `<tr data-muc="${m.ma}">
            <td class="text-start fw-bold small">${m.ten} <span class="opacity-75">${m.zh}</span></td>
            <td>${chonKq(m.ma, v, (m.ma === 'tsMay' && !faiDangSua.tsMayTay) || (m.ma === 'kt' && kichThuoc.length))}</td>
            <td><div class="input-group input-group-sm">
                <input type="text" class="form-control form-control-sm fai-loi" data-muc="${m.ma}" value="${escapeHtml(loi)}" ${m.ma === 'tsMay' && !faiDangSua.tsMayTay ? 'readonly' : ''}
                placeholder="${m.ma === 'tsMay' && faiDangSua.tsMayTay ? 'Khuôn chưa có bản điều kiện chuẩn – QC tự đánh giá' : 'Miêu tả lỗi (nếu có)'}">
                ${m.ma === 'tsMay' && !faiDangSua.tsMayTay ? '' : faiNutAnh(m.ma)}</div></td></tr>`;
    };
    let dongKT = (k, i) => `<tr data-kt="${i}">
            <td class="text-start small fw-bold">${escapeHtml(k.ten || '')}</td>
            <td class="small">${escapeHtml(String(k.chuan ?? ''))}${faiSo(k.d) > 0 ? ' ± ' + k.d : ''}</td>
            <td><input type="text" inputmode="decimal" class="form-control form-control-sm text-center fw-bold fai-do" data-i="${i}" value="${escapeHtml(String(k.do ?? ''))}" oninput="faiTinhKetLuan()"></td>
            <td class="fai-kt-kq" style="width:48px;"></td></tr>`;
    let dongThem = (t, i) => `<tr data-them="${i}">
            <td class="text-start fw-bold small">${escapeHtml(t.ten || '')}</td>
            <td>${chonKq('them' + i, t.kq || '')}</td>
            <td><div class="input-group input-group-sm">
                <input type="text" class="form-control form-control-sm fai-them-loi" data-i="${i}" value="${escapeHtml(t.loi || '')}" placeholder="Miêu tả lỗi">
                ${faiNutAnh('them' + i)}</div></td></tr>`;
    let anhCu = faiDanhSach(qc.anh);
    faiDangSua.kichThuoc = kichThuoc;
    faiDangSua.them = them;
    faiDangSua.anhCu = anhCu;

    document.getElementById('faiModalBody').innerHTML = `
        <div class="small fw-bold text-info mb-1">PHẦN SẢN XUẤT <span class="opacity-75">(tự lấy từ PM ép nhựa – sửa được)</span></div>
        <div class="row g-2 mb-2">
            <div class="col-6 col-md-3"><label class="small">Ngày · Ca</label><input class="form-control form-control-sm" readonly value="${dkNgayNgan(date)} · ${escapeHtml(rec.ca)}"></div>
            <div class="col-6 col-md-3"><label class="small">Tổ sản xuất</label><input class="form-control form-control-sm fai-sx" data-f="to" value="${escapeHtml(sx.to || faiToSX(rec.may))}"></div>
            <div class="col-6 col-md-3"><label class="small">Khách hàng</label><input class="form-control form-control-sm fai-sx" data-f="khach" value="${escapeHtml(sx.khach || '')}"></div>
            <div class="col-6 col-md-3"><label class="small">Mã đơn hàng</label><input class="form-control form-control-sm fai-sx" data-f="donHang" value="${escapeHtml(sx.donHang || '')}"></div>
            <div class="col-12 col-md-6"><label class="small">Tên sản phẩm</label><input class="form-control form-control-sm fai-sx" data-f="tenSP" value="${escapeHtml(sx.tenSP || '')}"></div>
            <div class="col-6 col-md-3"><label class="small">Màu · Nhựa</label><input class="form-control form-control-sm fai-sx" data-f="mau" value="${escapeHtml(sx.mau || '')}" placeholder="Màu"></div>
            <div class="col-6 col-md-3"><label class="small">&nbsp;</label><input class="form-control form-control-sm fai-sx" data-f="nhua" value="${escapeHtml(sx.nhua || '')}" placeholder="Nhựa"></div>
            <div class="col-6 col-md-3"><label class="small fw-bold">Số lượng đưa kiểm</label><input type="number" min="0" class="form-control form-control-sm fw-bold fai-sx" data-f="slKiem" value="${escapeHtml(String(sx.slKiem ?? ''))}"></div>
            <div class="col-6 col-md-3"><label class="small fw-bold">Loại</label><select class="form-select form-select-sm fai-sx" data-f="loai">
                <option value="TP" ${sx.loai !== 'BTP' ? 'selected' : ''}>Thành phẩm</option><option value="BTP" ${sx.loai === 'BTP' ? 'selected' : ''}>Bán thành phẩm</option></select></div>
            <div class="col-12 col-md-6"><label class="small fw-bold">Nguyên nhân đưa kiểm</label><select class="form-select form-select-sm" id="faiLyDo">
                ${faiLyDoChon().concat(FAI_LY_DO[rec.lyDo] && FAI_LY_DO[rec.lyDo].an ? [rec.lyDo] : []).map(k => `<option value="${k}" ${k === rec.lyDo ? 'selected' : ''}>${FAI_LY_DO[k].ten}</option>`).join('')}</select></div>
        </div>
        <div class="small fw-bold text-info mb-1">PHẦN QC</div>
        <table class="table table-bordered table-sm align-middle text-center mb-2">
            <thead><tr><th class="text-start">Mục kiểm tra</th><th style="width:170px;">Nhận xét</th><th>Miêu tả lỗi</th></tr></thead>
            <tbody>${FAI_MUC.map(dongMuc).join('')}${them.map(dongThem).join('')}</tbody>
        </table>
        ${kichThuoc.length ? `
        <div class="small fw-bold text-info mb-1">Kích thước đo <span class="opacity-75">(theo mẫu kiểm của khuôn – tự tính mục Kích thước)</span></div>
        <table class="table table-bordered table-sm align-middle text-center mb-2">
            <thead><tr><th class="text-start">Kích thước</th><th>Chuẩn</th><th style="width:110px;">Đo được</th><th></th></tr></thead>
            <tbody>${kichThuoc.map(dongKT).join('')}</tbody>
        </table>` : `<div class="small opacity-75 mb-2">Khuôn chưa có mẫu kích thước – bấm "📏 Mẫu kiểm theo khuôn" ở Tab 7 để thêm (đo số, tự báo OK/NG).</div>`}
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2 p-2 border border-info rounded-3">
            <span class="small fw-bold">📸 Ảnh lỗi:</span>
            <span class="small opacity-75">bấm 📷 trên dòng mục kiểm bị lỗi, hoặc</span>
            <label class="btn btn-sm btn-outline-info rounded-pill m-0" style="cursor:pointer;">➕ Ảnh chung
                <input type="file" accept="image/*" multiple style="display:none;" onchange="faiChonAnh(this, '')"></label>
            <div class="d-flex flex-wrap gap-2 w-100" id="faiAnh"></div>
        </div>
        <div class="row g-2">
            <div class="col-12 col-md-8"><label class="small fw-bold">Ghi chú</label><textarea class="form-control form-control-sm" id="faiGhiChu" rows="2">${escapeHtml(qc.ghiChu || '')}</textarea></div>
            <div class="col-12 col-md-4"><label class="small fw-bold">Nhân viên QC</label><input type="text" class="form-control form-control-sm fw-bold" id="faiNguoi" value="${escapeHtml(qc.nguoiKiem || faiTenQC(rec))}"></div>
        </div>`;
    faiVeAnh();
    faiTinhKetLuan();
    faiModal = bootstrap.Modal.getOrCreateInstance(el);
    faiModal.show();
}
function faiTenQC(rec) {
    let t = '';
    try { if (tab1Store[rec.date]) t = getShiftInspector(tab1Store[rec.date], rec.ca, rec.may) || ''; } catch (e) {}
    if (!t) { try { t = localStorage.getItem('qc_dk_ten_qc') || ''; } catch (e) {} }
    return t;
}

// Kích thước: OK nếu |đo - chuẩn| <= dung sai
function faiKtDat(k, v) {
    let c = faiSo(k.chuan), d = Math.abs(faiSo(k.d)) || 0;
    if (isNaN(v)) return null;
    if (isNaN(c)) return true;
    return Math.abs(v - c) <= d + 1e-9;
}
function faiDocKq(ma) { let r = document.querySelector(`#faiModalBody input[name="faiKq_${ma}"]:checked`); return r ? r.value : ''; }
function faiTinhKetLuan() {
    let body = document.getElementById('faiModalBody');
    if (!body || !faiDangSua) return;
    // Kích thước đo -> tự chọn Đạt / Không đạt cho mục Kích thước
    let ds = faiDangSua.kichThuoc || [];
    if (ds.length) {
        let tatCa = true, ng = [];
        body.querySelectorAll('.fai-do').forEach(inp => {
            let k = ds[parseInt(inp.dataset.i)], v = faiSo(inp.value), ok = faiKtDat(k, v);
            let o = inp.closest('tr').querySelector('.fai-kt-kq');
            inp.classList.remove('is-valid', 'is-invalid');
            if (ok === null) { o.innerHTML = ''; tatCa = false; return; }
            if (ok) { o.innerHTML = '<span class="badge bg-success">OK</span>'; inp.classList.add('is-valid'); }
            else { o.innerHTML = '<span class="badge bg-danger">NG</span>'; inp.classList.add('is-invalid'); ng.push(`${k.ten} ${v}`); }
        });
        let d = document.getElementById('faiKq_kt_D'), k = document.getElementById('faiKq_kt_K');
        if (d && k) {
            d.checked = tatCa && !ng.length; k.checked = ng.length > 0;
            let loi = body.querySelector('.fai-loi[data-muc="kt"]');
            if (loi && ng.length) loi.value = 'Ngoài dung sai: ' + ng.join('; ');
        }
    }
    let kq = faiKetQua();
    let o = document.getElementById('faiKetLuan');
    if (o) o.innerHTML = kq.thieu.length ? `<span class="text-warning">Còn thiếu: ${kq.thieu.join(', ')}</span>`
        : (kq.dat ? '<span class="badge bg-success px-2 py-2">KẾT QUẢ: ĐẠT</span>' : '<span class="badge bg-danger px-2 py-2">KẾT QUẢ: KHÔNG ĐẠT</span>');
}
function faiKetQua() {
    let thieu = [], kd = [];
    FAI_MUC.forEach(m => {
        let v = faiDocKq(m.ma);
        if (!v) thieu.push(m.ma === 'tsMay' ? 'Thông số máy (xác nhận Tab 6 trước)' : m.ten);
        else if (v === 'KDAT') kd.push(m.ten);
    });
    (faiDangSua.them || []).forEach((t, i) => {
        let v = faiDocKq('them' + i);
        if (!v) thieu.push(t.ten); else if (v === 'KDAT') kd.push(t.ten);
    });
    return { thieu, kd, dat: !kd.length };
}

// Ảnh
// Nút chụp ảnh lỗi trên từng dòng mục kiểm (máy điện thoại mở camera sau)
function faiNutAnh(muc) {
    return `<label class="btn btn-outline-danger fw-bold m-0 px-2" style="cursor:pointer;" title="Chụp / chọn ảnh lỗi cho mục này">📷<span class="fai-anh-dem ms-1" data-muc="${muc}"></span>
        <input type="file" accept="image/*" capture="environment" multiple style="display:none;" onchange="faiChonAnh(this, '${muc}')"></label>`;
}
function faiTenMuc(muc) {
    if (!muc) return 'Ảnh chung';
    let m = FAI_MUC.find(x => x.ma === muc);
    if (m) return m.ten;
    let i = parseInt(String(muc).replace('them', '')), t = faiDangSua && faiDangSua.them && faiDangSua.them[i];
    return t ? t.ten : muc;
}
async function faiChonAnh(input, muc) {
    let files = [...(input.files || [])].slice(0, 4);
    input.value = '';
    for (let f of files) {
        try { faiAnhTam.push({ data: await compressImage(f), muc: muc || '' }); } catch (e) { alert('⚠️ Không đọc được ảnh: ' + e.message); }
    }
    // có ảnh lỗi ở mục nào thì tự chọn "Không đạt" cho mục đó (QC vẫn đổi lại được)
    if (muc && files.length) {
        let k = document.getElementById(`faiKq_${muc}_K`);
        if (k && !k.disabled && !document.querySelector(`#faiModalBody input[name="faiKq_${muc}"]:checked`)) { k.checked = true; faiTinhKetLuan(); }
    }
    faiVeAnh();
}
function faiVeAnh() {
    let o = document.getElementById('faiAnh');
    if (!o || !faiDangSua) return;
    let dem = {};
    (faiDangSua.anhCu || []).concat(faiAnhTam).forEach(a => { dem[a.muc || ''] = (dem[a.muc || ''] || 0) + 1; });
    document.querySelectorAll('#faiModalBody .fai-anh-dem').forEach(sp => { let n = dem[sp.dataset.muc] || 0; sp.textContent = n ? n : ''; });
    let cu = (faiDangSua.anhCu || []).map((a, i) => `<button type="button" class="btn btn-sm btn-3d-primary py-0 px-2" onclick="previewDefectImage('${escapeHtml(a.url || a.file || '')}', '${escapeHtml(faiTenMuc(a.muc))} – ${escapeHtml(faiDangSua.rec.soPhieu)}')">🖼️ ${escapeHtml(faiTenMuc(a.muc))}</button>`);
    let moi = faiAnhTam.map((a, i) => `<span class="position-relative d-inline-flex flex-column align-items-center">
        <img src="${a.data}" style="width:56px;height:56px;object-fit:cover;cursor:pointer;" class="rounded border border-danger" onclick="previewDefectImage(this.src, '${escapeHtml(faiTenMuc(a.muc))}')">
        <small style="font-size:10px;max-width:64px;" class="text-truncate">${escapeHtml(faiTenMuc(a.muc))}</small>
        <button type="button" class="btn btn-sm btn-danger py-0 px-1 position-absolute top-0 start-100 translate-middle" style="font-size:9px;" onclick="faiAnhTam.splice(${i},1); faiVeAnh()">×</button></span>`);
    o.innerHTML = cu.concat(moi).join('') || '<span class="small opacity-75">Chưa có ảnh.</span>';
}
// Lưu ảnh lên Google Drive (như Tab 2) – trả về [{ file, url }]
async function faiTaiAnhLen(rec, id) {
    let out = [];
    for (let i = 0; i < faiAnhTam.length; i++) {
        let a = faiAnhTam[i];
        let file = `QC_FAI_M${rec.may}_${String(rec.moldId || 'KHUON').replace(/[^\w-]+/g, '_')}_${rec.date}_${id}_${Date.now()}_${i + 1}.jpg`;
        let item = { file, url: '', muc: a.muc || '' };
        if (typeof ZALO_WEBHOOK_URL !== 'undefined' && ZALO_WEBHOOK_URL && !ZALO_WEBHOOK_URL.includes('URL_GOOGLE_APPS_SCRIPT')) {
            try {
                let r = await fetch(ZALO_WEBHOOK_URL, {
                    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'upload_to_drive', folderId: GOOGLE_DRIVE_FOLDER_ID, fileName: file,
                        fileData: a.data.split(',')[1] || a.data, mimeType: 'image/jpeg', sendToZalo: false,
                        date: rec.date, machine: `M${rec.may}`, moldId: rec.moldId })
                }).then(x => x.json());
                if (r && r.fileUrl) item.url = r.fileUrl;
            } catch (e) { console.warn('Không tải ảnh lên Drive:', e); }
        }
        out.push(item);
    }
    return out;
}

async function faiLuuPhieu() {
    if (!checkAuthOrAlert() || !db || !faiDangSua) return;
    let { date, id, rec } = faiDangSua;
    let body = document.getElementById('faiModalBody');
    let nguoi = document.getElementById('faiNguoi').value.trim();
    if (!nguoi) { alert('⚠️ Nhập tên nhân viên QC.'); return; }
    let kq = faiKetQua();
    if (kq.thieu.length) { alert('⚠️ Chưa nhận xét: ' + kq.thieu.join(', ') + '.'); return; }
    let sx = Object.assign({}, rec.sx || {});
    body.querySelectorAll('.fai-sx').forEach(i => { sx[i.dataset.f] = i.value.trim(); });
    if (!(parseInt(sx.slKiem) > 0)) { alert('⚠️ Nhập số lượng đưa kiểm.'); return; }
    let muc = {};
    FAI_MUC.forEach(m => { muc[m.ma] = { kq: faiDocKq(m.ma), loi: (body.querySelector(`.fai-loi[data-muc="${m.ma}"]`) || {}).value || '' }; });
    let thieuLoi = FAI_MUC.filter(m => muc[m.ma].kq === 'KDAT' && m.ma !== 'tsMay' && !muc[m.ma].loi.trim()).map(m => m.ten);
    if (thieuLoi.length) { alert('⚠️ Ghi miêu tả lỗi cho mục không đạt: ' + thieuLoi.join(', ')); return; }
    let them = (faiDangSua.them || []).map((t, i) => ({ ten: t.ten, kq: faiDocKq('them' + i), loi: (body.querySelector(`.fai-them-loi[data-i="${i}"]`) || {}).value || '' }));
    let kichThuoc = (faiDangSua.kichThuoc || []).map((k, i) => {
        let v = faiSo((body.querySelector(`.fai-do[data-i="${i}"]`) || {}).value);
        return { ten: k.ten, chuan: k.chuan, d: k.d, do: isNaN(v) ? '' : v, kq: isNaN(v) ? '' : (faiKtDat(k, v) ? 'OK' : 'NG') };
    });
    let anhMoi = await faiTaiAnhLen(rec, id);
    let qc = {
        muc, them, kichThuoc, anh: (faiDangSua.anhCu || []).concat(anhMoi),
        ghiChu: document.getElementById('faiGhiChu').value.trim(), nguoiKiem: nguoi,
        email: (currentUser && currentUser.email) || '', kiemLuc: Date.now(),
        kq: kq.dat ? 'DAT' : 'KDAT', mucKhongDat: kq.kd,
        tab6: faiDangSua.chk ? { kq: faiDangSua.chk.kq, by: faiDangSua.chk.by || '', at: faiDangSua.chk.at || '' } : null
    };
    let trangThai = kq.dat ? 'dat' : 'khong_dat';
    let up = { sx, qc, trangThai, lyDo: document.getElementById('faiLyDo').value };
    try {
        await db.ref(`${FAI_PATH}/${date}/${id}`).update(cleanPayloadForFirebase(up));
    } catch (e) { alert('❌ Không lưu được phiếu: ' + e.message); return; }
    try { localStorage.setItem('qc_dk_ten_qc', nguoi); } catch (e) {}
    if (faiModal) faiModal.hide();
    // Không đạt -> cảnh báo Zalo ngay
    if (!kq.dat && rec.trangThai !== 'khong_dat') {
        let nhom = faiNhom(rec.may);
        let dong = FAI_MUC.filter(m => muc[m.ma].kq === 'KDAT').map(m => `  • ${m.ten}: ${muc[m.ma].loi || 'Không đạt'}`)
            .concat(them.filter(t => t.kq === 'KDAT').map(t => `  • ${t.ten}: ${t.loi || 'Không đạt'}`));
        dkXepTinZalo(nhom.ma, `🚨 [HÀNG ĐẦU TIÊN KHÔNG ĐẠT – ${nhom.xuong}]\n📅 ${dkNgayNgan(date)} · ${rec.ca} · ${qcTenMay(rec.may)} · Khuôn ${rec.moldId}\n` +
            `📄 Phiếu ${rec.soPhieu} (${(FAI_LY_DO[up.lyDo] || {}).ten || ''}) · ${sx.tenSP || ''}\n👤 QC: ${nguoi}\n${dong.join('\n')}` +
            `\n🔒 Tab 2 của ${qcTenMay(rec.may)} bị khóa đến khi kiểm lại đạt. Cần lập đối sách 4M.`).catch(e => console.warn('Không xếp được tin Zalo:', e));
        if (confirm('Phiếu KHÔNG ĐẠT – đã gửi cảnh báo Zalo.\nLập đối sách 4M ngay bây giờ?')) setTimeout(() => faiMo4M(date, id), 400);
    }
}

// ===================== 8. ĐỐI SÁCH 4M (dùng chung Tab 3) =====================
function faiItem4M(date, id, rec, act) {
    let qc = rec.qc || {}, muc = qc.muc || {};
    let loi = FAI_MUC.filter(m => (muc[m.ma] || {}).kq === 'KDAT').map(m => `${m.ten}: ${(muc[m.ma] || {}).loi || 'Không đạt'}`)
        .concat(faiDanhSach(qc.them).filter(t => t.kq === 'KDAT').map(t => `${t.ten}: ${t.loi || 'Không đạt'}`));
    let key = `FAI_${id}`;
    let it = {
        date, source: 'FAI', key, machine: `M${rec.may}`, ws: rec.may <= 10 ? 'XUONG1' : 'XUONG2', isDay: !String(rec.ca).includes('Đêm'),
        shiftTime: `${rec.ca} (Hàng đầu tiên)`, inspector: qc.nguoiKiem || '', moldId: rec.moldId || '',
        category: `🧪 Hàng đầu tiên không đạt (${(FAI_LY_DO[rec.lyDo] || {}).ten || ''})`, defectQty: 0,
        description: loi.join('; ') || 'Hàng đầu tiên không đạt',
        savedAction: typeof act[key] === 'string' ? act[key] : '', doiSach: act[`${key}_4m`] || null,
        order: qcThuTuThoiGian(date, rec.ca, qc.kiemLuc ? dkGio(qc.kiemLuc) : '08:00')
    };
    it.loaiLoiTuDong = qcNhanDienLoaiLoi(it.description, '', 'FAI');
    it.loaiLoi = (it.doiSach && it.doiSach.loaiLoi) ? it.doiSach.loaiLoi : it.loaiLoiTuDong;
    return it;
}
// Tab 3 gom lỗi theo ngày -> thêm phiếu hàng đầu tiên không đạt
function faiThuThapTheoNgay(date) {
    faiNghe(date);
    let act = (typeof tab3ActionNotesStore !== 'undefined' && tab3ActionNotesStore[date]) || {};
    return faiDsNgay(date).filter(r => r.trangThai === 'khong_dat').map(r => faiItem4M(date, r.id, r, act));
}
async function faiMo4M(date, id) {
    let rec = (faiStore[date] || {})[id];
    if (!rec || typeof qcMoPhieuDoiSachItem !== 'function') return;
    let act = {};
    try { act = await faiDoc(`qc_tab3_actions_v1/${date}`); } catch (e) {}
    if (typeof tab3ActionNotesStore !== 'undefined') tab3ActionNotesStore[date] = Object.assign(tab3ActionNotesStore[date] || {}, act);
    faiAct[date] = act;
    qcMoPhieuDoiSachItem(faiItem4M(date, id, rec, act));
}

// ===================== 9. MẪU KIỂM THEO KHUÔN =====================
function faiMoMau(mold) {
    if (!checkAuthOrAlert()) return;
    let el = dkTaoModal('faiMauModal', '📏 MẪU KIỂM HÀNG ĐẦU TIÊN THEO KHUÔN', '',
        `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>
         <button type="button" class="btn btn-sm btn-3d-emerald px-4" onclick="faiLuuMau()">💾 Lưu mẫu</button>`, true);
    document.getElementById('faiMauModalBody').innerHTML = `
        <div class="row g-2 mb-2">
            <div class="col-8"><label class="small fw-bold">Mã khuôn</label>
                <input type="text" class="form-control form-control-sm fw-bold" id="faiMKhuon" list="moldOptionsList" value="${escapeHtml(mold || '')}" onchange="faiVeMau()"></div>
            <div class="col-4 d-flex align-items-end"><button type="button" class="btn btn-sm btn-outline-info w-100" onclick="faiVeMau()">Mở</button></div>
        </div>
        <div id="faiMauNoiDung"></div>`;
    faiModalMau = bootstrap.Modal.getOrCreateInstance(el);
    faiModalMau.show();
    faiVeMau();
}
function faiVeMau() {
    let mold = (document.getElementById('faiMKhuon') || {}).value || '';
    let o = document.getElementById('faiMauNoiDung');
    if (!o) return;
    if (!mold.trim()) { o.innerHTML = '<div class="small opacity-75">Nhập mã khuôn.</div>'; return; }
    let mau = faiMauKhuon(mold.trim());
    let kt = faiDanhSach(mau.kichThuoc), them = faiDanhSach(mau.them).map(t => typeof t === 'string' ? t : t.ten);
    let dongKt = k => `<tr><td><input class="form-control form-control-sm fai-m-ten" value="${escapeHtml(k.ten || '')}" placeholder="VD: Chiều dài tổng"></td>
        <td><input class="form-control form-control-sm text-center fai-m-chuan" inputmode="decimal" value="${escapeHtml(String(k.chuan ?? ''))}" placeholder="mm"></td>
        <td><input class="form-control form-control-sm text-center fai-m-d" inputmode="decimal" value="${escapeHtml(String(k.d ?? ''))}" placeholder="±"></td>
        <td><button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="this.closest('tr').remove()">×</button></td></tr>`;
    o.innerHTML = `
        <div class="small fw-bold text-info mb-1">Kích thước cần đo</div>
        <table class="table table-bordered table-sm align-middle text-center mb-1">
            <thead><tr><th>Tên kích thước</th><th style="width:100px;">Chuẩn</th><th style="width:80px;">± dung sai</th><th></th></tr></thead>
            <tbody id="faiMKt">${(kt.length ? kt : [{}]).map(dongKt).join('')}</tbody>
        </table>
        <button type="button" class="btn btn-sm btn-outline-info mb-2" onclick="document.getElementById('faiMKt').insertAdjacentHTML('beforeend', \`${dongKt({}).replace(/`/g, '\\`')}\`)">+ Thêm kích thước</button>
        <div class="small fw-bold text-info mb-1">Mục kiểm thêm của khuôn <span class="opacity-75">(mỗi dòng 1 mục, VD: Thử rơi, Lực tháo lắp)</span></div>
        <textarea class="form-control form-control-sm" id="faiMThem" rows="3">${escapeHtml(them.join('\n'))}</textarea>`;
}
function faiLuuMau() {
    if (!db) return;
    let mold = (document.getElementById('faiMKhuon').value || '').trim();
    if (!mold) { alert('⚠️ Nhập mã khuôn.'); return; }
    let kichThuoc = [];
    document.querySelectorAll('#faiMKt tr').forEach(tr => {
        let ten = tr.querySelector('.fai-m-ten').value.trim();
        if (!ten) return;
        let c = faiSo(tr.querySelector('.fai-m-chuan').value), d = faiSo(tr.querySelector('.fai-m-d').value);
        kichThuoc.push({ ten, chuan: isNaN(c) ? '' : c, d: isNaN(d) ? 0 : Math.abs(d) });
    });
    let them = document.getElementById('faiMThem').value.split('\n').map(s => s.trim()).filter(Boolean);
    db.ref(`${FAI_PATH_MAU}/${getSafeFirebaseKey(mold)}`).set({ moldId: mold, kichThuoc, them, capNhatLuc: Date.now(), capNhatBoi: (currentUser && currentUser.email) || '' })
        .then(() => { alert(`✅ Đã lưu mẫu kiểm cho ${mold}: ${kichThuoc.length} kích thước, ${them.length} mục thêm.\n(Áp dụng cho phiếu mở từ bây giờ.)`); if (faiModalMau) faiModalMau.hide(); })
        .catch(e => alert('❌ Không lưu được: ' + e.message));
}

// ===================== 10. IN PHIẾU A5 =====================
function faiIn(date, id) {
    let r = (faiStore[date] || {})[id];
    if (!r) return;
    let sx = r.sx || {}, qc = r.qc || {}, muc = qc.muc || {};
    let p = String(date).split('-');
    let o = b => b ? '☑' : '☐';
    let e = s => escapeHtml(String(s === undefined || s === null ? '' : s));
    let kq = v => v === 'DAT' ? 'Đạt' : v === 'KDAT' ? '<b>Không đạt</b>' : '';
    let dongMuc = FAI_MUC.map(m => {
        let x = muc[m.ma] || {};
        let loi = x.loi || '';
        if (m.ma === 'kt' && faiDanhSach(qc.kichThuoc).length)
            loi = (loi ? loi + ' · ' : '') + faiDanhSach(qc.kichThuoc).map(k => `${k.ten}: ${k.do !== '' && k.do !== undefined ? k.do : '—'}${k.kq === 'NG' ? ' (NG)' : ''}`).join('; ');
        return `<tr><td></td><td>${m.ten} ${m.zh}</td><td class="c">${kq(x.kq)}</td><td>${e(loi)}</td></tr>`;
    });
    let dongThem = faiDanhSach(qc.them).map(t => `<tr><td></td><td>${e(t.ten)}</td><td class="c">${kq(t.kq)}</td><td>${e(t.loi)}</td></tr>`);
    let trong = Math.max(0, 4 - dongThem.length);
    for (let i = 0; i < trong; i++) dongThem.push('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>');
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(r.soPhieu)}</title>
<style>
@page { size: A5 portrait; margin: 6mm; }
* { box-sizing: border-box; }
body { font-family: Arial, "Microsoft YaHei", sans-serif; font-size: 8pt; margin: 0; color: #000; }
h1 { font-size: 11pt; text-align: center; margin: 0 0 1mm; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 0.6pt solid #000; padding: 0.7mm 1.2mm; vertical-align: middle; line-height: 1.2; }
.t { text-align: center; font-weight: bold; }
.t .zh { font-size: 9pt; font-weight: normal; }
.t .vi { font-size: 10.5pt; }
.i { font-style: italic; text-align: center; font-size: 7.6pt; }
.c { text-align: center; }
.l { width: 24%; }
.s { height: 20mm; vertical-align: top; }
.k { font-size: 7.4pt; }
</style></head><body>
<h1>XƯỞNG ÉP NHỰA HẢI TÂN</h1>
<table>
<colgroup><col style="width:21%"><col style="width:31%"><col style="width:20%"><col style="width:28%"></colgroup>
<tr><td colspan="4" class="t"><div class="zh">首件检查报告</div><div class="vi">BÁO CÁO KIỂM TRA KIỆN HÀNG ĐẦU TIÊN</div></td></tr>
<tr><td class="l"><span class="k">报告编号</span><br>Mã số báo cáo</td><td><b>${e(r.soPhieu)}</b></td><td colspan="2">日期 Ngày <b>${p[2]}</b> Tháng <b>${p[1]}</b> Năm <b>${p[0]}</b> · ${e(r.ca)}</td></tr>
<tr><td colspan="4" class="i">此部分由提供首件的生产部分组别填写 – Hạng mục này dành cho bộ phận sản xuất kiện hàng đầu tiên điền</td></tr>
<tr><td class="l"><span class="k">生产组别</span><br>Tổ sản xuất</td><td>${e(sx.to)}</td><td class="l"><span class="k">客户名称</span><br>Tên khách hàng</td><td>${e(sx.khach)}</td></tr>
<tr><td><span class="k">机台 / 模具编号</span><br>Máy số / Mã khuôn</td><td><b>${qcTenMayDu(r.may)}</b> / ${e(r.moldId)}</td><td><span class="k">订单编号</span><br>Mã số đơn hàng</td><td>${e(sx.donHang)}</td></tr>
<tr><td><span class="k">产品名称</span><br>Tên sản phẩm</td><td>${e(sx.tenSP)}${sx.mau || sx.nhua ? `<br><span class="k">Màu: ${e(sx.mau)} · Nhựa: ${e(sx.nhua)}</span>` : ''}</td><td><span class="k">送检数量</span><br>Số lượng đưa kiểm</td><td><b>${e(sx.slKiem)}</b></td></tr>
<tr><td colspan="2"><span class="k">成品</span> Thành phẩm ${o(sx.loai !== 'BTP')} &nbsp;&nbsp; <span class="k">半成品</span> Bán thành phẩm ${o(sx.loai === 'BTP')}</td><td colspan="2"></td></tr>
<tr><td><span class="k">送检原因</span><br>Nguyên nhân đưa kiểm</td><td colspan="3">${faiLyDoChon().map(k => `${o(r.lyDo === k)} ${FAI_LY_DO[k].ten}`).join(' &nbsp; ')}</td></tr>
<tr><td colspan="4" class="i">此部分由质检部分填写 – Hạng mục này dành cho bộ phận QC điền</td></tr>
<tr><th>项目<br>Danh mục</th><th>检验项目<br>Mục kiểm tra</th><th style="width:15%;">判定<br>Nhận xét</th><th>不良描述<br>Miêu tả lỗi</th></tr>
${dongMuc.join('')}
${dongThem.join('')}
<tr><td><span class="k">备注</span><br>Ghi chú</td><td colspan="3">${e(qc.ghiChu)}</td></tr>
<tr><td><span class="k">检验结果</span><br>Kết quả kiểm</td><td colspan="3" class="c" style="font-size:10pt;">合格 <b>Đạt</b> ${o(r.trangThai === 'dat')} &nbsp;&nbsp;&nbsp;&nbsp; 不合格 <b>Không đạt</b> ${o(r.trangThai === 'khong_dat')}</td></tr>
<tr><td class="s" colspan="2"><span class="k">检查员</span><br>Nhân viên QC ký<br><span class="k">${e(qc.nguoiKiem)}${qc.kiemLuc ? ' · ' + dkGio(qc.kiemLuc) : ''}</span></td><td class="s"><span class="k">车间主管签署</span><br>Chủ quản BPSX ký</td><td class="s"><span class="k">核准人签署</span><br>Người phê duyệt ký</td></tr>
</table>
<script>window.onload = () => { window.print(); };<\/script>
</body></html>`;
    let w = window.open('', '_blank');
    if (!w) { alert('⚠️ Trình duyệt chặn cửa sổ in – cho phép pop-up rồi bấm lại.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
}

// ===================== 11. XUẤT EXCEL =====================
async function faiXuatExcel() {
    if (typeof XLSX === 'undefined') { alert('Chưa tải được thư viện Excel.'); return; }
    let den = prompt('Xuất phiếu từ ngày (YYYY-MM-DD) đến ngày đang xem.\nNhập ngày bắt đầu:', faiXem.date);
    if (!den) return;
    let tu = den.trim(), toi = faiXem.date;
    if (tu > toi) [tu, toi] = [toi, tu];
    let rows = [['Ngày', 'Ca', 'Số phiếu', 'Máy', 'Mã khuôn', 'Tên SP', 'Khách hàng', 'Mã đơn', 'Màu', 'Nhựa', 'Lý do', 'SL đưa kiểm', 'Loại',
        'Ngoại quan', 'Màu sắc', 'Kích thước', 'Lắp ráp', 'Thông số máy', 'Miêu tả lỗi', 'Kết quả', 'QC', 'Giờ kiểm', 'Ghi chú']];
    let d = new Date(tu + 'T00:00:00'), end = new Date(toi + 'T00:00:00'), dem = 0;
    while (d <= end && dem < 93) {
        let ngay = dkISO(d), ds = {};
        try { ds = await faiDoc(`${FAI_PATH}/${ngay}`); } catch (e) {}
        Object.keys(ds).map(id => Object.assign({ id }, ds[id])).filter(r => r.may)
            .sort((a, b) => a.may - b.may || (a.taoLuc || 0) - (b.taoLuc || 0)).forEach(r => {
                let sx = r.sx || {}, qc = r.qc || {}, muc = qc.muc || {};
                let t = v => v === 'DAT' ? 'Đạt' : v === 'KDAT' ? 'Không đạt' : '';
                let loi = FAI_MUC.filter(m => (muc[m.ma] || {}).loi).map(m => `${m.ten}: ${muc[m.ma].loi}`).join('; ');
                rows.push([ngay, r.ca, r.soPhieu, `${qcTenMayDu(r.may)}`, r.moldId, sx.tenSP || '', sx.khach || '', sx.donHang || '', sx.mau || '', sx.nhua || '',
                    (FAI_LY_DO[r.lyDo] || {}).ten || r.lyDo, sx.slKiem || '', sx.loai === 'BTP' ? 'Bán thành phẩm' : 'Thành phẩm',
                    t((muc.ngoai || {}).kq), t((muc.mau || {}).kq), t((muc.kt || {}).kq), t((muc.lapRap || {}).kq), t((muc.tsMay || {}).kq), loi,
                    r.trangThai === 'dat' ? 'ĐẠT' : r.trangThai === 'khong_dat' ? 'KHÔNG ĐẠT' : 'Chờ kiểm', qc.nguoiKiem || '', qc.kiemLuc ? dkGio(qc.kiemLuc) : '', qc.ghiChu || '']);
            });
        d.setDate(d.getDate() + 1); dem++;
    }
    let ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = rows[0].map((h, i) => ({ wch: [5, 18, 19].includes(i) ? 30 : 13 }));
    rows[0].forEach((h, i) => { let c = ws[XLSX.utils.encode_cell({ r: 0, c: i })]; if (c) c.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0369A1' } }, alignment: { horizontal: 'center', wrapText: true } }; });
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hang dau tien');
    XLSX.writeFile(wb, `Kiem_hang_dau_tien_${tu}_${toi}.xlsx`);
}
