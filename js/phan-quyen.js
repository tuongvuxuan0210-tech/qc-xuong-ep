/**
 * QC System - Phân quyền tài khoản theo xưởng
 * Xưởng Ép Nhựa Hải Tân
 *
 *  - Admin gán mỗi tài khoản QC vào 1 xưởng (Xưởng 1 / Xưởng 2) hoặc "Cả 2 xưởng".
 *  - Tài khoản đã gán xưởng: chỉ tạo / kiểm phiếu của máy thuộc xưởng mình (tránh chọn nhầm xưởng).
 *  - Admin: không giới hạn xưởng, mở được bảng "👑 Phân quyền".
 *  - Khi chưa có Admin nào: tài khoản đầu tiên bấm "Nhận quyền Admin" sẽ thành Admin.
 *
 * Dữ liệu Firebase: qc_phan_quyen_v1/
 *     admins/<emailKey> = email
 *     users/<emailKey>  = { email, xuong: 'ALL' | 'X1' | 'X2', lanCuoi }
 * Mã xưởng: X1 = Xưởng 1 (mã nội bộ máy 11-21), X2 = Xưởng 2 (mã nội bộ máy 1-10).
 */

const PQ_PATH = 'qc_phan_quyen_v1';
const PQ_TEN_XUONG = { ALL: 'Cả 2 xưởng', X1: 'Xưởng 1 (M1–M11)', X2: 'Xưởng 2 (M1–M10)' };

let pqData = { admins: {}, users: {} };
let pqBound = false;
let pqDaGhiLanCuoi = false;

function pqKhoaEmail(email) { return String(email || '').trim().toLowerCase().replace(/[.#$\[\]\/]/g, '_'); }
function pqEmailHienTai() { try { return (firebase.auth().currentUser || {}).email || ''; } catch (e) { return ''; } }
function pqCoAdmin() { return Object.keys(pqData.admins || {}).length > 0; }
function pqLaAdmin(email) { return !!(pqData.admins || {})[pqKhoaEmail(email || pqEmailHienTai())]; }
// Xưởng được phép của tài khoản đang đăng nhập: 'ALL' | 'X1' | 'X2'
function pqXuongCuaToi() {
    if (pqLaAdmin()) return 'ALL';
    let u = (pqData.users || {})[pqKhoaEmail(pqEmailHienTai())];
    return (u && (u.xuong === 'X1' || u.xuong === 'X2')) ? u.xuong : 'ALL';
}
function pqXuongCuaMay(m) { return (parseInt(m) || 0) >= 11 ? 'X1' : 'X2'; }
// Danh sách mã nội bộ máy của một xưởng, theo thứ tự hiển thị
function pqDsMayXuong(x) { return QC_THU_TU_MAY.filter(m => m <= TOTAL_MACHINES && (x === 'X1' ? m >= 11 : x === 'X2' ? m <= 10 : true)); }
// Trả về chuỗi lỗi nếu tài khoản hiện tại không được thao tác trên máy m, ngược lại ''
function pqKiemMay(m) {
    let x = pqXuongCuaToi();
    if (x === 'ALL' || !m) return '';
    let xm = pqXuongCuaMay(m);
    if (xm === x) return '';
    return `🔒 Tài khoản ${pqEmailHienTai()} được phân quyền ${PQ_TEN_XUONG[x]}.\n` +
        `Máy ${qcTenMay(m)} thuộc ${PQ_TEN_XUONG[xm]} – không thao tác được.\nNếu cần đổi xưởng, liên hệ Admin.`;
}

function pqKhoiDong() {
    if (!db || pqBound) return;
    pqBound = true;
    db.ref(PQ_PATH).on('value', s => {
        let v = s.val() || {};
        pqData = { admins: v.admins || {}, users: v.users || {} };
        pqGhiLanCuoi();
        if (typeof faiApXuongMacDinh === 'function') faiApXuongMacDinh();
        if (typeof faiRender === 'function') faiRender();
        if (document.getElementById('pqModal')) pqVeBang();
    }, err => { console.warn('Không đọc được phân quyền', err); pqBound = false; });
}
function pqStop() {
    if (db) { try { db.ref(PQ_PATH).off(); } catch (e) {} }
    pqBound = false; pqDaGhiLanCuoi = false;
    pqData = { admins: {}, users: {} };
}
// Ghi lại tài khoản vừa đăng nhập để Admin thấy trong danh sách mà gán xưởng
function pqGhiLanCuoi() {
    if (pqDaGhiLanCuoi || !db) return;
    let email = pqEmailHienTai();
    if (!email) return;
    pqDaGhiLanCuoi = true;
    let k = pqKhoaEmail(email);
    let up = { email, lanCuoi: Date.now() };
    if (!(pqData.users || {})[k]) up.xuong = 'ALL';
    db.ref(`${PQ_PATH}/users/${k}`).update(up).catch(e => console.warn('Không ghi được lần đăng nhập', e));
}

// ===================== BẢNG PHÂN QUYỀN (ADMIN) =====================
function pqMoBang() {
    if (!checkAuthOrAlert() || !db) return;
    if (!pqCoAdmin()) {
        if (!confirm(`Hệ thống chưa có Admin.\nNhận quyền ADMIN cho tài khoản ${pqEmailHienTai()}?`)) return;
        db.ref(`${PQ_PATH}/admins/${pqKhoaEmail(pqEmailHienTai())}`).set(pqEmailHienTai())
            .then(() => setTimeout(pqMoBang, 300))
            .catch(e => alert('❌ Không ghi được: ' + e.message));
        return;
    }
    if (!pqLaAdmin()) { alert('🔒 Chỉ Admin mới mở được bảng phân quyền.'); return; }
    let el = dkTaoModal('pqModal', '👑 PHÂN QUYỀN TÀI KHOẢN THEO XƯỞNG', '',
        `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>`, true);
    pqVeBang();
    bootstrap.Modal.getOrCreateInstance(el).show();
}
function pqVeBang() {
    let body = document.getElementById('pqModalBody');
    if (!body) return;
    let toi = pqKhoaEmail(pqEmailHienTai());
    let ds = Object.keys(pqData.users || {}).map(k => Object.assign({ k }, pqData.users[k]));
    Object.keys(pqData.admins || {}).forEach(k => { if (!ds.some(u => u.k === k)) ds.push({ k, email: pqData.admins[k], xuong: 'ALL' }); });
    ds.sort((a, b) => String(a.email).localeCompare(String(b.email)));
    let dong = ds.map(u => {
        let ad = !!pqData.admins[u.k];
        let opt = ['ALL', 'X1', 'X2'].map(x => `<option value="${x}" ${(u.xuong || 'ALL') === x ? 'selected' : ''}>${PQ_TEN_XUONG[x]}</option>`).join('');
        let lc = u.lanCuoi ? new Date(u.lanCuoi).toLocaleString('vi-VN', { hour12: false }) : '—';
        return `<tr>
            <td class="text-start fw-bold">${escapeHtml(u.email || u.k)}${u.k === toi ? ' <span class="badge bg-info text-dark">bạn</span>' : ''}</td>
            <td><select class="form-select form-select-sm fw-bold" ${ad ? 'disabled title="Admin không giới hạn xưởng"' : ''}
                onchange="pqDoiXuong('${u.k}', this.value)">${opt}</select></td>
            <td><div class="form-check form-switch d-inline-block m-0"><input class="form-check-input" type="checkbox" ${ad ? 'checked' : ''}
                ${u.k === toi ? 'disabled title="Không tự gỡ quyền Admin của chính mình"' : ''} onchange="pqDoiAdmin('${u.k}', this.checked, this)"></div></td>
            <td class="small opacity-75">${lc}</td>
            <td>${u.k === toi ? '' : `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="pqXoa('${u.k}')">🗑️</button>`}</td>
        </tr>`;
    }).join('');
    body.innerHTML = `
        <div class="small opacity-75 mb-2">Tài khoản được gán <b>Xưởng 1</b> hoặc <b>Xưởng 2</b> chỉ tạo / kiểm phiếu của máy thuộc xưởng đó.
            "Cả 2 xưởng" thì phải tự chọn xưởng khi tạo phiếu. Tài khoản tự hiện ở đây sau lần đăng nhập đầu tiên, hoặc thêm bằng email bên dưới.</div>
        <div class="table-responsive"><table class="table table-bordered table-sm align-middle text-center mb-2">
            <thead><tr><th>Tài khoản</th><th style="width:170px;">Xưởng</th><th>Admin</th><th>Lần đăng nhập cuối</th><th></th></tr></thead>
            <tbody>${dong || '<tr><td colspan="5" class="opacity-75">Chưa có tài khoản</td></tr>'}</tbody>
        </table></div>
        <div class="d-flex flex-wrap gap-2">
            <input type="email" class="form-control form-control-sm" style="max-width:260px;" id="pqEmailMoi" placeholder="Email tài khoản QC">
            <select class="form-select form-select-sm fw-bold" style="width:170px;" id="pqXuongMoi">
                <option value="X1">${PQ_TEN_XUONG.X1}</option><option value="X2">${PQ_TEN_XUONG.X2}</option><option value="ALL">${PQ_TEN_XUONG.ALL}</option></select>
            <button type="button" class="btn btn-sm btn-3d-emerald px-3" onclick="pqThem()">➕ Thêm</button>
        </div>`;
}
function pqDoiXuong(k, x) {
    if (!pqLaAdmin()) return;
    db.ref(`${PQ_PATH}/users/${k}/xuong`).set(x).catch(e => alert('❌ ' + e.message));
}
function pqDoiAdmin(k, bat, el) {
    if (!pqLaAdmin()) return;
    let email = ((pqData.users || {})[k] || {}).email || (pqData.admins || {})[k] || k;
    if (!confirm(bat ? `Cấp quyền ADMIN cho ${email}?` : `Gỡ quyền ADMIN của ${email}?`)) { if (el) el.checked = !bat; return; }
    db.ref(`${PQ_PATH}/admins/${k}`).set(bat ? email : null).catch(e => alert('❌ ' + e.message));
}
function pqThem() {
    if (!pqLaAdmin()) return;
    let email = (document.getElementById('pqEmailMoi').value || '').trim().toLowerCase();
    let x = document.getElementById('pqXuongMoi').value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('⚠️ Email không hợp lệ.'); return; }
    db.ref(`${PQ_PATH}/users/${pqKhoaEmail(email)}`).update({ email, xuong: x }).catch(e => alert('❌ ' + e.message));
}
function pqXoa(k) {
    if (!pqLaAdmin()) return;
    let email = ((pqData.users || {})[k] || {}).email || k;
    if (!confirm(`Xóa ${email} khỏi danh sách phân quyền? (tài khoản sẽ về "Cả 2 xưởng" khi đăng nhập lại)`)) return;
    db.ref(PQ_PATH).update({ [`users/${k}`]: null, [`admins/${k}`]: null }).catch(e => alert('❌ ' + e.message));
}
