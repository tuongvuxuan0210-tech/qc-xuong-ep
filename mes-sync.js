/**
 * QC System - Đồng bộ mã khuôn / danh mục khuôn từ Phần mềm Quản lý Ép Nhựa (MES)
 * Xưởng Ép Nhựa Hải Tân
 *
 * Từ 11/10/2026 phần mềm ép nhựa (quanlyepnhua.netlify.app) đã chuyển dữ liệu sang
 * Cloud Firestore của dự án Firebase "haitan1" (collection mes_nodes). Dữ liệu cũ trên
 * Realtime Database "haithien" không còn được cập nhật nên QC không thấy mã khuôn mới.
 *
 * Module này CHỈ ĐỌC 2 nhánh từ MES:
 *   - mold_prod_v12_mes_clean   : nhật ký sản lượng -> mã khuôn đang chạy theo ngày/máy/ca
 *   - mold_catalog_v12_mes_clean: cấu hình khuôn -> chu kỳ, danh sách mã khuôn
 * Cấu trúc dữ liệu giữ nguyên như trước (ngày -> số máy "1".."21" -> [{shift, moldId}]),
 * nên các hàm cũ (getRunningMoldFromProd, getDecoCycleByMoldId...) dùng lại được.
 *
 * Định dạng lưu của MES: mes_nodes/{key} là manifest
 *   { format:'mes-json-segments-v1', present, byteLength, segmentCount, revision, updatedAt }
 * và mes_nodes/{key}/segments/{000000..} có trường "data" (Bytes) = các đoạn JSON UTF-8.
 */

// Cấu hình web công khai của phần mềm ép nhựa (không phải mật khẩu; quyền đọc vẫn cần đăng nhập)
const MES_FIREBASE_CONFIG = {
    apiKey: "AIzaSyD5fR0Lol9Oqt9IOnmZubDxJhcfJC9ho9c",
    authDomain: "haitan1.firebaseapp.com",
    projectId: "haitan1",
    storageBucket: "haitan1.firebasestorage.app",
    messagingSenderId: "510503990739",
    appId: "1:510503990739:web:967aacff806e774f1f2b26"
};
const MES_NODE_COLLECTION = 'mes_nodes';
const MES_SEGMENT_FORMAT = 'mes-json-segments-v1';
const MES_KEY_PROD = 'mold_prod_v12_mes_clean';
const MES_KEY_CATALOG = 'mold_catalog_v12_mes_clean';

let mesApp = null, mesAuth = null, mesFs = null;
let mesSyncActive = false;          // true khi đã nạp được dữ liệu sản xuất từ MES (chặn dữ liệu RTDB cũ ghi đè)
let mesCatalogActive = false;
let mesUnsubs = [];
let mesFingerprints = {};
let mesAuthReady = false;
let mesAutoLoginTried = false;
let mesState = { status: 'off', message: '', lastSync: null };
let mesConnectModalInstance = null;

function mesInit() {
    if (mesApp) return true;
    if (typeof firebase === 'undefined' || !firebase.initializeApp || typeof firebase.firestore !== 'function') {
        mesSetState('error', 'Thiếu thư viện Firestore');
        return false;
    }
    try {
        mesApp = (firebase.apps || []).find(a => a.name === 'mes') || firebase.initializeApp(MES_FIREBASE_CONFIG, 'mes');
        mesAuth = mesApp.auth();
        mesFs = mesApp.firestore();
        try { mesAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
        mesAuth.onAuthStateChanged(user => {
            mesAuthReady = true;
            if (user) {
                mesStartListeners();
            } else {
                mesStopListeners();
                if (typeof currentUser !== 'undefined' && currentUser) mesTryAutoLogin();
                else mesSetState('off', '');
            }
        });
        return true;
    } catch (e) {
        console.warn('Không khởi tạo được kết nối PM ép nhựa:', e);
        mesSetState('error', e.message);
        return false;
    }
}

// Gọi khi tài khoản QC đã đăng nhập
function mesKhoiDong() {
    if (!mesInit()) return;
    if (mesAuth.currentUser) mesStartListeners();
    else if (mesAuthReady) mesTryAutoLogin();
    // nếu chưa sẵn sàng, onAuthStateChanged sẽ tự xử lý
}

// Thử đăng nhập MES bằng chính tài khoản QC đã lưu (nếu tài khoản trùng nhau)
async function mesTryAutoLogin() {
    if (!mesAuth || mesAuth.currentUser) return;
    if (mesAutoLoginTried) { mesSetState('need_login', ''); return; }
    mesAutoLoginTried = true;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('qc_saved_auth') || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.email || !saved.pwd) { mesSetState('need_login', ''); return; }
    try {
        mesSetState('connecting', '');
        await mesAuth.signInWithEmailAndPassword(saved.email, atob(saved.pwd));
    } catch (e) {
        mesSetState('need_login', '');
    }
}

// Gọi sau khi người dùng đăng nhập QC thành công bằng form
function mesThuDangNhap(email, pwd) {
    if (!mesInit() || mesAuth.currentUser) return;
    mesAutoLoginTried = true;
    mesSetState('connecting', '');
    mesAuth.signInWithEmailAndPassword(email, pwd).catch(() => mesSetState('need_login', ''));
}

function mesDangXuat() {
    mesStopListeners();
    mesAutoLoginTried = false;
    mesSyncActive = false; mesCatalogActive = false;
    if (mesAuth && mesAuth.currentUser) { try { mesAuth.signOut(); } catch (e) {} }
    mesSetState('off', '');
}

function mesStopListeners() {
    mesUnsubs.forEach(u => { try { u(); } catch (e) {} });
    mesUnsubs = [];
    mesFingerprints = {};
}

function mesStartListeners() {
    if (mesUnsubs.length || !mesFs) return;
    mesSetState('connecting', '');
    [MES_KEY_PROD, MES_KEY_CATALOG].forEach(key => {
        const ref = mesFs.collection(MES_NODE_COLLECTION).doc(key);
        const unsub = ref.onSnapshot(snap => mesHandleManifest(key, ref, snap), err => {
            console.warn('PM ép nhựa - lỗi đọc', key, err);
            const denied = String(err.code || '').includes('permission');
            mesSetState('error', denied ? 'Tài khoản không có quyền đọc dữ liệu PM ép nhựa' : (err.message || 'Lỗi kết nối'));
        });
        mesUnsubs.push(unsub);
    });
}

function mesDecode(manifest, segmentDatas) {
    if (!manifest || manifest.format !== MES_SEGMENT_FORMAT) throw new Error('Sai định dạng dữ liệu MES');
    if (!manifest.present) return null;
    if (segmentDatas.length !== manifest.segmentCount) throw new Error('Thiếu phần dữ liệu MES');
    const bytes = new Uint8Array(manifest.byteLength);
    let offset = 0;
    segmentDatas.forEach(d => {
        const part = d && d.toUint8Array ? d.toUint8Array() : d;
        bytes.set(part, offset); offset += part.length;
    });
    if (offset !== manifest.byteLength) throw new Error('Kích thước dữ liệu MES không khớp');
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

async function mesHandleManifest(key, ref, snap, lanThu) {
    if (!snap.exists) return;
    const man = snap.data();
    const fp = JSON.stringify([man.revision, man.byteLength, man.segmentCount, man.present]);
    if (mesFingerprints[key] === fp && !lanThu) return;
    try {
        const segs = await Promise.all(Array.from({ length: man.segmentCount || 0 }, (_, i) =>
            ref.collection('segments').doc(String(i).padStart(6, '0')).get()));
        if (segs.some(s => !s.exists)) throw new Error('Thiếu phần dữ liệu MES');
        const value = mesDecode(man, segs.map(s => s.data().data));
        mesFingerprints[key] = fp;
        mesApply(key, value);
    } catch (e) {
        // Có thể đọc đúng lúc MES đang ghi -> thử lại 1 lần sau 2 giây
        if (!lanThu) setTimeout(() => ref.get().then(s => mesHandleManifest(key, ref, s, 1)), 2000);
        else { console.warn('PM ép nhựa - không giải mã được', key, e); mesSetState('error', e.message); }
    }
}

function mesApply(key, value) {
    if (key === MES_KEY_PROD) {
        prodDataMap = value || {};
        mesSyncActive = true;
    } else if (key === MES_KEY_CATALOG) {
        moldCatalog = value || [];
        mesCatalogActive = true;
        if (typeof updateMoldDatalist === 'function') updateMoldDatalist();
    }
    mesSetState('ok', '');
    if (typeof isEditMode !== 'undefined' && isEditMode) {
        if (typeof debouncedRenderTab1 === 'function') debouncedRenderTab1();
        if (typeof debouncedRenderTab2 === 'function') debouncedRenderTab2();
        if (typeof debouncedRenderTab3 === 'function') debouncedRenderTab3();
    }
}

function mesSetState(status, message) {
    mesState.status = status;
    mesState.message = message || '';
    if (status === 'ok') mesState.lastSync = new Date();
    const el = document.getElementById('mes-status');
    if (!el) return;
    const loggedIn = typeof currentUser !== 'undefined' && !!currentUser;
    if (!loggedIn || status === 'off') { el.innerHTML = ''; return; }
    let html = '';
    if (status === 'ok') {
        const t = mesState.lastSync.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const email = mesAuth && mesAuth.currentUser ? mesAuth.currentUser.email : '';
        html = `<span class="badge bg-success rounded-pill px-3 py-2 small shadow-sm" title="Mã khuôn đang lấy trực tiếp từ PM ép nhựa (tài khoản ${escapeHtml(email)}). Bấm để đổi tài khoản." style="cursor:pointer;" onclick="mesMoKetNoi()">🔗 Mã khuôn: đồng bộ PM Ép Nhựa (${t})</span>`;
    } else if (status === 'connecting') {
        html = `<span class="badge bg-info text-dark rounded-pill px-3 py-2 small shadow-sm">⏳ Đang kết nối PM Ép Nhựa...</span>`;
    } else if (status === 'need_login') {
        html = `<button type="button" class="btn btn-sm btn-3d-amber px-3" onclick="mesMoKetNoi()" title="Mã khuôn đang dùng dữ liệu cũ. Đăng nhập tài khoản phần mềm ép nhựa để đồng bộ mã khuôn theo ngày.">⚠️ Kết nối PM Ép Nhựa để lấy mã khuôn</button>`;
    } else if (status === 'error') {
        html = `<button type="button" class="btn btn-sm btn-3d-ruby px-3" onclick="mesMoKetNoi()" title="${escapeHtml(mesState.message)}">❌ Lỗi đồng bộ PM Ép Nhựa – bấm để kết nối lại</button>`;
    }
    el.innerHTML = html;
}

// ===== Hộp thoại đăng nhập tài khoản PM ép nhựa =====
function mesMoKetNoi() {
    if (typeof checkAuthOrAlert === 'function' && !checkAuthOrAlert()) return;
    if (!mesInit()) return;
    if (!document.getElementById('mesConnectModal')) {
        const div = document.createElement('div');
        div.innerHTML = `
        <div class="modal fade" id="mesConnectModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-sm">
                <div class="modal-content rounded-4">
                    <div class="modal-header py-2" style="background: linear-gradient(90deg, #0284c7, #0369a1);">
                        <h6 class="modal-title fw-bold m-0 text-white">🔗 KẾT NỐI PM ÉP NHỰA</h6>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-3">
                        <div class="small mb-2">Đăng nhập bằng tài khoản của <b>phần mềm quản lý ép nhựa</b> (quanlyepnhua.netlify.app) để QC tự lấy mã khuôn đang chạy theo ngày / máy / ca. QC chỉ <b>đọc</b>, không ghi gì vào phần mềm ép nhựa.</div>
                        <div id="mesConnectCurrent" class="small text-success fw-bold mb-2"></div>
                        <input type="email" class="form-control form-control-sm mb-2" id="mesEmailInput" placeholder="Email PM ép nhựa" autocomplete="username">
                        <input type="password" class="form-control form-control-sm mb-2" id="mesPasswordInput" placeholder="Mật khẩu" autocomplete="current-password"
                            onkeydown="if(event.key==='Enter') mesKetNoi()">
                        <div id="mesConnectError" class="small text-danger fw-bold d-none"></div>
                    </div>
                    <div class="modal-footer py-2">
                        <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-3 d-none" id="mesBtnDisconnect" onclick="mesNgatKetNoi()">Ngắt kết nối</button>
                        <button type="button" class="btn btn-sm btn-3d-emerald px-3" id="mesBtnConnect" onclick="mesKetNoi()">Kết nối</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.appendChild(div.firstElementChild);
    }
    const cur = mesAuth.currentUser;
    document.getElementById('mesConnectCurrent').textContent = cur ? `Đang kết nối bằng: ${cur.email}` : '';
    document.getElementById('mesBtnDisconnect').classList.toggle('d-none', !cur);
    document.getElementById('mesConnectError').classList.add('d-none');
    let savedEmail = '';
    try { savedEmail = localStorage.getItem('qc_mes_saved_email') || ''; } catch (e) {}
    document.getElementById('mesEmailInput').value = cur ? cur.email : savedEmail;
    document.getElementById('mesPasswordInput').value = '';
    if (!mesConnectModalInstance) mesConnectModalInstance = new bootstrap.Modal(document.getElementById('mesConnectModal'));
    mesConnectModalInstance.show();
}

async function mesKetNoi() {
    const email = document.getElementById('mesEmailInput').value.trim();
    const pwd = document.getElementById('mesPasswordInput').value;
    const errEl = document.getElementById('mesConnectError');
    const btn = document.getElementById('mesBtnConnect');
    if (!email || !pwd) { errEl.textContent = '⚠️ Nhập đủ email và mật khẩu'; errEl.classList.remove('d-none'); return; }
    btn.disabled = true; btn.textContent = '⏳...';
    try {
        if (mesAuth.currentUser) { mesStopListeners(); await mesAuth.signOut(); }
        await mesAuth.signInWithEmailAndPassword(email, pwd);
        try { localStorage.setItem('qc_mes_saved_email', email); } catch (e) {}
        mesConnectModalInstance.hide();
    } catch (e) {
        errEl.textContent = '⚠️ Email hoặc mật khẩu PM ép nhựa không đúng';
        errEl.classList.remove('d-none');
    } finally {
        btn.disabled = false; btn.textContent = 'Kết nối';
    }
}

function mesNgatKetNoi() {
    mesDangXuat();
    mesAutoLoginTried = true; // không tự đăng nhập lại ngay
    mesSetState('need_login', '');
    if (mesConnectModalInstance) mesConnectModalInstance.hide();
}
