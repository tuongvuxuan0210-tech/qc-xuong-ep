/**
 * QC System - Đồng bộ mã khuôn / danh mục khuôn từ Phần mềm Quản lý Ép Nhựa (MES)
 * Xưởng Ép Nhựa Hải Tân
 *
 * LỊCH SỬ NGUỒN DỮ LIỆU CỦA MES (quanlyepnhua.netlify.app):
 *   - Trước 11/10/2026: Realtime Database "haithien"
 *   - 11/10 -> 13/10/2026: Cloud Firestore "haitan1" (collection mes_nodes)
 *   - 13/10/2026 -> 11/2026: SUPABASE cloud (project xxpagqtvkyrmtvozopah)
 *   - Từ 11/2026: máy chủ riêng https://api.haitan.online (cùng thành phần Supabase: GoTrue, PostgREST)
 *     – đường dẫn API, tên hàm, cấu trúc dữ liệu giữ nguyên; chỉ đổi địa chỉ + apikey (xem js/config.js).
 *
 * Module này CHỈ ĐỌC 2 node từ MES qua RPC Supabase "mes_read_nodes":
 *   - mold_prod_v12_mes_clean   : nhật ký sản lượng -> mã khuôn đang chạy theo ngày/máy/ca
 *   - mold_catalog_v12_mes_clean: cấu hình khuôn -> chu kỳ, danh sách mã khuôn
 * Kết quả RPC: { [key]: { revision, value } } – value giữ nguyên cấu trúc cũ
 * (ngày -> số máy "1".."21" -> [{shift, moldId}]), nên các hàm getRunningMoldFromProd,
 * qcResolveMold, getDecoCycleByMoldId... dùng lại được.
 * Kiểm tra thay đổi bằng RPC "mes_versions" (chỉ trả về số revision, rất nhẹ) mỗi 30 giây.
 */

// Địa chỉ + apikey lấy từ js/config.js (MES_SERVERS / MES_SERVER_DANG_DUNG)
const MES_SERVER = MES_SERVERS[MES_SERVER_DANG_DUNG] || MES_SERVERS.moi;
const MES_SUPABASE_URL = MES_SERVER.url;
const MES_SUPABASE_KEY = MES_SERVER.key;
const MES_STORAGE_KEY = 'qc-mes-auth-' + MES_SERVER_DANG_DUNG;   // phiên đăng nhập riêng cho từng máy chủ
const MES_TIMEOUT_MS = 25000;                                   // thời gian chờ mỗi yêu cầu
const MES_THU_LAI_MS = [5000, 15000, 60000];                    // mất mạng / lỗi 5xx: thử lại sau 5s, 15s, 60s
// Xóa phiên đăng nhập (token) của máy chủ cũ để đăng nhập lại từ đầu trên máy chủ mới
try { if (MES_SERVER_DANG_DUNG === 'moi') localStorage.removeItem('qc-mes-supabase-auth'); } catch (e) {}
// fetch có giới hạn thời gian chờ
function mesFetch(url, opt) {
    opt = opt || {};
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), MES_TIMEOUT_MS);
    if (opt.signal) { if (opt.signal.aborted) c.abort(); else opt.signal.addEventListener('abort', () => c.abort()); }
    return fetch(url, Object.assign({}, opt, { signal: c.signal })).finally(() => clearTimeout(t));
}
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
let mesLoiLienTiep = 0;
let mesThuLaiTimer = null;
// 19/11: trạng thái máy "Đang Chạy / Tạm Dừng" của PM ép nhựa (bảng Thống kê máy & ca – node machine_status_map_v1,
// khóa `${máy}_${Ngày|Đêm}_${mã khuôn}` hoặc `${máy}_${Ngày|Đêm}` → 'RUNNING' / 'PAUSED'). Đọc riêng, lỗi không ảnh hưởng gì.
const MES_KEY_TRANG_THAI = 'machine_status_map_v1';
let mesTrangThaiMay = {};
let mesTrangThaiCo = false;
async function mesTaiTrangThaiMay() {
    try {
        const d = await mesRpc('mes_read_nodes', { p_keys: [MES_KEY_TRANG_THAI] });
        const v = d && d[MES_KEY_TRANG_THAI] && d[MES_KEY_TRANG_THAI].value;
        if (v && typeof v === 'object') { mesTrangThaiMay = v; mesTrangThaiCo = true; }
    } catch (e) { console.warn('PM ép nhựa - không đọc được trạng thái máy:', (e && (e.message || e.code)) || e); }
}
// Đơn hàng (khách hàng, mã đơn, màu, nhựa) – dùng cho phiếu kiểm hàng đầu tiên (Tab 7). Đọc riêng, 5 phút/lần;
// lỗi ở đây không ảnh hưởng việc đồng bộ mã khuôn.
const MES_KEY_ORDERS = ['mold_orders_v12_mes_clean', 'mold_planned_orders_v12_mes_clean'];
let mesOrders = [];
let mesOrdersAt = 0;
async function mesTaiDonHang(force) {
    if (!mesClient || !mesRunning) return;
    if (!force && Date.now() - mesOrdersAt < 300000) return;
    mesOrdersAt = Date.now();
    try {
        const data = await mesRpc('mes_read_nodes', { p_keys: MES_KEY_ORDERS });
        let ds = [];
        MES_KEY_ORDERS.forEach(k => {
            let v = data && data[k] && data[k].value;
            if (v) ds = ds.concat(Array.isArray(v) ? v : Object.values(v));
        });
        mesOrders = ds.filter(o => o && typeof o === 'object');
    } catch (e) {
        console.warn('PM ép nhựa - không đọc được đơn hàng (phiếu hàng đầu tiên sẽ nhập tay khách hàng / mã đơn):', e);
    }
}

// Lỗi token (401 / JWT hết hạn): làm mới phiên rồi gửi lại đúng yêu cầu đó 1 lần
function mesLaLoiToken(e) {
    const m = String((e && (e.message || e.code)) || '') + ' ' + String((e && (e.status || e.code)) || '');
    return /jwt|token|401|PGRST30[0-3]/i.test(m);
}
function mesLaLoiMang(e) {
    const m = String((e && (e.message || e.name || e.code)) || e || '');
    return /fetch|network|abort|timeout|failed|5\d\d|502|503|504/i.test(m) || (e && e.status >= 500);
}
async function mesRpc(ten, thamSo) {
    let r = await mesClient.rpc(ten, thamSo);
    if (r.error && mesLaLoiToken(r.error)) {
        const { error: eRf } = await mesClient.auth.refreshSession();
        if (eRf) { try { await mesClient.auth.signOut(); } catch (x) {} throw r.error; }
        r = await mesClient.rpc(ten, thamSo);
    }
    if (r.error) throw r.error;
    return r.data;
}

function mesInit() {
    if (mesClient) return true;
    const sdk = window.supabase;
    if (!sdk || typeof sdk.createClient !== 'function') {
        mesSetState('error', 'Thiếu thư viện Supabase');
        return false;
    }
    try {
        mesClient = sdk.createClient(MES_SUPABASE_URL, MES_SUPABASE_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: MES_STORAGE_KEY },
            global: { fetch: mesFetch },
            realtime: { params: { eventsPerSecond: 2 } }
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
    if (mesThuLaiTimer) { clearTimeout(mesThuLaiTimer); mesThuLaiTimer = null; }
    mesLoiLienTiep = 0;
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
            const st = await mesRpc('mes_versions', { p_keys: MES_KEYS });
            const versions = (st && st.versions) || {};
            keys = MES_KEYS.filter(k => versions[k] === undefined || String(versions[k] && versions[k].revision !== undefined ? versions[k].revision : versions[k]) !== String(mesRevisions[k]));
            if (!keys.length) { mesSetState('ok', ''); await mesTaiTrangThaiMay(); return; }
        }
        const data = await mesRpc('mes_read_nodes', { p_keys: keys });
        if (!mesRunning) return;
        keys.forEach(k => {
            const node = data && data[k];
            if (!node || !Object.prototype.hasOwnProperty.call(node, 'value')) return;
            mesRevisions[k] = node.revision;
            mesApply(k, node.value);
        });
        mesSetState('ok', '');
        mesLoiLienTiep = 0;
        mesTaiDonHang(false);
        await mesTaiTrangThaiMay();
    } catch (e) {
        console.warn('PM ép nhựa - lỗi đọc dữ liệu:', (e && (e.message || e.code)) || e);
        mesSetState('error', mesLaLoiMang(e) ? 'Mất kết nối máy chủ MES – đang thử lại' : mesRpcError(e));
        // Mất mạng / lỗi máy chủ: thử lại sau 5s, 15s, 60s (sau đó theo chu kỳ 30s)
        if (mesLaLoiMang(e) && mesLoiLienTiep < MES_THU_LAI_MS.length && !mesThuLaiTimer) {
            const cho = MES_THU_LAI_MS[mesLoiLienTiep++];
            mesThuLaiTimer = setTimeout(() => { mesThuLaiTimer = null; mesRefresh(true); }, cho);
        }
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
        html = `<span class="badge bg-success rounded-pill px-3 py-2 small shadow-sm" title="Mã khuôn đang lấy trực tiếp từ PM ép nhựa (máy chủ ${escapeHtml(MES_SUPABASE_URL.replace(/^https?:\/\//, ''))}, tài khoản ${escapeHtml(email)}). Bấm để đổi tài khoản." style="cursor:pointer;" onclick="mesMoKetNoi()">🔗 Mã khuôn: đồng bộ PM Ép Nhựa (${t})</span>`;
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
        errEl.textContent = mesLaLoiMang(e) ? '⚠️ Không kết nối được máy chủ MES – kiểm tra mạng rồi thử lại'
            : /too many|429|blocked/i.test(String(e && e.message)) ? '⚠️ Sai mật khẩu quá nhiều lần – máy chủ tạm chặn, thử lại sau 1 giờ'
            : '⚠️ Email hoặc mật khẩu PM ép nhựa không đúng';
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
