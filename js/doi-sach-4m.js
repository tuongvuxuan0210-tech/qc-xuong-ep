/**
 * QC System - Đối sách xử lý 4M + Bộ nhớ lỗi lặp lại
 * Xưởng Ép Nhựa Hải Tân
 *
 * - Mỗi lỗi ở Tab 3 được lập "phiếu đối sách" bắt buộc đủ 4M:
 *   Con người (Man) · Thiết bị (Machine) · Vật tư (Material) · Thao tác (Method)
 * - Bộ nhớ lỗi (Firebase: qc_defect_memory_v1) lưu mọi lần phát sinh lỗi
 *   để tự nhận biết lỗi LẦN ĐẦU hay LẶP LẠI (cùng loại lỗi + cùng mã khuôn),
 *   lặp lại lần thứ mấy, từng xảy ra ở máy nào.
 */

const QC_MEMORY_PATH = 'qc_defect_memory_v1';

// Bộ nhớ lỗi: id -> { d, k, src, m, kh, lt, ten, mt, o, ds, tt }
let qcDefectMemory = {};
let qcDefectMemoryLoaded = false;
let qcDefectMemoryBound = false;
let qcDefectMemoryWriteBlocked = false;
let qcDefectMemoryLoadPromise = null;

// Danh sách đang hiển thị ở Tab 3 (dùng cho modal + xuất Excel)
let tab3LastDisplayList = [];
let tab3LastAllDefects = [];
let qcDoiSachModalInstance = null;
let qcDoiSachDangMo = null;

// ===================== 1. PHÂN LOẠI LỖI CHUẨN =====================
// Thứ tự quan trọng: mục nào khớp trước sẽ được chọn.
const QC_LOAI_LOI_CHUAN = [
    { ma: 'LAN_VE',     ten: 'Lẫn vế / Lẫn hàng',          tu: ['lẫn vế', 'lẫn hàng', 'lẫn sp', 'lẫn sản phẩm', 'lan ve', 'lẫn'] },
    { ma: 'THIEU_NHUA', ten: 'Thiếu nhựa (không đầy)',      tu: ['thiếu nhựa', 'thieu nhua', 'không đầy', 'khong day', 'hụt nhựa', 'short shot'] },
    { ma: 'BAVIA',      ten: 'Bavia / Dư nhựa',             tu: ['bavia', 'ba via', 'ba-via', 'bavi', 'dư nhựa', 'du nhua', 'flash'] },
    { ma: 'CAO_GATE',   ten: 'Cao gate / Dư cuống phun',    tu: ['gate', 'cuống', 'đuôi keo', 'điểm phun', 'cao cổng'] },
    { ma: 'XUOC',       ten: 'Xước / Trầy bề mặt',          tu: ['xước', 'xuoc', 'trầy'] },
    { ma: 'KHAC_MAU_SP',ten: 'Khác mẫu / Sai mẫu chuẩn',    tu: ['khác mẫu', 'sai mẫu', 'lệch mẫu', 'không giống mẫu', 'khac mau sp'] },
    { ma: 'SAI_MAU',    ten: 'Sai màu / Loang màu',         tu: ['sai màu', 'khác màu', 'loang', 'lệch màu', 'nhạt màu', 'đậm màu', 'màu không đều', 'lẫn màu'] },
    { ma: 'DOM_DEN',    ten: 'Đốm đen / Dị vật / Bẩn',      tu: ['đốm', 'chấm đen', 'dị vật', 'tạp chất', 'bẩn', 'dính dầu', 'vết dầu'] },
    { ma: 'CHAY',       ten: 'Cháy / Ố vàng',               tu: ['cháy', 'ố vàng', 'khét', 'vàng ố'] },
    { ma: 'BOT_KHI',    ten: 'Bọt khí / Rỗ khí',            tu: ['bọt', 'rỗ', 'bong bóng', 'rỗ khí'] },
    { ma: 'CO_LOM',     ten: 'Co rút / Lõm bề mặt',         tu: ['co rút', 'co ngót', 'lõm', 'lún'] },
    { ma: 'CONG_VENH',  ten: 'Cong vênh / Biến dạng',       tu: ['cong', 'vênh', 'biến dạng', 'méo'] },
    { ma: 'DUONG_HAN',  ten: 'Đường hàn / Vân dòng chảy',   tu: ['đường hàn', 'vân', 'dòng chảy', 'sóng nhựa'] },
    { ma: 'NUT_VO',     ten: 'Nứt / Vỡ / Gãy',              tu: ['nứt', 'vỡ', 'gãy', 'bể', 'trắng ứng suất'] },
    { ma: 'VET_TY',     ten: 'Vết ty đẩy / Lồi ty',         tu: ['vết ty', 'ty đẩy', 'lồi ty', 'thủng ty'] },
    { ma: 'KICH_THUOC', ten: 'Sai kích thước',              tu: ['kích thước', 'dung sai', 'dày', 'mỏng', 'dài', 'ngắn'] },
    { ma: 'LAP_RAP',    ten: 'Lỗi lắp ráp',                 tu: ['lắp', 'kẹt', 'hở', 'lỏng', 'chặt'] },
    { ma: 'NGOAI_QUAN', ten: 'Ngoại quan (khác)',           tu: [] },
    { ma: 'KHUON_MAY',  ten: 'Lỗi khuôn / máy (Tab 1)',     tu: [] },
    { ma: 'KQ_SP_NG',   ten: 'Kết quả SP NG (Tab 1)',       tu: [] }
];

function qcTenLoaiLoi(ma) {
    if (!ma) return '';
    let f = QC_LOAI_LOI_CHUAN.find(x => x.ma === ma);
    if (f) return f.ten;
    if (ma.startsWith('KHAC_')) return 'Khác: ' + ma.substring(5).replace(/_/g, ' ');
    return ma;
}

function qcBoDau(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// Tự nhận diện loại lỗi từ mô tả + hạng mục
function qcNhanDienLoaiLoi(moTa, hangMuc, nguon) {
    let txt = String(moTa || '').normalize('NFC').toLowerCase();
    for (let loai of QC_LOAI_LOI_CHUAN) {
        if (loai.tu.some(t => txt.includes(t))) return loai.ma;
    }
    let hm = String(hangMuc || '');
    if (hm.includes('Màu Sắc')) return 'SAI_MAU';
    if (hm.includes('Kích Thước')) return 'KICH_THUOC';
    if (hm.includes('Lắp Ráp')) return 'LAP_RAP';
    if (hm.includes('Ngoại Quan')) return 'NGOAI_QUAN';
    if (nguon === 'TAB1') {
        if (/Cơ khí|Làm mát|Ty đẩy|Rót nhựa/.test(hm)) return 'KHUON_MAY';
        if (hm.includes('KQ SP NG')) return 'KQ_SP_NG';
    }
    // Không khớp từ điển: dùng chính mô tả đã chuẩn hóa làm mã (bỏ các chữ thừa)
    let slug = qcBoDau(txt)
        .replace(/\b(cai tien|ok|sl|da xu ly|xu ly|loi|bi|co)\b/g, ' ')
        .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!slug) return 'NGOAI_QUAN';
    return 'KHAC_' + slug.substring(0, 40).trim().replace(/ /g, '_');
}

// Thứ tự thời gian trong ngày: ca ngày trước ca đêm, giờ đêm sau 0h cộng 24
function qcThuTuThoiGian(date, ca, gio) {
    let caIdx = String(ca || '').includes('Đêm') ? 1 : 0;
    let phut = 0;
    if (gio === 'Đầu ca') phut = 0;
    else if (gio === 'Cuối ca') phut = 9999;
    else if (/^\d{1,2}:\d{2}$/.test(gio || '')) {
        let [h, mi] = gio.split(':').map(Number);
        if (caIdx === 1 && h < 12) h += 24;
        phut = h * 60 + mi;
    }
    return `${date}|${caIdx}|${String(phut).padStart(4, '0')}`;
}

function qcMemoryId(date, key) {
    return getSafeFirebaseKey(`${date}__${key}`);
}

// ===================== 2. THU THẬP LỖI THEO NGÀY =====================
// Trả về danh sách lỗi của 1 ngày (chưa áp bộ lọc xưởng/ca)
function qcThuThapLoiTheoNgay(date) {
    let list = [];
    let actionsData = tab3ActionNotesStore[date] || {};

    let t1Data = tab1Store[date] || {};
    Object.keys(t1Data).forEach(key => {
        if (key.endsWith('_inspector')) return;
        let rec = t1Data[key], p = key.split('_');
        if (!rec || typeof rec !== 'object') return;
        let mNum = parseInt(String(p[0]).replace('M', '')) || 0;
        if (mNum < 1 || mNum > TOTAL_MACHINES) return;
        let isMoldNG = rec.moldCheckOverall === 'NG', isResNG = rec.result === 'NG';
        if (!isMoldNG && !isResNG) return;

        let shiftInspector = t1Data[`${p[0]}_${p[1]}_inspector`] || t1Data[`${p[1]}_inspector`] || '';
        let cat = [];
        if (isResNG) cat.push('KQ SP NG');
        if (isMoldNG && rec.moldCheckDetails) {
            let d = rec.moldCheckDetails;
            if (d.mech === 'NG') cat.push(`Cơ khí (${d.mechNote || 'NG'})`);
            if (d.cool === 'NG') cat.push(`Làm mát (${d.coolNote || 'NG'})`);
            if (d.eject === 'NG') cat.push(`Ty đẩy (${d.ejectNote || 'NG'})`);
            if (d.runner === 'NG') cat.push(`Rót nhựa (${d.runnerNote || 'NG'})`);
        }
        let descText = rec.note ? rec.note.trim() : (cat.join('; ') || 'Lỗi kiểm tra Tab 1');
        list.push({
            date, source: 'TAB1', key: `T1_${key}`, machine: p[0],
            ws: mNum <= 10 ? 'XUONG1' : 'XUONG2', isDay: String(p[1] || '').includes('Ngày'),
            shiftTime: p[2] ? `${p[1]} (${p[2]})` : p[1], inspector: shiftInspector, moldId: rec.moldId || '',
            category: cat.join(', ') || 'Lỗi Máy/Khuôn', defectQty: 0, description: descText,
            savedAction: typeof actionsData[`T1_${key}`] === 'string' ? actionsData[`T1_${key}`] : '',
            doiSach: actionsData[`T1_${key}_4m`] || null,
            order: qcThuTuThoiGian(date, p[1], p[2] || 'Đầu ca')
        });
    });

    let t2Data = tab2Store[date] || {};
    Object.keys(t2Data).forEach(key => {
        if (key.endsWith('_inspector')) return;
        let rec = t2Data[key], p = key.split('_');
        if (!rec || typeof rec !== 'object') return;
        let mNum = parseInt(String(p[0]).replace('M', '')) || 0;
        if (mNum < 1 || mNum > TOTAL_MACHINES) return;
        let total = parseInt(rec.totalCheck) || 0, defectQty = parseInt(rec.defectCheck) || 0;
        let defectRatio = total > 0 ? (defectQty / total) : 0;
        let isNGByRatio = defectRatio > 0.20;
        if (!(rec.overall === 'NG' || isNGByRatio || defectQty > 0)) return;

        let shiftInspector = t2Data[`${p[0]}_${p[1]}_inspector`] || t2Data[`${p[1]}_inspector`] || '';
        let cat = [];
        if (rec.colorCheck === 'NG') cat.push('Màu Sắc');
        if (rec.visual === 'NG') cat.push('Ngoại Quan');
        if (rec.dimension === 'NG') cat.push('Kích Thước');
        if (rec.mechanical === 'NG') cat.push('Lắp Ráp');
        if (isNGByRatio) cat.push(`Tỷ lệ lỗi >20% (${(defectRatio * 100).toFixed(0)}%)`);
        let descText = rec.note ? rec.note.trim() : (cat.join(', ') || 'Lỗi mẫu định kỳ');
        list.push({
            date, source: 'TAB2', key: `T2_${key}`, machine: p[0],
            ws: mNum <= 10 ? 'XUONG1' : 'XUONG2', isDay: String(p[1] || '').includes('Ngày'),
            shiftTime: `${p[1]} [${p[2]}]`, inspector: shiftInspector, moldId: rec.moldId || '',
            category: cat.join(', ') || 'Lỗi SP Định Kỳ', defectQty, description: descText,
            savedAction: typeof actionsData[`T2_${key}`] === 'string' ? actionsData[`T2_${key}`] : '',
            doiSach: actionsData[`T2_${key}_4m`] || null,
            order: qcThuTuThoiGian(date, p[1], p[2])
        });
    });

    list.forEach(it => {
        let tuDong = qcNhanDienLoaiLoi(it.description, it.category, it.source);
        it.loaiLoiTuDong = tuDong;
        it.loaiLoi = (it.doiSach && it.doiSach.loaiLoi) ? it.doiSach.loaiLoi : tuDong;
    });
    return list;
}

// Chuyển 1 lỗi thành bản ghi bộ nhớ (gọn nhẹ)
function qcTaoBanGhiBoNho(it) {
    let ds = it.doiSach;
    let tomTat = '';
    if (ds) tomTat = qcTomTatDoiSach(ds).substring(0, 400);
    else if (it.savedAction) tomTat = String(it.savedAction).substring(0, 400);
    return {
        d: it.date, k: it.key, src: it.source, m: it.machine,
        kh: String(it.moldId || '').trim(), lt: it.loaiLoi,
        mt: String(it.description || '').substring(0, 150), o: it.order,
        ds: tomTat, tt: ds ? (ds.trangThai || '') : ''
    };
}

function qcTomTatDoiSach(ds) {
    if (!ds) return '';
    return `[Người] ${ds.man || '-'} | [Thiết bị] ${ds.machine || '-'} | [Vật tư] ${ds.material || '-'} | [Thao tác] ${ds.method || '-'}`;
}

function qcDu4M(ds) {
    return !!(ds && ['man', 'machine', 'material', 'method'].every(k => String(ds[k] || '').trim()));
}

// ===================== 3. BỘ NHỚ LỖI (FIREBASE) =====================
function qcEnsureDefectMemory() {
    if (!isConnected || !db) return Promise.resolve();
    if (qcDefectMemoryLoaded) return Promise.resolve();
    if (qcDefectMemoryLoadPromise) return qcDefectMemoryLoadPromise;
    qcDefectMemoryLoadPromise = db.ref(QC_MEMORY_PATH).once('value').then(s => {
        qcDefectMemory = s.val() || {};
        qcDefectMemoryLoaded = true;
        if (!qcDefectMemoryBound) {
            qcDefectMemoryBound = true;
            db.ref(QC_MEMORY_PATH).on('value', snap => {
                qcDefectMemory = snap.val() || {};
                if (typeof debouncedRenderTab3 === 'function' && isEditMode) debouncedRenderTab3();
            });
        }
    }).catch(err => {
        console.warn('Không đọc được bộ nhớ lỗi:', err);
        qcDefectMemoryLoaded = true; // vẫn chạy được với dữ liệu trong khoảng ngày đang xem
    }).finally(() => { qcDefectMemoryLoadPromise = null; });
    return qcDefectMemoryLoadPromise;
}

function qcResetDefectMemory() {
    if (qcDefectMemoryBound && db) { try { db.ref(QC_MEMORY_PATH).off(); } catch (e) {} }
    qcDefectMemory = {}; qcDefectMemoryLoaded = false; qcDefectMemoryBound = false;
    tab3LastDisplayList = []; tab3LastAllDefects = [];
}

function qcBanGhiKhacNhau(a, b) {
    if (!a || !b) return true;
    return ['d', 'k', 'src', 'm', 'kh', 'lt', 'mt', 'o', 'ds', 'tt'].some(f => String(a[f] || '') !== String(b[f] || ''));
}

// Đồng bộ các lỗi của những ngày đã tải vào bộ nhớ (thêm mới / cập nhật / xóa lỗi đã được sửa thành OK)
function qcDongBoBoNho(dates, allDefects) {
    if (!isConnected || !db || !qcDefectMemoryLoaded || qcDefectMemoryWriteBlocked || !isEditMode) return Promise.resolve(0);
    let updates = {};
    let idsHienTai = new Set();
    allDefects.forEach(it => {
        let id = qcMemoryId(it.date, it.key);
        idsHienTai.add(id);
        let moi = qcTaoBanGhiBoNho(it);
        let cu = qcDefectMemory[id];
        // Nếu ngày đó chưa tải ghi chú đối sách thì giữ đối sách cũ trong bộ nhớ
        if (cu && !tab3ActionNotesStore[it.date]) { moi.ds = cu.ds || ''; moi.tt = cu.tt || ''; }
        if (qcBanGhiKhacNhau(cu, moi)) updates[id] = moi;
    });
    let dateSet = new Set(dates.filter(d => tab1Store[d] && tab2Store[d]));
    Object.keys(qcDefectMemory).forEach(id => {
        let r = qcDefectMemory[id];
        if (r && dateSet.has(r.d) && !idsHienTai.has(id)) updates[id] = null;
    });
    let n = Object.keys(updates).length;
    if (n === 0) return Promise.resolve(0);
    Object.keys(updates).forEach(id => {
        if (updates[id] === null) delete qcDefectMemory[id]; else qcDefectMemory[id] = updates[id];
    });
    return db.ref(QC_MEMORY_PATH).update(updates).then(() => n).catch(err => {
        console.warn('Không ghi được bộ nhớ lỗi (kiểm tra Firebase Rules cho nhánh ' + QC_MEMORY_PATH + '):', err);
        qcDefectMemoryWriteBlocked = true;
        return 0;
    });
}

// Quét lại lịch sử N ngày để nạp đầy đủ bộ nhớ lỗi
async function qcQuetBoNhoLoi() {
    if (!checkAuthOrAlert()) return;
    if (!isConnected || !db) { alert('⚠️ Chưa kết nối Firebase!'); return; }
    let soNgay = prompt('🧠 Quét lại lịch sử lỗi bao nhiêu ngày gần nhất để nạp vào bộ nhớ?\n(Dùng 1 lần khi mới cài, hoặc khi nghi bộ nhớ thiếu)', '90');
    if (soNgay === null) return;
    soNgay = Math.max(1, Math.min(365, parseInt(soNgay) || 90));
    let btn = document.getElementById('btnQuetBoNhoLoi');
    let nhanCu = btn ? btn.innerHTML : '';
    try {
        await qcEnsureDefectMemory();
        qcDefectMemoryWriteBlocked = false;
        let den = getTodayISO();
        let tu = new Date(); tu.setDate(tu.getDate() - soNgay + 1);
        let tuStr = `${tu.getFullYear()}-${String(tu.getMonth() + 1).padStart(2, '0')}-${String(tu.getDate()).padStart(2, '0')}`;
        let dates = getDatesInRange(tuStr, den);
        for (let i = 0; i < dates.length; i += 10) {
            if (btn) btn.innerHTML = `⏳ Đang quét ${Math.min(i + 10, dates.length)}/${dates.length} ngày...`;
            await Promise.all(dates.slice(i, i + 10).map(d => Promise.all([
                tab1Store[d] ? null : db.ref(`qc_tab1_store_v1/${d}`).once('value').then(s => tab1Store[d] = s.val() || {}),
                tab2Store[d] ? null : db.ref(`qc_tab2_store_v1/${d}`).once('value').then(s => tab2Store[d] = s.val() || {}),
                tab3ActionNotesStore[d] ? null : db.ref(`qc_tab3_actions_v1/${d}`).once('value').then(s => tab3ActionNotesStore[d] = s.val() || {})
            ])));
        }
        let all = [];
        dates.forEach(d => all.push(...qcThuThapLoiTheoNgay(d)));
        let n = await qcDongBoBoNho(dates, all);
        if (qcDefectMemoryWriteBlocked) {
            alert('⚠️ Không ghi được bộ nhớ lỗi lên Firebase (bị chặn bởi Firebase Rules).\nCần cho phép đọc/ghi nhánh "' + QC_MEMORY_PATH + '" cho tài khoản đã đăng nhập.');
        } else {
            alert(`🟢 Đã quét ${dates.length} ngày: tìm thấy ${all.length} lần lỗi, cập nhật ${n} bản ghi vào bộ nhớ.`);
        }
        renderTab3();
    } catch (e) {
        alert('❌ Lỗi khi quét lịch sử: ' + e.message);
    } finally {
        if (btn) btn.innerHTML = nhanCu;
    }
}

// ===================== 4. PHÂN TÍCH LẶP LẠI =====================
function qcDoiTuong(r) {
    return r.kh ? 'KH:' + String(r.kh).trim().toUpperCase() : 'MAY:' + r.m;
}

function qcNgayNgan(d) {
    let p = String(d || '').split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}` : d;
}

// pool: id -> bản ghi bộ nhớ (đã gộp dữ liệu đang xem)
function qcPhanTichLapLai(it, pool) {
    let id = qcMemoryId(it.date, it.key);
    let me = pool[id] || qcTaoBanGhiBoNho(it);
    let target = qcDoiTuong(me);
    let cung = [], khuonKhac = [];
    Object.keys(pool).forEach(k => {
        let r = pool[k];
        if (!r || r.lt !== me.lt) return;
        if (qcDoiTuong(r) === target) cung.push({ id: k, ...r });
        else khuonKhac.push({ id: k, ...r });
    });
    cung.sort((a, b) => String(a.o).localeCompare(String(b.o)) || String(a.k).localeCompare(String(b.k)));
    let idx = cung.findIndex(r => r.id === id);
    if (idx < 0) { cung.push({ id, ...me }); idx = cung.length - 1; }
    let truoc = cung.slice(0, idx);
    let sau = cung.slice(idx + 1);

    let theoMay = {};
    truoc.forEach(r => {
        if (!theoMay[r.m]) theoMay[r.m] = [];
        theoMay[r.m].push(r.d);
    });
    let mayKhac = {};
    khuonKhac.forEach(r => { mayKhac[r.m] = (mayKhac[r.m] || 0) + 1; });

    return {
        lanThu: idx + 1, tongSo: cung.length, lapLai: idx > 0,
        truoc, sau, theoMay, khuonKhacSoLan: khuonKhac.length, mayKhac,
        doiTuongText: me.kh ? `khuôn ${me.kh}` : `máy ${me.m}`
    };
}

function qcHtmlLapLai(it, pt) {
    let tenLoi = qcTenLoaiLoi(it.loaiLoi);
    let html = `<div class="qc-loai-loi-chip" title="Loại lỗi chuẩn dùng để so sánh lặp lại">🏷️ ${escapeHtml(tenLoi)}</div>`;
    if (!pt.lapLai) {
        html += `<span class="badge qc-badge-lan-dau">🆕 LẦN ĐẦU</span>`;
        if (pt.sau.length > 0) html += `<div class="qc-lap-note text-warning">⚠️ Sau đó đã lặp lại ${pt.sau.length} lần</div>`;
    } else {
        html += `<span class="badge qc-badge-lap-lai">🔁 LẶP LẠI – LẦN ${pt.lanThu}</span>`;
        let dongMay = Object.keys(pt.theoMay).sort().map(m => {
            let ngay = pt.theoMay[m].map(qcNgayNgan);
            return `<b>${escapeHtml(m)}</b> ×${ngay.length} <span class="qc-lap-ngay">(${escapeHtml(ngay.slice(-3).join(', '))}${ngay.length > 3 ? '…' : ''})</span>`;
        }).join('<br>');
        html += `<div class="qc-lap-note">Đã từng xảy ra ${pt.truoc.length} lần trên ${escapeHtml(pt.doiTuongText)}:<br>${dongMay}</div>`;
    }
    if (pt.khuonKhacSoLan > 0 && !String(it.loaiLoi).startsWith('KHAC_')) {
        let mk = Object.keys(pt.mayKhac).sort().map(m => `${m}×${pt.mayKhac[m]}`).join(', ');
        html += `<div class="qc-lap-note qc-lap-muted" title="Cùng loại lỗi nhưng khác mã khuôn">🌐 Cùng loại ở khuôn khác: ${pt.khuonKhacSoLan} lần (${escapeHtml(mk)})</div>`;
    }
    return html;
}

function qcHtmlDoiSach(it, pt, idx) {
    let ds = it.doiSach;
    let btn = (txt, cls) => `<button type="button" class="btn btn-sm ${cls} fw-bold rounded-pill px-3 py-1 mt-1 t3-action-btn" onclick="qcMoPhieuDoiSach(${idx})">${txt}</button>`;
    if (ds && qcDu4M(ds)) {
        let rut = s => escapeHtml(String(s || '').length > 70 ? String(s).substring(0, 70) + '…' : String(s || ''));
        let tt = ds.trangThai || 'Đang thực hiện';
        let ttCls = tt === 'Đã xác nhận hiệu quả' ? 'bg-success' : (tt === 'Đã hoàn thành' ? 'bg-primary' : 'bg-warning text-dark');
        let thieuDanhGia = pt.lapLai && !String(ds.danhGiaLapLai || '').trim();
        return `
        <div class="qc-4m-box text-start">
            <div class="qc-4m-line" title="${escapeHtml(ds.man)}">👷 <b>Người:</b> ${rut(ds.man)}</div>
            <div class="qc-4m-line" title="${escapeHtml(ds.machine)}">⚙️ <b>Thiết bị:</b> ${rut(ds.machine)}</div>
            <div class="qc-4m-line" title="${escapeHtml(ds.material)}">🧪 <b>Vật tư:</b> ${rut(ds.material)}</div>
            <div class="qc-4m-line" title="${escapeHtml(ds.method)}">📋 <b>Thao tác:</b> ${rut(ds.method)}</div>
            <div class="d-flex flex-wrap align-items-center gap-1 mt-1">
                <span class="badge ${ttCls}">${escapeHtml(tt)}</span>
                ${ds.phuTrach ? `<span class="badge bg-secondary">👤 ${escapeHtml(ds.phuTrach)}</span>` : ''}
                ${ds.hanXuLy ? `<span class="badge bg-secondary">⏰ ${escapeHtml(qcNgayNgan(ds.hanXuLy))}</span>` : ''}
                ${thieuDanhGia ? `<span class="badge bg-danger">Thiếu đánh giá lặp lại</span>` : ''}
            </div>
            ${btn('✏️ Xem / Sửa đối sách', 'btn-outline-info')}
        </div>`;
    }
    let cu = it.savedAction ? `<div class="qc-4m-old text-start">📝 Ghi chú cũ: ${escapeHtml(it.savedAction)}</div>` : '';
    return `${cu}<div class="qc-4m-missing">${ds ? '⚠️ Đối sách chưa đủ 4M' : '⚠️ Chưa lập đối sách 4M'}</div>
        ${btn(pt.lapLai ? '📝 Lập đối sách 4M (lỗi lặp lại)' : '📝 Lập đối sách 4M', pt.lapLai ? 'btn-danger' : 'btn-3d-primary')}`;
}

// ===================== 5. PHIẾU ĐỐI SÁCH 4M (MODAL) =====================
function qcTaoModalDoiSach() {
    if (document.getElementById('qcDoiSachModal')) return;
    let options = QC_LOAI_LOI_CHUAN.map(l => `<option value="${l.ma}">${escapeHtml(l.ten)}</option>`).join('');
    let m4 = [
        ['man', '👷 1. CON NGƯỜI (Man)', 'VD: Đào tạo lại thao tác cắt gate cho công nhân ca ngày; QC tăng tần suất kiểm 1h/lần trong 3 ngày...'],
        ['machine', '⚙️ 2. THIẾT BỊ (Machine – Máy / Khuôn)', 'VD: Tăng áp suất giữ 5 bar, vệ sinh vent khuôn, kiểm tra nhiệt độ khuôn, thay ty đẩy...'],
        ['material', '🧪 3. VẬT TƯ (Material – Nhựa / Màu / Phụ liệu)', 'VD: Kiểm tra độ ẩm nhựa, sấy đủ 2h, kiểm tra lô màu, tỷ lệ nhựa tái sinh...'],
        ['method', '📋 4. THAO TÁC (Method – Phương pháp / Quy trình)', 'VD: Bổ sung bước kiểm tra vế trái/phải vào SOP đóng gói, dùng khay tách riêng từng vế...']
    ].map(([k, nhan, ph]) => `
        <div class="qc-4m-field mb-2">
            <div class="d-flex justify-content-between align-items-center mb-1">
                <label class="fw-bold small qc-4m-label" for="qcDs_${k}">${nhan} <span class="text-danger">*</span></label>
                <button type="button" class="btn btn-xs btn-outline-secondary py-0 px-2" style="font-size:11px;" onclick="qcDienKhongLienQuan('${k}')">Đã kiểm tra – không phải nguyên nhân</button>
            </div>
            <textarea class="form-control form-control-sm qc-4m-input" id="qcDs_${k}" rows="2" maxlength="600" placeholder="${escapeHtml(ph)}"></textarea>
        </div>`).join('');

    let div = document.createElement('div');
    div.innerHTML = `
    <div class="modal fade" id="qcDoiSachModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
        <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
            <div class="modal-content rounded-4">
                <div class="modal-header py-2" style="background: linear-gradient(90deg, #0284c7, #0369a1);">
                    <h6 class="modal-title fw-bold m-0 text-white">🛠️ PHIẾU ĐỐI SÁCH XỬ LÝ LỖI – 4M</h6>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body p-3">
                    <div id="qcDsThongTin" class="qc-ds-info mb-2"></div>
                    <div id="qcDsLapLai" class="mb-2"></div>
                    <div class="row g-2 mb-2">
                        <div class="col-md-6">
                            <label class="fw-bold small" for="qcDs_loaiLoi">🏷️ Loại lỗi chuẩn (dùng để nhận diện lặp lại)</label>
                            <select class="form-select form-select-sm fw-bold" id="qcDs_loaiLoi" onchange="qcCapNhatLapLaiTrongModal()">${options}</select>
                            <div class="small text-muted mt-1" id="qcDsGoiYLoai"></div>
                        </div>
                        <div class="col-md-6">
                            <label class="fw-bold small" for="qcDs_nguyenNhan">🔍 Nguyên nhân gốc (tóm tắt)</label>
                            <textarea class="form-control form-control-sm" id="qcDs_nguyenNhan" rows="2" maxlength="500" placeholder="VD: Áp suất phun thấp do van tỷ lệ yếu..."></textarea>
                        </div>
                    </div>
                    ${m4}
                    <div id="qcDsDanhGiaWrap" class="qc-4m-field mb-2" style="display:none;">
                        <label class="fw-bold small text-danger" for="qcDs_danhGiaLapLai">🔁 Vì sao đối sách lần trước chưa ngăn được lỗi lặp lại? <span class="text-danger">*</span></label>
                        <textarea class="form-control form-control-sm" id="qcDs_danhGiaLapLai" rows="2" maxlength="600" placeholder="VD: Lần trước chỉ chỉnh thông số, chưa đào tạo ca đêm / chưa đưa vào SOP..."></textarea>
                    </div>
                    <div class="row g-2">
                        <div class="col-md-4">
                            <label class="fw-bold small" for="qcDs_phuTrach">👤 Người phụ trách</label>
                            <input type="text" class="form-control form-control-sm" id="qcDs_phuTrach" maxlength="80">
                        </div>
                        <div class="col-md-4">
                            <label class="fw-bold small" for="qcDs_hanXuLy">⏰ Hạn hoàn thành</label>
                            <input type="date" class="form-control form-control-sm" id="qcDs_hanXuLy">
                        </div>
                        <div class="col-md-4">
                            <label class="fw-bold small" for="qcDs_trangThai">📌 Trạng thái</label>
                            <select class="form-select form-select-sm fw-bold" id="qcDs_trangThai">
                                <option>Đang thực hiện</option>
                                <option>Đã hoàn thành</option>
                                <option>Đã xác nhận hiệu quả</option>
                            </select>
                        </div>
                    </div>
                    <div id="qcDsGhiChuCu" class="qc-4m-old mt-2" style="display:none;"></div>
                    <div id="qcDsCapNhat" class="small text-muted mt-2"></div>
                </div>
                <div class="modal-footer py-2">
                    <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>
                    <button type="button" class="btn btn-sm btn-3d-emerald px-4" onclick="qcLuuPhieuDoiSach()">💾 Lưu đối sách</button>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);
}

function qcDienKhongLienQuan(k) {
    let el = document.getElementById('qcDs_' + k);
    if (el) el.value = 'Đã kiểm tra – không phải nguyên nhân, không cần đối sách.';
}

function qcPoolHienTai() {
    let pool = { ...qcDefectMemory };
    tab3LastAllDefects.forEach(it => { pool[qcMemoryId(it.date, it.key)] = qcTaoBanGhiBoNho(it); });
    return pool;
}

function qcMoPhieuDoiSach(idx) {
    if (!checkAuthOrAlert()) return;
    let it = tab3LastDisplayList[idx];
    if (!it) return;
    qcTaoModalDoiSach();
    qcDoiSachDangMo = it;
    let ds = it.doiSach || {};

    document.getElementById('qcDsThongTin').innerHTML = `
        <div><b>📅 ${escapeHtml(it.date)}</b> · <b>${escapeHtml(it.machine)}</b> · ${escapeHtml(it.shiftTime)} · QC: ${escapeHtml(it.inspector || '-')}</div>
        <div>🧩 Khuôn: <b>${escapeHtml(it.moldId || 'Chưa rõ')}</b> · Hạng mục: ${escapeHtml(it.category)} ${it.defectQty > 0 ? `· SL lỗi: <b>${it.defectQty}</b>` : ''}</div>
        <div>📌 Mô tả lỗi: <b class="text-danger">${escapeHtml(it.description)}</b></div>`;

    let sel = document.getElementById('qcDs_loaiLoi');
    if (!Array.from(sel.options).some(o => o.value === it.loaiLoi)) {
        let o = document.createElement('option'); o.value = it.loaiLoi; o.textContent = qcTenLoaiLoi(it.loaiLoi); o.dataset.tam = '1';
        sel.appendChild(o);
    }
    if (!Array.from(sel.options).some(o => o.value === it.loaiLoiTuDong)) {
        let o = document.createElement('option'); o.value = it.loaiLoiTuDong; o.textContent = qcTenLoaiLoi(it.loaiLoiTuDong); o.dataset.tam = '1';
        sel.appendChild(o);
    }
    sel.value = it.loaiLoi;
    document.getElementById('qcDsGoiYLoai').textContent = `Hệ thống tự nhận diện: ${qcTenLoaiLoi(it.loaiLoiTuDong)}. Đổi nếu nhận diện chưa đúng.`;

    ['man', 'machine', 'material', 'method', 'nguyenNhan', 'danhGiaLapLai', 'phuTrach', 'hanXuLy'].forEach(k => {
        let el = document.getElementById('qcDs_' + k); if (el) el.value = ds[k] || '';
    });
    document.getElementById('qcDs_trangThai').value = ds.trangThai || 'Đang thực hiện';
    let cu = document.getElementById('qcDsGhiChuCu');
    if (it.savedAction && !it.doiSach) { cu.style.display = ''; cu.innerHTML = `📝 Ghi chú xử lý cũ (trước khi có 4M): ${escapeHtml(it.savedAction)}`; }
    else cu.style.display = 'none';
    document.getElementById('qcDsCapNhat').textContent = ds.capNhatLuc ? `Cập nhật lần cuối: ${ds.capNhatLuc} bởi ${ds.capNhatBoi || '-'}` : '';

    qcCapNhatLapLaiTrongModal();
    if (!qcDoiSachModalInstance) qcDoiSachModalInstance = new bootstrap.Modal(document.getElementById('qcDoiSachModal'));
    qcDoiSachModalInstance.show();
}

// Khi đổi loại lỗi trong phiếu: tính lại lặp lại ngay
function qcCapNhatLapLaiTrongModal() {
    let it = qcDoiSachDangMo; if (!it) return;
    let loai = document.getElementById('qcDs_loaiLoi').value;
    let tam = { ...it, loaiLoi: loai };
    let pool = qcPoolHienTai();
    pool[qcMemoryId(it.date, it.key)] = qcTaoBanGhiBoNho(tam);
    let pt = qcPhanTichLapLai(tam, pool);
    let box = document.getElementById('qcDsLapLai');
    if (!pt.lapLai) {
        box.innerHTML = `<div class="qc-ds-lan-dau">🆕 <b>LỖI LẦN ĐẦU</b> – chưa từng ghi nhận lỗi "${escapeHtml(qcTenLoaiLoi(loai))}" trên ${escapeHtml(pt.doiTuongText)}.</div>`;
    } else {
        let dong = pt.truoc.slice().reverse().map(r => `
            <tr><td>${escapeHtml(r.d)}</td><td><b>${escapeHtml(r.m)}</b></td><td>${escapeHtml(r.mt || '')}</td>
            <td class="text-start">${escapeHtml(r.ds || '— chưa có đối sách —')}${r.tt ? ` <span class="badge bg-secondary">${escapeHtml(r.tt)}</span>` : ''}</td></tr>`).join('');
        let tongMay = Object.keys(pt.theoMay).sort().map(m => `${m} ×${pt.theoMay[m].length}`).join(', ');
        box.innerHTML = `<div class="qc-ds-lap-lai">🔁 <b>LỖI LẶP LẠI – LẦN THỨ ${pt.lanThu}</b> trên ${escapeHtml(pt.doiTuongText)}. Đã từng xảy ra ${pt.truoc.length} lần ở: <b>${escapeHtml(tongMay)}</b>
            <div class="table-responsive mt-1"><table class="table table-sm table-bordered mb-0 small align-middle">
            <thead><tr><th>Ngày</th><th>Máy</th><th>Mô tả</th><th>Đối sách đã làm</th></tr></thead><tbody>${dong}</tbody></table></div></div>`;
    }
    document.getElementById('qcDsDanhGiaWrap').style.display = pt.lapLai ? '' : 'none';
    qcDoiSachDangMo._lapLaiTrongModal = pt.lapLai;
}

function qcLuuPhieuDoiSach() {
    if (!checkAuthOrAlert()) return;
    let it = qcDoiSachDangMo; if (!it) return;
    let get = k => (document.getElementById('qcDs_' + k).value || '').trim();
    let ds = {
        loaiLoi: get('loaiLoi'),
        nguyenNhan: get('nguyenNhan'),
        man: get('man'), machine: get('machine'), material: get('material'), method: get('method'),
        danhGiaLapLai: it._lapLaiTrongModal ? get('danhGiaLapLai') : '',
        phuTrach: get('phuTrach'), hanXuLy: get('hanXuLy'), trangThai: get('trangThai'),
        capNhatLuc: new Date().toLocaleString('vi-VN'),
        capNhatBoi: (currentUser && currentUser.email) || ''
    };
    let thieu = [['man', 'Con người'], ['machine', 'Thiết bị'], ['material', 'Vật tư'], ['method', 'Thao tác']].filter(([k]) => !ds[k]).map(x => x[1]);
    if (thieu.length) {
        alert(`⚠️ Đối sách phải đủ 4M. Còn thiếu: ${thieu.join(', ')}.\nNếu M nào không phải nguyên nhân, bấm "Đã kiểm tra – không phải nguyên nhân".`);
        return;
    }
    if (it._lapLaiTrongModal && !ds.danhGiaLapLai) {
        alert('⚠️ Đây là lỗi LẶP LẠI – vui lòng ghi rõ vì sao đối sách lần trước chưa ngăn được lỗi.');
        document.getElementById('qcDs_danhGiaLapLai').focus();
        return;
    }
    if (!isConnected || !db) { alert('⚠️ Không thể kết nối Firebase. Vui lòng kiểm tra mạng hoặc đăng nhập lại!'); return; }

    let tomTat = qcTomTatDoiSach(ds).substring(0, 2900);
    let updates = {}; updates[it.key] = tomTat; updates[`${it.key}_4m`] = ds;
    db.ref(`qc_tab3_actions_v1/${it.date}`).update(cleanPayloadForFirebase(updates)).then(() => {
        if (!tab3ActionNotesStore[it.date]) tab3ActionNotesStore[it.date] = {};
        tab3ActionNotesStore[it.date][it.key] = tomTat;
        tab3ActionNotesStore[it.date][`${it.key}_4m`] = ds;
        if (qcDoiSachModalInstance) qcDoiSachModalInstance.hide();
        renderTab3();
    }).catch(err => alert('⚠️ Lỗi lưu đối sách: ' + err.message));
}

// ===================== 6. XUẤT EXCEL =====================
function qcXuatExcelDoiSach() {
    let fromDate = document.getElementById('tab3FromDate').value || getTodayISO(), toDate = document.getElementById('tab3ToDate').value || getTodayISO();
    if (!tab3LastDisplayList.length) { alert('Không có dữ liệu lỗi để xuất!'); return; }
    let pool = qcPoolHienTai();
    let rows = tab3LastDisplayList.map((it, i) => {
        let pt = qcPhanTichLapLai(it, pool);
        let ds = it.doiSach || {};
        return {
            'STT': i + 1, 'Ngày Phát Sinh': it.date, 'Nguồn Lỗi': it.source === 'TAB1' ? 'Tab 1' : 'Tab 2',
            'Máy': it.machine, 'Ca / Giờ': it.shiftTime, 'QC Ghi Nhận': it.inspector || '', 'Mã Khuôn': it.moldId || '',
            'Hạng Mục / Loại Lỗi': it.category, 'SL Mẫu Lỗi': it.defectQty || '', 'Mô Tả Lỗi': it.description,
            'Loại Lỗi Chuẩn': qcTenLoaiLoi(it.loaiLoi),
            'Lần Đầu / Lặp Lại': pt.lapLai ? `Lặp lại – lần ${pt.lanThu}` : 'Lần đầu',
            'Đã Từng Xảy Ra Ở': Object.keys(pt.theoMay).sort().map(m => `${m} x${pt.theoMay[m].length} (${pt.theoMay[m].join(', ')})`).join('; '),
            'Nguyên Nhân Gốc': ds.nguyenNhan || '',
            '4M - Con Người': ds.man || '', '4M - Thiết Bị': ds.machine || '', '4M - Vật Tư': ds.material || '', '4M - Thao Tác': ds.method || '',
            'Đánh Giá Lặp Lại': ds.danhGiaLapLai || '',
            'Người Phụ Trách': ds.phuTrach || '', 'Hạn': ds.hanXuLy || '',
            'Trạng Thái': it.doiSach ? (ds.trangThai || '') : (it.savedAction ? 'Ghi chú cũ: ' + it.savedAction : 'Chưa lập đối sách')
        };
    });
    let ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: /4M|Đánh Giá|Nguyên Nhân|Mô Tả|Đã Từng/.test(k) ? 40 : 14 }));
    XLSX.utils.book_append_sheet(wb, ws, 'DoiSach4M');
    XLSX.writeFile(wb, `MES_QC_Tab3_DoiSach4M_${fromDate}_den_${toDate}.xlsx`);
}
