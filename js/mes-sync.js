/**
 * QC System - Đồng bộ mã khuôn / danh mục khuôn từ Phần mềm Quản lý Ép Nhựa (MES)
 * Xưởng Ép Nhựa Hải Tân
 *
 * LỊCH SỬ NGUỒN DỮ LIỆU CỦA MES (quanlyepnhua.netlify.app):
 *   - Trước 11/10/2026: Realtime Database "haithien"
 *   - 11/10 -> 13/10/2026: Cloud Firestore "haitan1" (collection mes_nodes)
 *   - Từ 13/10/2026: SUPABASE (project xxpagqtvkyrmtvozopah) – Firestore "haitan1" KHÔNG còn
 *     được cập nhật, nên QC vẫn báo "đồng bộ" nhưng mã khuôn đứng yên ở dữ liệu cũ.
 *
 * Module này CHỈ ĐỌC 2 node từ MES qua RPC Supabase "mes_read_nodes":
 *   - mold_prod_v12_mes_clean   : nhật ký sản lượng -> mã khuôn đang chạy theo ngày/máy/ca
 *   - mold_catalog_v12_mes_clean: cấu hình khuôn -> chu kỳ, danh sách mã khuôn
 * Kết quả RPC: { [key]: { revision, value } } – value giữ nguyên cấu trúc cũ
 * (ngày -> số máy "1".."21" -> [{shift, moldId}]), nên các hàm getRunningMoldFromProd,
 * qcResolveMold, getDecoCycleByMoldId... dùng lại được.
 * Kiểm tra thay đổi bằng RPC "mes_versions" (chỉ trả về số revision, rất nhẹ) mỗi 30 giây.
 */

// Cấu hình công khai của MES (publishable key – không phải mật khẩu; quyền đọc vẫn cần đăng nhập)
const MES_SUPABASE_URL = 'https://xxpagqtvkyrmtvozopah.supabase.co';
const MES_SUPABASE_KEY = 'sb_publishable_gCvhq5HORR7SqulpO7gNNg_YfV8Lmh4';
const MES_KEY_PROD = 'mold_prod_v12_mes_clean';
const MES_KEY_CATALOG = 'mold_catalog_v12_mes_clean';
const MES_KEYS = [MES_KEY_PROD, MES_KEY_CATALOG];
const MES_POLL_MS = 30000;

let mesClient = null;
let mesUser = null;
let mesSyncActive = false;          // true khi đã nạp được dữ liệu sản xuất từ MES (chặn dữ liệu RTDB cũ ghi đè)
let mesCatalogActive = false;
let mesRevisions = {};
let mesPollTimer = null;
let mesRunning = false;
let mesBusy = false;
let mesAuthReady = false;
let mesAutoLoginTried = false;
let mesState = { status: 'off', message: '', lastSync: null };
let mesConnectModalInstance = null;

function mesInit() {
    if (mesClient) return true;
    const sdk = window.supabase;
    if (!sdk || typeof sdk.createClient !== 'function') {
        mesSetState('error', 'Thiếu thư viện Supabase');
        return false;
    }
    try {
        mesClient = sdk.createClient(MES_SUPABASE_URL, MES_SUPABASE_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'qc-mes-supabase-auth' }
        });
        mesClient.auth.onAuthStateChange((event, session) => {
            const user = session ? session.user : null;
            const changed = (user && user.id) !== (mesUser && mesUser.id);
            mesUser = user;
            mesAuthReady = true;
            if (user) {
                if (changed) { mesStopListeners(); }
                // tránh gọi RPC ngay trong callback auth (supabase-js khuyến cáo)
                setTimeout(mesStartListeners, 0);
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
    if (mesUser) mesStartListeners();
    else if (mesAuthReady) mesTryAutoLogin();
    // nếu chưa sẵn sàng, onAuthStateChange (INITIAL_SESSION) sẽ tự xử lý
}

// Thử đăng nhập MES bằng chính tài khoản QC đã lưu (nếu tài khoản trùng nhau)
async function mesTryAutoLogin() {
    if (!mesClient || mesUser) return;
    if (mesAutoLoginTried) { mesSetState('need_login', ''); return; }
    mesAutoLoginTried = true;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('qc_saved_auth') || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.email || !saved.pwd) { mesSetState('need_login', ''); return; }
    try {
        mesSetState('connecting', '');
        const { error } = await mesClient.auth.signInWithPassword({ email: saved.email, password: atob(saved.pwd) });
        if (error) throw error;
    } catch (e) {
        mesSetState('need_login', '');
    }
}

// Gọi sau khi người dùng đăng nhập QC thành công bằng form
function mesThuDangNhap(email, pwd) {
    if (!mesInit() || mesUser) return;
    mesAutoLoginTried = true;
    mesSetState('connecting', '');
    mesClient.auth.signInWithPassword({ email, password: pwd })
        .then(({ error }) => { if (error) mesSetState('need_login', ''); })
        .catch(() => mesSetState('need_login', ''));
}

function mesDangXuat() {
    mesStopListeners();
    mesAutoLoginTried = false;
    mesSyncActive = false; mesCatalogActive = false;
    if (mesClient && mesUser) { try { mesClient.auth.signOut(); } catch (e) {} }
    mesSetState('off', '');
}

function mesStopListeners() {
    mesRunning = false;
    if (mesPollTimer) { clearInterval(mesPollTimer); mesPollTimer = null; }
    mesRevisions = {};
}

function mesStartListeners() {
    if (mesRunning || !mesClient || !mesUser) return;
    mesRunning = true;
    mesSetState('connecting', '');
    mesRefresh(true);
    mesPollTimer = setInterval(() => mesRefresh(false), MES_POLL_MS);
}

function mesRpcError(error) {
    const msg = String((error && (error.message || error.code)) || error || 'Lỗi kết nối');
    if (/permission|denied|42501|not authorized|jwt/i.test(msg)) return 'Tài khoản không có quyền đọc dữ liệu PM ép nhựa';
    return msg;
}

// Đọc lại các node có revision thay đổi (lần đầu: đọc tất cả)
async function mesRefresh(full) {
    if (!mesRunning || mesBusy || document.hidden && !full) return;
    mesBusy = true;
    try {
        let keys = MES_KEYS;
        if (!full && Object.keys(mesRevisions).length) {
            const { data: st, error } = await mesClient.rpc('mes_versions', { p_keys: MES_KEYS });
            if (error) throw error;
            const versions = (st && st.versions) || {};
            keys = MES_KEYS.filter(k => versions[k] === undefined || String(versions[k] && versions[k].revision !== undefined ? versions[k].revision : versions[k]) !== String(mesRevisions[k]));
            if (!keys.length) { mesSetState('ok', ''); return; }
        }
        const { data, error } = await mesClient.rpc('mes_read_nodes', { p_keys: keys });
        if (error) throw error;
        if (!mesRunning) return;
        keys.forEach(k => {
            const node = data && data[k];
            if (!node || !Object.prototype.hasOwnProperty.call(node, 'value')) return;
            mesRevisions[k] = node.revision;
            mesApply(k, node.value);
        });
        mesSetState('ok', '');
    } catch (e) {
        console.warn('PM ép nhựa - lỗi đọc dữ liệu', e);
        mesSetState('error', mesRpcError(e));
    } finally {
        mesBusy = false;
    }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && mesRunning) mesRefresh(false); });

function mesApply(key, value) {
    if (key === MES_KEY_PROD) {
        prodDataMap = value || {};
        mesSyncActive = true;
    } else if (key === MES_KEY_CATALOG) {
        moldCatalog = value || [];
        mesCatalogActive = true;
        if (typeof updateMoldDatalist === 'function') updateMoldDatalist();
    }
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
        const email = mesUser ? mesUser.email : '';
        html = `<span class="badge bg-success rounded-pill px-3 py-2 small shadow-sm" title="Mã khuôn đang lấy trực tiếp từ PM ép nhựa (Supabase, tài khoản ${escapeHtml(email)}). Bấm để đổi tài khoản." style="cursor:pointer;" onclick="mesMoKetNoi()">🔗 Mã khuôn: đồng bộ PM Ép Nhựa (${t})</span>`;
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
    const cur = mesUser;
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
        if (mesUser) { mesStopListeners(); await mesClient.auth.signOut(); }
        const { error } = await mesClient.auth.signInWithPassword({ email, password: pwd });
        if (error) throw error;
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
