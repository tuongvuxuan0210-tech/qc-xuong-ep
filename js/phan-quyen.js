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
const QC_EMAIL_DOMAIN = 'haitan.com';
// Gõ 'QCX1' khi đăng nhập -> 'qcx1@haitan.com'; gõ đủ email thì giữ nguyên
function qcEmailTuTen(t) { t = String(t || '').trim(); return t.includes('@') ? t : (t ? t.toLowerCase() + '@' + QC_EMAIL_DOMAIN : ''); }
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
    return `🔒 Tài khoản ${pqTenNgan(pqEmailHienTai())} được phân quyền ${PQ_TEN_XUONG[x]}.\n` +
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
    let el = dkTaoModal('pqModal', '👑 TÀI KHOẢN QC & XƯỞNG', '',
        `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Đóng</button>`, true);
    pqVeBang();
    bootstrap.Modal.getOrCreateInstance(el).show();
}
// Tên đăng nhập ngắn: 'QCX1' <-> 'qcx1@haitan.com'
function pqTenNgan(email) { let e = String(email || ''); return e.toLowerCase().endsWith('@' + QC_EMAIL_DOMAIN) ? e.slice(0, -QC_EMAIL_DOMAIN.length - 1).toUpperCase() : e; }
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
        return `<tr>
            <td class="text-start fw-bold">${escapeHtml(pqTenNgan(u.email || u.k))}${u.k === toi ? ' <span class="badge bg-info text-dark">bạn</span>' : ''}</td>
            <td>${ad ? '<span class="badge bg-warning text-dark px-3 py-2">👑 Admin</span>'
                : `<select class="form-select form-select-sm fw-bold" onchange="pqDoiXuong('${u.k}', this.value)">${opt}</select>`}</td>
            <td class="text-nowrap">${u.k === toi ? '' : (ad
                ? `<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="pqDoiAdmin('${u.k}', false)">Gỡ Admin</button>`
                : `<button type="button" class="btn btn-sm btn-outline-warning py-0 px-2" onclick="pqDoiAdmin('${u.k}', true)">👑 Cho làm Admin</button>
                   <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" title="Xóa khỏi danh sách" onclick="pqXoa('${u.k}')">🗑️</button>`)}</td>
        </tr>`;
    }).join('');
    body.innerHTML = `
        <div class="fw-bold mb-1">➕ Tạo tài khoản QC</div>
        <div class="row g-2 mb-3">
            <div class="col-6 col-md-3"><input type="text" class="form-control form-control-sm fw-bold text-uppercase" id="pqTenMoi" placeholder="Tên đăng nhập (VD: QCX1)" autocomplete="off"></div>
            <div class="col-6 col-md-3"><input type="text" class="form-control form-control-sm" id="pqMatKhauMoi" placeholder="Mật khẩu (ít nhất 6 ký tự)" autocomplete="off"></div>
            <div class="col-6 col-md-3"><select class="form-select form-select-sm fw-bold" id="pqXuongMoi">
                <option value="X1">${PQ_TEN_XUONG.X1}</option><option value="X2">${PQ_TEN_XUONG.X2}</option><option value="ALL">${PQ_TEN_XUONG.ALL}</option></select></div>
            <div class="col-6 col-md-3"><button type="button" class="btn btn-sm btn-3d-emerald w-100" id="pqBtnTao" onclick="pqTaoTaiKhoan()">Tạo tài khoản</button></div>
        </div>
        <div class="table-responsive"><table class="table table-bordered table-sm align-middle text-center mb-0">
            <thead><tr><th>Tài khoản</th><th style="width:190px;">Xưởng</th><th style="width:200px;"></th></tr></thead>
            <tbody>${dong || '<tr><td colspan="3" class="opacity-75">Chưa có tài khoản</td></tr>'}</tbody>
        </table></div>`;
}
// Tạo tài khoản đăng nhập Firebase bằng một phiên phụ, để Admin không bị đăng xuất
async function pqTaoTaiKhoan() {
    if (!pqLaAdmin()) return;
    let ten = (document.getElementById('pqTenMoi').value || '').trim();
    let mk = document.getElementById('pqMatKhauMoi').value || '';
    let x = document.getElementById('pqXuongMoi').value;
    if (!/^[A-Za-z0-9._-]{2,30}$/.test(ten)) { alert('⚠️ Tên đăng nhập chỉ gồm chữ không dấu, số, dấu . _ - (VD: QCX1).'); return; }
    if (mk.length < 6) { alert('⚠️ Mật khẩu phải có ít nhất 6 ký tự.'); return; }
    let email = qcEmailTuTen(ten);
    let btn = document.getElementById('pqBtnTao');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang tạo...'; }
    let phu = null;
    try {
        phu = firebase.apps.find(a => a.name === 'pqPhu') || firebase.initializeApp(firebaseConfig, 'pqPhu');
        await phu.auth().createUserWithEmailAndPassword(email, mk);
        try { await phu.auth().signOut(); } catch (e) {}
        await db.ref(`${PQ_PATH}/users/${pqKhoaEmail(email)}`).set({ email, xuong: x, taoLuc: Date.now() });
        alert(`✅ Đã tạo tài khoản ${ten.toUpperCase()} – ${PQ_TEN_XUONG[x]}.\nĐăng nhập: gõ "${ten.toUpperCase()}" và mật khẩu vừa đặt.`);
    } catch (e) {
        let m = e && e.code === 'auth/email-already-in-use' ? `Tên ${ten.toUpperCase()} đã có rồi – chọn tên khác.`
            : e && e.code === 'auth/weak-password' ? 'Mật khẩu quá yếu (ít nhất 6 ký tự).'
            : e && e.code === 'auth/operation-not-allowed' ? 'Firebase chưa bật đăng nhập Email/Mật khẩu.'
            : (e && e.message) || e;
        alert('❌ Không tạo được: ' + m);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Tạo tài khoản'; }
    }
}
function pqDoiXuong(k, x) {
    if (!pqLaAdmin()) return;
    db.ref(`${PQ_PATH}/users/${k}/xuong`).set(x).catch(e => alert('❌ ' + e.message));
}
function pqDoiAdmin(k, bat) {
    if (!pqLaAdmin()) return;
    let email = ((pqData.users || {})[k] || {}).email || (pqData.admins || {})[k] || k;
    if (!confirm(bat ? `Cho ${pqTenNgan(email)} làm ADMIN?` : `Gỡ quyền ADMIN của ${pqTenNgan(email)}?`)) return;
    db.ref(`${PQ_PATH}/admins/${k}`).set(bat ? email : null).catch(e => alert('❌ ' + e.message));
}
function pqXoa(k) {
    if (!pqLaAdmin()) return;
    let email = ((pqData.users || {})[k] || {}).email || k;
    if (!confirm(`Xóa ${pqTenNgan(email)} khỏi danh sách? (Tài khoản vẫn đăng nhập được, nhưng về "Cả 2 xưởng". Muốn khóa hẳn thì xóa trong Firebase Console → Authentication.)`)) return;
    db.ref(PQ_PATH).update({ [`users/${k}`]: null, [`admins/${k}`]: null }).catch(e => alert('❌ ' + e.message));
}
