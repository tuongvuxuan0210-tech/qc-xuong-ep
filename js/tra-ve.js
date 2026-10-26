/**
 * QC System - Tab 5: LỖI TRẢ VỀ (Công đoạn sau trả về & Khách hàng trả về)
 * Xưởng Ép Nhựa Hải Tân
 *
 * Dữ liệu Firebase: qc_return_store_v1/{ngày nhận YYYY-MM-DD}/{id} = { ...thông tin lỗi trả về }
 * Nguyên nhân & đối sách 4M dùng chung phiếu đối sách của Tab 3 (qc_tab3_actions_v1/{ngày}/RV_{id}_4m),
 * nên lỗi trả về cũng được nhận diện LẦN ĐẦU / LẶP LẠI cùng với lỗi Tab 1, Tab 2.
 */

const RV_PATH = 'qc_return_store_v1';
let traVeStore = {};                // ngày -> { id: bản ghi }
let rvListenerRef = null;
let rvListenerRange = '';
let rvModalInstance = null;
let rvEditing = null;               // { date, id } khi sửa
let rvLastList = [];

const RV_NGUON = {
    CDS: { ten: 'Công đoạn sau', icon: '↩️', cls: 'bg-warning text-dark' },
    KH: { ten: 'Khách hàng', icon: '🚚', cls: 'bg-danger' }
};
const RV_BEN_TRA_CDS = ['Xưởng in', 'Phun sơn', 'Lắp ráp', 'Đóng gói', 'Kho', 'QC cuối (OQC)'];
const RV_XU_LY = ['Tuyển lại (chọn hàng đạt)', 'Sửa lại (gọt bavia / cắt gate…)', 'Hủy', 'Ép bù', 'Đổi hàng cho khách', 'Khác'];
const RV_TT_HANG = ['Chờ xử lý', 'Đang xử lý', 'Đã xử lý xong'];

// ===================== TIỆN ÍCH =====================
function rvDateAdd(iso, n) {
    let [y, m, d] = iso.split('-').map(Number);
    let t = new Date(y, m - 1, d + n);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function rvNum(v) { let n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; }
function rvMachineNum(m) { return parseInt(String(m || '').replace(/\D/g, '')) || 0; }
function rvWsLabel(m) { let n = rvMachineNum(m); return !n ? '' : (n <= 10 ? 'Xưởng 2' : 'Xưởng 1'); }
function rvKey(id) { return `RV_${id}`; }
function rvNguonInfo(n) { return RV_NGUON[n] || RV_NGUON.CDS; }

// Danh sách lỗi trả về của 1 ngày, theo định dạng chung của Tab 3 / bộ nhớ lỗi
function rvThuThapTheoNgay(date) {
    let day = traVeStore[date] || {};
    let actions = tab3ActionNotesStore[date] || {};
    let list = [];
    Object.keys(day).forEach(id => {
        let r = day[id];
        if (!r || typeof r !== 'object') return;
        let key = rvKey(id), mNum = rvMachineNum(r.may), nv = rvNguonInfo(r.nguon);
        let ben = r.benTra ? ` (${r.benTra})` : '';
        let moTa = [r.moTa, r.tenSP ? `SP: ${r.tenSP}` : '', r.maHang ? `Mã hàng: ${r.maHang}` : ''].filter(Boolean).join(' · ');
        list.push({
            date, source: 'TRAVE', nguon: r.nguon || 'CDS', key, rvId: id,
            machine: r.may || '—', ws: mNum ? (mNum <= 10 ? 'XUONG1' : 'XUONG2') : 'ALL',
            isDay: !String(r.ca || '').includes('Đêm'),
            shiftTime: `${r.ca || '—'}${r.ngaySX ? ' · SX ' + qcNgayNgan(r.ngaySX) : ''}`,
            inspector: r.nguoiNhap || '', moldId: r.moldId || r.maHang || '',
            category: `${nv.icon} ${nv.ten} trả về${ben}`, defectQty: rvNum(r.slTra),
            description: moTa || qcTenLoaiLoi(r.loaiLoi) || 'Lỗi trả về',
            savedAction: typeof actions[key] === 'string' ? actions[key] : '',
            doiSach: actions[`${key}_4m`] || null,
            order: qcThuTuThoiGian(date, r.ca, '12:00'),
            rec: r
        });
    });
    list.forEach(it => {
        it.loaiLoiTuDong = it.rec.loaiLoi || qcNhanDienLoaiLoi(it.rec.moTa, '', 'TRAVE');
        it.loaiLoi = (it.doiSach && it.doiSach.loaiLoi) ? it.doiSach.loaiLoi : it.loaiLoiTuDong;
    });
    return list;
}

// ===================== TẢI DỮ LIỆU =====================
function rvRange() {
    let f = document.getElementById('rvFromDate'), t = document.getElementById('rvToDate');
    let today = getTodayISO();
    if (f && !f.value) f.value = rvDateAdd(today, -29);
    if (t && !t.value) t.value = today;
    let from = f ? f.value : today, to = t ? t.value : today;
    if (from > to) [from, to] = [to, from];
    return { from, to };
}

// Tải lỗi trả về của các ngày (dùng cho Tab 3 và quét bộ nhớ)
function rvLoadDates(dates) {
    if (!isConnected || !db) return Promise.resolve();
    return Promise.all(dates.filter(d => !traVeStore[d]).map(d =>
        db.ref(`${RV_PATH}/${d}`).once('value').then(s => { traVeStore[d] = s.val() || {}; }).catch(() => { traVeStore[d] = {}; })
    ));
}

async function loadAndRenderTraVe() {
    if (!isEditMode) return;
    let { from, to } = rvRange();
    let dates = getDatesInRange(from, to);
    let tbody = document.getElementById('rvTbody');
    if (tbody && !tbody.children.length) tbody.innerHTML = `<tr><td colspan="14" class="text-center text-info py-4 fw-bold">⌛ Đang tải dữ liệu lỗi trả về...</td></tr>`;
    if (isConnected && db) {
        let rangeKey = `${from}|${to}`;
        if (rvListenerRange !== rangeKey) {
            if (rvListenerRef) rvListenerRef.off();
            rvListenerRange = rangeKey;
            rvListenerRef = db.ref(RV_PATH).orderByKey().startAt(from).endAt(to);
            rvListenerRef.on('value', snap => {
                let val = snap.val() || {};
                dates.forEach(d => { traVeStore[d] = val[d] || {}; });
                renderTraVe();
                if (typeof debouncedRenderTab3 === 'function') debouncedRenderTab3();
            }, err => { console.warn('Không đọc được lỗi trả về:', err); rvToast('⚠️ Không đọc được dữ liệu lỗi trả về (kiểm tra Firebase Rules nhánh ' + RV_PATH + ')', true); });
        }
        await Promise.all([
            ...dates.filter(d => !tab3ActionNotesStore[d]).map(d => db.ref(`qc_tab3_actions_v1/${d}`).once('value').then(s => tab3ActionNotesStore[d] = s.val() || {})),
            qcEnsureDefectMemory()
        ]);
    }
    renderTraVe();
}

function rvStop() {
    if (rvListenerRef) { try { rvListenerRef.off(); } catch (e) { } }
    rvListenerRef = null; rvListenerRange = ''; traVeStore = {}; rvLastList = [];
    let tb = document.getElementById('rvTbody'); if (tb) tb.innerHTML = '';
}

// ===================== HIỂN THỊ =====================
function renderTraVe() {
    if (!isEditMode) return;
    let tbody = document.getElementById('rvTbody');
    if (!tbody) return;
    let { from, to } = rvRange();
    let dates = getDatesInRange(from, to);
    let fNguon = document.getElementById('rvFilterNguon')?.value || 'ALL';
    let fTT = document.getElementById('rvFilterTT')?.value || 'ALL';
    let q = (document.getElementById('rvSearch')?.value || '').trim().toLowerCase();

    let all = [];
    dates.forEach(d => all.push(...rvThuThapTheoNgay(d)));
    let pool = (typeof qcPoolHienTai === 'function') ? qcPoolHienTai() : {};
    all.forEach(it => { pool[qcMemoryId(it.date, it.key)] = qcTaoBanGhiBoNho(it); });

    let list = all.filter(it => {
        if (fNguon !== 'ALL' && it.nguon !== fNguon) return false;
        let ds = it.doiSach;
        if (fTT === 'CHUA' && ds && qcDu4M(ds)) return false;
        if (fTT === 'DANG' && !(ds && qcDu4M(ds) && ds.trangThai !== 'Đã xác nhận hiệu quả')) return false;
        if (fTT === 'XONG' && !(ds && ds.trangThai === 'Đã xác nhận hiệu quả')) return false;
        if (q) {
            let r = it.rec, hay = [r.maHang, r.tenSP, r.moldId, r.may, r.order, r.benTra, r.moTa, r.nguoiBao].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    }).sort((a, b) => (b.date + (b.rec.t || 0)).localeCompare(a.date + (a.rec.t || 0)));
    rvLastList = list;

    // KPI
    let sumTra = list.reduce((s, it) => s + it.defectQty, 0);
    let nCDS = list.filter(it => it.nguon === 'CDS'), nKH = list.filter(it => it.nguon === 'KH');
    let chuaDS = list.filter(it => !(it.doiSach && qcDu4M(it.doiSach))).length;
    let lapLai = list.filter(it => qcPhanTichLapLai(it, pool).lapLai).length;
    let set = (id, v) => { let el = document.getElementById(id); if (el) el.textContent = v; };
    set('rvKpiTotal', list.length);
    set('rvKpiQty', sumTra.toLocaleString('vi-VN'));
    set('rvKpiSplit', `${nCDS.length} / ${nKH.length}`);
    set('rvKpiSplitQty', `${nCDS.reduce((s, it) => s + it.defectQty, 0).toLocaleString('vi-VN')} / ${nKH.reduce((s, it) => s + it.defectQty, 0).toLocaleString('vi-VN')} sp`);
    set('rvKpiNo4M', chuaDS);
    set('rvKpiRepeat', lapLai);

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="14" class="text-center py-4 text-success fw-bold">🎉 Không có lỗi trả về nào từ ${qcNgayNgan(from)} đến ${qcNgayNgan(to)}${fNguon !== 'ALL' || fTT !== 'ALL' || q ? ' (theo bộ lọc đang chọn)' : ''}.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map((it, idx) => {
        let r = it.rec, nv = rvNguonInfo(it.nguon);
        let pt = qcPhanTichLapLai(it, pool);
        let tyLe = rvNum(r.slLo) > 0 ? ` <span class="small opacity-75">(${(rvNum(r.slTra) / rvNum(r.slLo) * 100).toFixed(1)}%)</span>` : '';
        let ttHang = r.ttHang || 'Chờ xử lý';
        let ttCls = ttHang === 'Đã xử lý xong' ? 'bg-success' : ttHang === 'Đang xử lý' ? 'bg-primary' : 'bg-secondary';
        let actions = tab3ActionNotesStore[it.date] || {};
        let hasImg = actions[`${it.key}_img`] || actions[`${it.key}_drive_file`] || actions[`${it.key}_drive_url`];
        let viewImg = actions[`${it.key}_img`] || actions[`${it.key}_drive_url`] || actions[`${it.key}_drive_file`] || '';
        let imgTitle = `Trả về: ${r.maHang || ''} ${r.tenSP || ''} - ${it.machine}`;
        let imgHtml = hasImg
            ? `<button type="button" class="btn btn-xs btn-3d-primary rounded-pill py-0 px-2" style="font-size:10.5px;" onclick="previewDefectImage('${escapeHtml(viewImg)}', '${escapeHtml(imgTitle)}')">🖼️ Xem ảnh</button>`
            : `<label class="btn btn-xs btn-outline-info rounded-pill py-0 px-2 m-0" style="font-size:10.5px; cursor:pointer;">📸 Ảnh<input type="file" accept="image/*" style="display:none;" onchange="rvUploadImage(this, ${idx})"></label>`;
        return `<tr class="${pt.lapLai ? 'qc-row-lap-lai' : ''}">
            <td class="fw-bold sticky-col">${idx + 1}</td>
            <td class="fw-bold text-info small">${escapeHtml(qcNgayNgan(it.date))}<div class="small opacity-75">${escapeHtml(r.nguoiBao || '')}</div></td>
            <td><span class="badge ${nv.cls} fw-bold">${nv.icon} ${nv.ten}</span><div class="small fw-semibold mt-1">${escapeHtml(r.benTra || '')}</div></td>
            <td class="text-start small"><div class="fw-bold">${escapeHtml(r.maHang || '—')}</div><div>${escapeHtml(r.tenSP || '')}</div>${r.order ? `<div class="opacity-75">📄 ${escapeHtml(r.order)}</div>` : ''}</td>
            <td class="fw-bold text-warning small">${escapeHtml(r.moldId || '—')}</td>
            <td class="small"><b class="text-info">${escapeHtml(r.may || '—')}</b>${rvWsLabel(r.may) ? `<div class="opacity-75">${rvWsLabel(r.may)}</div>` : ''}<div>${escapeHtml(r.ca || '')}</div>${r.ngaySX ? `<div class="opacity-75">SX ${escapeHtml(qcNgayNgan(r.ngaySX))}</div>` : ''}</td>
            <td class="fw-bold">${r.slLo ? rvNum(r.slLo).toLocaleString('vi-VN') : '—'}</td>
            <td class="fw-bold text-danger fs-6">${rvNum(r.slTra).toLocaleString('vi-VN')}${tyLe}</td>
            <td class="text-start small"><div class="fw-bold text-danger">${escapeHtml(qcTenLoaiLoi(it.loaiLoi))}</div><div>${escapeHtml(r.moTa || '')}</div><div class="mt-1">${imgHtml}</div></td>
            <td class="text-start small"><div>${escapeHtml(r.xuLy || '—')}</div>${r.slDat || r.slHuy ? `<div class="opacity-75">Đạt ${rvNum(r.slDat)} · Hủy ${rvNum(r.slHuy)}</div>` : ''}<span class="badge ${ttCls} mt-1">${escapeHtml(ttHang)}</span></td>
            <td class="qc-lap-cell">${qcHtmlLapLai(it, pt)}</td>
            <td class="qc-4m-cell">${rvHtmlDoiSach(it, pt, idx)}</td>
            <td><div class="d-flex flex-column gap-1">
                <button type="button" class="btn btn-xs btn-outline-info py-0 px-2" style="font-size:11px;" onclick="rvMoForm(${idx})">✏️ Sửa</button>
                <button type="button" class="btn btn-xs btn-outline-danger py-0 px-2" style="font-size:11px;" onclick="rvXoa(${idx})">🗑️ Xóa</button>
            </div></td>
        </tr>`;
    }).join('');
}

// Ô đối sách: dùng lại hiển thị của Tab 3 nhưng nút mở phiếu theo danh sách Tab 5
function rvHtmlDoiSach(it, pt, idx) {
    return qcHtmlDoiSach(it, pt, idx).replace(/qcMoPhieuDoiSach\(\d+\)/g, `rvMoDoiSach(${idx})`);
}

function rvMoDoiSach(idx) {
    let it = rvLastList[idx];
    if (!it) return;
    qcMoPhieuDoiSachItem(it);
}

async function rvUploadImage(inputEl, idx) {
    let it = rvLastList[idx];
    if (!it) return;
    await handleDefectImageUpload(inputEl, it.date, it.key, it.machine, it.moldId);
    renderTraVe();
}

// ===================== FORM NHẬP / SỬA =====================
function rvTaoModal() {
    if (document.getElementById('rvModal')) return;
    let loaiOpts = QC_LOAI_LOI_CHUAN.filter(l => !['KHUON_MAY', 'KQ_SP_NG'].includes(l.ma)).map(l => `<option value="${l.ma}">${escapeHtml(l.ten)}</option>`).join('');
    let mayOpts = Array.from({ length: TOTAL_MACHINES }, (_, i) => i + 1).map(n => `<option value="M${n}">M${n} – ${n <= 10 ? 'Xưởng 2' : 'Xưởng 1'}</option>`).join('');
    let div = document.createElement('div');
    div.innerHTML = `
    <div class="modal fade" id="rvModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div class="modal-content rounded-4">
          <div class="modal-header py-2" style="background: linear-gradient(90deg, #b45309, #be123c);">
            <h6 class="modal-title fw-bold m-0 text-white" id="rvModalTitle">📦 NHẬP LỖI TRẢ VỀ</h6>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-3 rv-form">
            <div class="rv-sec">1. NGUỒN TRẢ VỀ</div>
            <div class="row g-2 mb-2">
              <div class="col-md-5">
                <div class="btn-group w-100" role="group">
                  <input type="radio" class="btn-check" name="rvNguon" id="rvNguonCDS" value="CDS" checked onchange="rvDoiNguon()">
                  <label class="btn btn-outline-warning fw-bold" for="rvNguonCDS">↩️ Công đoạn sau</label>
                  <input type="radio" class="btn-check" name="rvNguon" id="rvNguonKH" value="KH" onchange="rvDoiNguon()">
                  <label class="btn btn-outline-danger fw-bold" for="rvNguonKH">🚚 Khách hàng</label>
                </div>
              </div>
              <div class="col-md-4"><label class="small fw-bold" id="rvBenTraLbl" for="rvBenTra">Bộ phận trả về</label>
                <input class="form-control form-control-sm" id="rvBenTra" list="rvBenTraList" maxlength="80"><datalist id="rvBenTraList"></datalist></div>
              <div class="col-md-3"><label class="small fw-bold" for="rvNgayNhan">Ngày nhận hàng trả <span class="text-danger">*</span></label>
                <input type="date" class="form-control form-control-sm" id="rvNgayNhan"></div>
              <div class="col-md-5"><label class="small fw-bold" for="rvNguoiBao">Người báo / liên hệ</label>
                <input class="form-control form-control-sm" id="rvNguoiBao" maxlength="80" placeholder="VD: Hải Tân-Dung"></div>
            </div>
            <div class="rv-sec">2. SẢN PHẨM & TRUY XUẤT (theo tem lô hàng)</div>
            <div class="row g-2 mb-2">
              <div class="col-md-4"><label class="small fw-bold" for="rvMaHang">Mã hàng <span class="text-danger">*</span></label>
                <input class="form-control form-control-sm" id="rvMaHang" maxlength="60" placeholder="VD: JZ004526-11038"></div>
              <div class="col-md-4"><label class="small fw-bold" for="rvTenSP">Tên sản phẩm / vế</label>
                <input class="form-control form-control-sm" id="rvTenSP" maxlength="80" placeholder="VD: Chân trái"></div>
              <div class="col-md-4"><label class="small fw-bold" for="rvOrder">Order / Lot No.</label>
                <input class="form-control form-control-sm" id="rvOrder" maxlength="60" placeholder="VD: DH-M14-3750"></div>
              <div class="col-md-3"><label class="small fw-bold" for="rvMay">Máy ép</label>
                <select class="form-select form-select-sm" id="rvMay" onchange="rvGoiYKhuon()"><option value="">— chọn —</option>${mayOpts}</select></div>
              <div class="col-md-3"><label class="small fw-bold" for="rvCa">Ca sản xuất</label>
                <select class="form-select form-select-sm" id="rvCa" onchange="rvGoiYKhuon()"><option value="">—</option><option>Ca Ngày</option><option>Ca Đêm</option></select></div>
              <div class="col-md-3"><label class="small fw-bold" for="rvNgaySX">Ngày sản xuất</label>
                <input type="date" class="form-control form-control-sm" id="rvNgaySX" onchange="rvGoiYKhuon()"></div>
              <div class="col-md-3"><label class="small fw-bold" for="rvMoldId">Mã khuôn</label>
                <input class="form-control form-control-sm" id="rvMoldId" list="moldOptionsList" maxlength="60" oninput="this.dataset.tay='1'">
                <div class="small text-muted" id="rvMoldHint"></div></div>
            </div>
            <div class="rv-sec">3. LỖI</div>
            <div class="row g-2 mb-2">
              <div class="col-md-3"><label class="small fw-bold" for="rvSlLo">SL lô hàng</label>
                <input type="number" min="0" class="form-control form-control-sm" id="rvSlLo" oninput="rvTyLe()" placeholder="VD: 950"></div>
              <div class="col-md-3"><label class="small fw-bold" for="rvSlTra">SL trả về (lỗi) <span class="text-danger">*</span></label>
                <input type="number" min="0" class="form-control form-control-sm" id="rvSlTra" oninput="rvTyLe()" placeholder="VD: 410"></div>
              <div class="col-md-6"><label class="small fw-bold" for="rvLoaiLoi">Loại lỗi <span class="text-danger">*</span></label>
                <select class="form-select form-select-sm fw-bold" id="rvLoaiLoi"><option value="">— chọn loại lỗi —</option>${loaiOpts}</select></div>
              <div class="col-12"><label class="small fw-bold" for="rvMoTa">Mô tả lỗi</label>
                <textarea class="form-control form-control-sm" id="rvMoTa" rows="2" maxlength="500" placeholder="VD: Bavia cao ở mép chân, sờ thấy sắc tay"></textarea>
                <div class="small fw-bold mt-1" id="rvTyLeTxt"></div></div>
            </div>
            <div class="rv-sec">4. XỬ LÝ HÀNG TRẢ VỀ (tạm thời)</div>
            <div class="row g-2 mb-2">
              <div class="col-md-5"><label class="small fw-bold" for="rvXuLy">Phương án xử lý</label>
                <select class="form-select form-select-sm" id="rvXuLy"><option value="">— chọn —</option>${RV_XU_LY.map(x => `<option>${x}</option>`).join('')}</select></div>
              <div class="col-md-2"><label class="small fw-bold" for="rvSlDat">SL đạt sau XL</label>
                <input type="number" min="0" class="form-control form-control-sm" id="rvSlDat"></div>
              <div class="col-md-2"><label class="small fw-bold" for="rvSlHuy">SL hủy</label>
                <input type="number" min="0" class="form-control form-control-sm" id="rvSlHuy"></div>
              <div class="col-md-3"><label class="small fw-bold" for="rvTtHang">Trạng thái hàng</label>
                <select class="form-select form-select-sm" id="rvTtHang">${RV_TT_HANG.map(x => `<option>${x}</option>`).join('')}</select></div>
              <div class="col-12"><input class="form-control form-control-sm" id="rvXuLyNote" maxlength="300" placeholder="Ghi chú xử lý (ai làm, khi nào giao lại…)"></div>
            </div>
            <div class="rv-note">🛠️ <b>Nguyên nhân & đối sách 4M</b> lập sau khi lưu: bấm <b>“💾 Lưu & lập đối sách 4M”</b>, hoặc bấm nút đối sách trong danh sách. Phần mềm tự báo nếu lỗi này đã từng xảy ra trên cùng khuôn.</div>
          </div>
          <div class="modal-footer py-2">
            <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>
            <button type="button" class="btn btn-sm btn-3d-primary px-3" onclick="rvLuu(false)">💾 Lưu</button>
            <button type="button" class="btn btn-sm btn-3d-emerald px-3" onclick="rvLuu(true)">💾 Lưu & lập đối sách 4M</button>
          </div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);
}

function rvNguonDangChon() { return document.getElementById('rvNguonKH')?.checked ? 'KH' : 'CDS'; }

function rvDoiNguon() {
    let kh = rvNguonDangChon() === 'KH';
    document.getElementById('rvBenTraLbl').textContent = kh ? 'Tên khách hàng' : 'Bộ phận trả về';
    document.getElementById('rvBenTra').placeholder = kh ? 'VD: tên khách hàng' : 'VD: Xưởng in';
    let opts = kh ? Array.from(new Set(Object.values(traVeStore).flatMap(d => Object.values(d || {})).filter(r => r && r.nguon === 'KH' && r.benTra).map(r => r.benTra))) : RV_BEN_TRA_CDS;
    document.getElementById('rvBenTraList').innerHTML = opts.map(o => `<option value="${escapeHtml(o)}">`).join('');
}

function rvGoiYKhuon() {
    let may = document.getElementById('rvMay').value, ca = document.getElementById('rvCa').value, ngay = document.getElementById('rvNgaySX').value;
    let el = document.getElementById('rvMoldId'), hint = document.getElementById('rvMoldHint');
    hint.textContent = '';
    if (!may || !ca || !ngay || typeof qcResolveMold !== 'function') return;
    let src = qcResolveMold(ngay, rvMachineNum(may), ca, '');
    if (src && src.mold) {
        if (!el.value || !el.dataset.tay) { el.value = src.mold; el.dataset.tay = ''; }
        hint.textContent = `Theo PM ép nhựa: ${src.mold}${src.inherited ? ' (kế thừa ' + qcNgayNgan(src.fromDate) + ')' : ''}`;
    } else hint.textContent = 'Chưa có dữ liệu khuôn từ PM ép nhựa – nhập tay.';
}

function rvTyLe() {
    let lo = rvNum(document.getElementById('rvSlLo').value), tra = rvNum(document.getElementById('rvSlTra').value);
    let el = document.getElementById('rvTyLeTxt');
    if (lo > 0 && tra > 0) {
        let p = tra / lo * 100;
        el.innerHTML = `Tỷ lệ trả về: <span class="${p >= 20 ? 'text-danger' : 'text-warning'}">${p.toFixed(1)}%</span>${tra > lo ? ' <span class="text-danger">– SL trả lớn hơn SL lô?</span>' : ''}`;
    } else el.textContent = '';
}

function rvMoForm(idx) {
    if (!checkAuthOrAlert()) return;
    rvTaoModal();
    let it = (idx !== undefined && idx !== null) ? rvLastList[idx] : null;
    let r = it ? it.rec : {};
    rvEditing = it ? { date: it.date, id: it.rvId } : null;
    document.getElementById('rvModalTitle').textContent = it ? '✏️ SỬA LỖI TRẢ VỀ' : '📦 NHẬP LỖI TRẢ VỀ';
    document.getElementById(r.nguon === 'KH' ? 'rvNguonKH' : 'rvNguonCDS').checked = true;
    let setv = (id, v) => { let el = document.getElementById(id); if (el) el.value = v ?? ''; };
    setv('rvNgayNhan', it ? it.date : getTodayISO());
    setv('rvBenTra', r.benTra); setv('rvNguoiBao', r.nguoiBao);
    setv('rvMaHang', r.maHang); setv('rvTenSP', r.tenSP); setv('rvOrder', r.order);
    setv('rvMay', r.may); setv('rvCa', r.ca); setv('rvNgaySX', r.ngaySX); setv('rvMoldId', r.moldId);
    document.getElementById('rvMoldId').dataset.tay = r.moldId ? '1' : '';
    document.getElementById('rvMoldHint').textContent = '';
    setv('rvSlLo', r.slLo); setv('rvSlTra', r.slTra); setv('rvLoaiLoi', r.loaiLoi); setv('rvMoTa', r.moTa);
    setv('rvXuLy', r.xuLy); setv('rvSlDat', r.slDat); setv('rvSlHuy', r.slHuy); setv('rvTtHang', r.ttHang || 'Chờ xử lý'); setv('rvXuLyNote', r.xuLyNote);
    rvDoiNguon(); rvTyLe();
    if (!rvModalInstance) rvModalInstance = new bootstrap.Modal(document.getElementById('rvModal'));
    rvModalInstance.show();
}

async function rvLuu(moDoiSach) {
    if (!checkAuthOrAlert()) return;
    let g = id => (document.getElementById(id)?.value || '').trim();
    let ngay = g('rvNgayNhan');
    let rec = {
        nguon: rvNguonDangChon(), benTra: g('rvBenTra'), nguoiBao: g('rvNguoiBao'),
        maHang: g('rvMaHang'), tenSP: g('rvTenSP'), order: g('rvOrder'),
        may: g('rvMay'), ca: g('rvCa'), ngaySX: g('rvNgaySX'), moldId: g('rvMoldId'),
        slLo: g('rvSlLo') ? rvNum(g('rvSlLo')) : '', slTra: rvNum(g('rvSlTra')),
        loaiLoi: g('rvLoaiLoi'), moTa: g('rvMoTa'),
        xuLy: g('rvXuLy'), slDat: g('rvSlDat') ? rvNum(g('rvSlDat')) : '', slHuy: g('rvSlHuy') ? rvNum(g('rvSlHuy')) : '',
        ttHang: g('rvTtHang'), xuLyNote: g('rvXuLyNote'),
        capNhatLuc: new Date().toLocaleString('vi-VN'), capNhatBoi: (currentUser && currentUser.email) || ''
    };
    let thieu = [];
    if (!ngay) thieu.push('Ngày nhận');
    if (!rec.maHang) thieu.push('Mã hàng');
    if (!(rec.slTra > 0)) thieu.push('SL trả về');
    if (!rec.loaiLoi) thieu.push('Loại lỗi');
    if (thieu.length) { alert('⚠️ Còn thiếu: ' + thieu.join(', ')); return; }
    if (!isConnected || !db) { alert('⚠️ Chưa kết nối Firebase!'); return; }

    let isNew = !rvEditing;
    let id = rvEditing ? rvEditing.id : (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    let cu = rvEditing ? ((traVeStore[rvEditing.date] || {})[rvEditing.id] || {}) : {};
    rec.t = cu.t || Date.now();
    rec.nguoiNhap = cu.nguoiNhap || ((currentUser && currentUser.email) || '').split('@')[0];
    Object.keys(rec).forEach(k => { if (rec[k] === '') delete rec[k]; });

    try {
        let updates = {};
        if (rvEditing && rvEditing.date !== ngay) {
            // Đổi ngày nhận: chuyển bản ghi + đối sách sang ngày mới
            updates[`${RV_PATH}/${rvEditing.date}/${id}`] = null;
            let act = tab3ActionNotesStore[rvEditing.date] || {};
            let key = rvKey(id);
            Object.keys(act).filter(k => k === key || k.startsWith(key + '_')).forEach(k => {
                updates[`qc_tab3_actions_v1/${ngay}/${k}`] = act[k];
                updates[`qc_tab3_actions_v1/${rvEditing.date}/${k}`] = null;
            });
        }
        updates[`${RV_PATH}/${ngay}/${id}`] = rec;
        await db.ref().update(updates);
        if (rvEditing && rvEditing.date !== ngay && traVeStore[rvEditing.date]) delete traVeStore[rvEditing.date][id];
        if (!traVeStore[ngay]) traVeStore[ngay] = {};
        traVeStore[ngay][id] = rec;
        if (!tab3ActionNotesStore[ngay] && db) tab3ActionNotesStore[ngay] = (await db.ref(`qc_tab3_actions_v1/${ngay}`).once('value')).val() || {};
    } catch (err) {
        alert('⚠️ Lỗi lưu: ' + err.message + '\n(Nếu báo PERMISSION_DENIED: cần mở quyền ghi nhánh "' + RV_PATH + '" trong Firebase Rules)');
        return;
    }
    if (rvModalInstance) rvModalInstance.hide();
    rvToast(isNew ? '✅ Đã lưu lỗi trả về.' : '✅ Đã cập nhật.');
    if (isNew && rec.nguon === 'KH' && typeof sendZaloAlert === 'function') {
        sendZaloAlert(`🚚 KHÁCH HÀNG TRẢ VỀ\n📅 Nhận: ${ngay}${rec.benTra ? ' · KH: ' + rec.benTra : ''}\n📦 ${rec.maHang}${rec.tenSP ? ' – ' + rec.tenSP : ''}${rec.order ? ' · ' + rec.order : ''}\n🏭 ${rec.may || '-'} ${rec.ca || ''}${rec.ngaySX ? ' · SX ' + rec.ngaySX : ''}\n❌ ${qcTenLoaiLoi(rec.loaiLoi)}: ${rec.slTra}${rec.slLo ? '/' + rec.slLo : ''} sp${rec.moTa ? '\n📝 ' + rec.moTa : ''}\n👤 ${rec.nguoiNhap}`, ngay);
    }
    // Ngày nhận ngoài khoảng đang xem -> nới khoảng để thấy bản ghi vừa lưu
    let { from, to } = rvRange();
    if (ngay < from) document.getElementById('rvFromDate').value = ngay;
    if (ngay > to) document.getElementById('rvToDate').value = ngay;
    await loadAndRenderTraVe();
    if (moDoiSach) {
        let it = rvThuThapTheoNgay(ngay).find(x => x.rvId === id);
        if (it) setTimeout(() => qcMoPhieuDoiSachItem(it), 350);
    }
}

async function rvXoa(idx) {
    if (!checkAuthOrAlert()) return;
    let it = rvLastList[idx];
    if (!it) return;
    if (!confirm(`Xóa lỗi trả về ${it.rec.maHang || ''} (${it.defectQty} sp, ngày ${it.date})?\nĐối sách 4M kèm theo cũng bị xóa.`)) return;
    let updates = {};
    updates[`${RV_PATH}/${it.date}/${it.rvId}`] = null;
    let act = tab3ActionNotesStore[it.date] || {};
    Object.keys(act).filter(k => k === it.key || k.startsWith(it.key + '_')).forEach(k => { updates[`qc_tab3_actions_v1/${it.date}/${k}`] = null; delete act[k]; });
    updates[`${QC_MEMORY_PATH}/${qcMemoryId(it.date, it.key)}`] = null;
    try {
        await db.ref().update(updates);
        if (traVeStore[it.date]) delete traVeStore[it.date][it.rvId];
        if (qcDefectMemory) delete qcDefectMemory[qcMemoryId(it.date, it.key)];
        renderTraVe();
        rvToast('🗑️ Đã xóa.');
    } catch (err) { alert('⚠️ Lỗi xóa: ' + err.message); }
}

// ===================== XUẤT EXCEL =====================
function rvXuatExcel() {
    if (!rvLastList.length) { alert('Không có dữ liệu lỗi trả về để xuất!'); return; }
    let { from, to } = rvRange();
    let pool = qcPoolHienTai();
    rvLastList.forEach(it => { pool[qcMemoryId(it.date, it.key)] = qcTaoBanGhiBoNho(it); });
    let rows = rvLastList.map((it, i) => {
        let r = it.rec, ds = it.doiSach || {}, pt = qcPhanTichLapLai(it, pool);
        return {
            'STT': i + 1, 'Ngày Nhận': it.date, 'Nguồn': rvNguonInfo(it.nguon).ten, 'Bên Trả / Khách Hàng': r.benTra || '', 'Người Báo': r.nguoiBao || '',
            'Mã Hàng': r.maHang || '', 'Tên SP': r.tenSP || '', 'Order / Lot': r.order || '', 'Mã Khuôn': r.moldId || '',
            'Máy': r.may || '', 'Xưởng': rvWsLabel(r.may), 'Ca SX': r.ca || '', 'Ngày SX': r.ngaySX || '',
            'SL Lô': r.slLo || '', 'SL Trả Về': r.slTra || 0, 'Tỷ Lệ %': rvNum(r.slLo) > 0 ? +(rvNum(r.slTra) / rvNum(r.slLo) * 100).toFixed(1) : '',
            'Loại Lỗi': qcTenLoaiLoi(it.loaiLoi), 'Mô Tả': r.moTa || '',
            'Xử Lý Hàng': r.xuLy || '', 'SL Đạt Sau XL': r.slDat || '', 'SL Hủy': r.slHuy || '', 'Trạng Thái Hàng': r.ttHang || '', 'Ghi Chú XL': r.xuLyNote || '',
            'Lần Đầu / Lặp Lại': pt.lapLai ? `Lặp lại – lần ${pt.lanThu}` : 'Lần đầu',
            'Nguyên Nhân Gốc': ds.nguyenNhan || '',
            '4M - Con Người': ds.man || '', '4M - Thiết Bị': ds.machine || '', '4M - Vật Tư': ds.material || '', '4M - Thao Tác': ds.method || '',
            'Đánh Giá Lặp Lại': ds.danhGiaLapLai || '', 'Người Phụ Trách': ds.phuTrach || '', 'Hạn': ds.hanXuLy || '',
            'Trạng Thái Đối Sách': it.doiSach ? (ds.trangThai || '') : 'Chưa lập đối sách'
        };
    });
    let ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: /4M|Nguyên Nhân|Mô Tả|Đánh Giá|Ghi Chú/.test(k) ? 36 : 14 }));
    XLSX.utils.book_append_sheet(wb, ws, 'LoiTraVe');
    XLSX.writeFile(wb, `QC_LoiTraVe_${from}_den_${to}.xlsx`);
}

function rvToast(msg, bad) {
    let el = document.getElementById('rvToast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'in-toast show' + (bad ? ' bad' : '');
    clearTimeout(el._t); el._t = setTimeout(() => { el.className = 'in-toast'; }, 3500);
}
