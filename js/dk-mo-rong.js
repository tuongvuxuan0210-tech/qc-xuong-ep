/**
 * QC System - Tab 6 mở rộng
 * 1) Thông tin khuôn (mã SP, tên SP, nhựa, màu, cavity, chu kỳ) tự lấy từ danh mục khuôn của PM ép nhựa (MES).
 * 2) Chụp ảnh màn hình máy ép -> AI đọc số trong ảnh -> tự điền vào ô nhập (bản chuẩn và phiếu QC kiểm).
 *    Khóa API (Claude hoặc Gemini) lưu ở Firebase: system_config/ai_doc_anh - dùng chung cho các tài khoản QC.
 */
const DK_AI_PATH = 'system_config/ai_doc_anh';
const DK_AI_MODEL = { claude: 'claude-sonnet-5-5', gemini: 'gemini-3.8-flash' };
let dkAiCfg = null, dkAiBound = false;

// ===================== 1. ĐỒNG BỘ THÔNG TIN KHUÔN TỪ MES =====================
function dkThongTinMes(moldId) {
    if (!moldId || !moldCatalog) return {};
    let target = String(moldId).trim().toLowerCase();
    let list = Array.isArray(moldCatalog) ? moldCatalog : Object.values(moldCatalog);
    let f = list.find(m => m && String(m.id || m.moldId || '').trim().toLowerCase() === target);
    if (!f) return {};
    let parts = Array.isArray(f.parts) ? f.parts : (f.parts && typeof f.parts === 'object' ? Object.values(f.parts) : []);
    parts = parts.filter(p => p && typeof p === 'object');
    let o = {};
    let ma = parts.map(p => String(p.code || '').trim()).filter(Boolean).join(', ');
    let ten = parts.map(p => String(p.name || '').trim()).filter(Boolean).join(', ') || String(f.name || '').trim();
    let cav = parts.map(p => p.cavity).filter(c => c !== undefined && c !== null && String(c).trim() !== '');
    if (ma) o.maSP = ma;
    if (ten) o.tenSP = ten;
    if (String(f.resinType || '').trim()) o.nhua = String(f.resinType).trim();
    if (String(f.colorCode || f.resinColor || '').trim()) o.mau = String(f.colorCode || f.resinColor).trim();
    if (cav.length) o.cavity = cav.join(' + ');
    else if (f.cavity) o.cavity = String(f.cavity);
    let ck = parseFloat(f.cycle);
    if (!isNaN(ck) && ck > 0) o.chuKy = ck;
    return o;
}

// Điền các ô thông tin trong form bản chuẩn theo MES (ô nào MES có dữ liệu thì khóa, không cho sửa tay)
function dkDongBoMes() {
    let body = document.getElementById('dkChuanModalBody');
    let moldEl = document.getElementById('dkCMold');
    if (!body || !moldEl) return;
    let mes = dkThongTinMes(moldEl.value);
    body.querySelectorAll('.dk-info').forEach(i => {
        let v = mes[i.dataset.info];
        if (v) {
            i.value = v; i.readOnly = true; i.tabIndex = -1;
            i.title = 'Lấy tự động từ danh mục khuôn PM ép nhựa';
            i.style.opacity = '.85';
        } else if (i.readOnly) {
            i.readOnly = false; i.tabIndex = 0; i.title = ''; i.style.opacity = '';
            i.value = '';
        }
    });
    let ck = body.querySelector('.dk-c[data-pid="ck_chuky"]');
    if (ck && ck.value.trim() === '' && mes.chuKy) ck.value = mes.chuKy;
    let ghi = document.getElementById('dkMesGhiChu');
    if (ghi) ghi.textContent = Object.keys(mes).length
        ? '🔗 Mã SP, tên SP, nhựa, màu, cavity, chu kỳ lấy tự động từ PM ép nhựa.'
        : 'Khuôn này chưa có trong danh mục PM ép nhựa – nhập tay thông tin.';
}

// ===================== 2. AI ĐỌC ẢNH MÀN HÌNH MÁY =====================
function dkAiNghe() {
    if (dkAiBound || !db) return;
    dkAiBound = true;
    db.ref(DK_AI_PATH).on('value', s => { dkAiCfg = s.val() || null; }, () => { dkAiBound = false; });
}

function dkAiThanh(cheDo) {
    return `
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
        <label class="btn btn-sm btn-3d-primary m-0 px-3" style="cursor:pointer;" title="Chụp hoặc chọn 1 đến 6 ảnh màn hình máy ép; AI đọc số và điền vào các ô bên dưới">
            📷 Chụp ảnh màn hình máy → tự điền
            <input type="file" accept="image/*" multiple style="display:none;" onchange="dkAiChonAnh(this, '${cheDo}')">
        </label>
        <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-2" onclick="dkAiCaiDat()" title="Cài khóa API cho AI đọc ảnh">⚙️ Khóa AI</button>
        <span class="small fw-bold" id="dkAiTrangThai_${cheDo}"></span>
    </div>
    ${cheDo === 'chuan' ? '<div class="small opacity-75 mb-2" id="dkMesGhiChu"></div>' : ''}`;
}

function dkAiCaiDat() {
    if (!checkAuthOrAlert() || !db) return;
    let hienTai = dkAiCfg && dkAiCfg.key ? `Đang dùng: ${dkAiCfg.loai} (${dkAiCfg.model}), khóa …${String(dkAiCfg.key).slice(-4)}.\n` : 'Chưa có khóa.\n';
    let key = prompt('🔑 KHÓA API CHO AI ĐỌC ẢNH\n' + hienTai +
        'Dán khóa API Claude (bắt đầu bằng sk-ant-) hoặc Gemini (bắt đầu bằng AIza).\n' +
        'Khóa lưu trên Firebase và dùng chung cho mọi tài khoản QC đã đăng nhập. Để trống = giữ nguyên.', '');
    if (key === null || !key.trim()) return;
    key = key.trim();
    let loai = key.startsWith('sk-ant') ? 'claude' : 'gemini';
    let model = prompt(`Tên model ${loai === 'claude' ? 'Claude' : 'Gemini'} dùng để đọc ảnh:`, (dkAiCfg && dkAiCfg.loai === loai && dkAiCfg.model) || DK_AI_MODEL[loai]);
    if (model === null) return;
    db.ref(DK_AI_PATH).set({ key, loai, model: model.trim() || DK_AI_MODEL[loai], by: (currentUser && currentUser.email) || '', at: new Date().toISOString() })
        .then(() => alert('🟢 Đã lưu khóa AI đọc ảnh.'))
        .catch(e => alert('❌ Không lưu được khóa: ' + e.message));
}

// Thu nhỏ ảnh (cạnh dài tối đa 1600px) -> JPEG base64
function dkAnhNen(file) {
    return new Promise((resolve, reject) => {
        let url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
            let tl = Math.min(1, 1600 / Math.max(img.width, img.height));
            let cv = document.createElement('canvas');
            cv.width = Math.round(img.width * tl); cv.height = Math.round(img.height * tl);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            URL.revokeObjectURL(url);
            resolve(cv.toDataURL('image/jpeg', 0.85).split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được tệp ảnh ' + file.name)); };
        img.src = url;
    });
}

function dkAiPrompt(cheDo, pids) {
    let dong = [];
    DK_NHOM.forEach(g => g.ds.forEach(p => { if (pids.has(p.id)) dong.push(`${p.id} | ${g.ten} | ${p.ten} | ${p.dv}`); }));
    let cachLay = cheDo === 'chuan'
        ? 'Lấy GIÁ TRỊ CÀI ĐẶT (set value) của từng thông số.'
        : 'Nhiệt độ: lấy GIÁ TRỊ THỰC TẾ (actual / PV) nếu màn hình hiện cả cài đặt và thực tế. Thời gian bắn keo, đệm keo, chu kỳ, thời gian lấy nhựa: lấy giá trị thực tế máy đo được (trang giám sát / monitor). Áp suất, tốc độ, vị trí: lấy giá trị cài đặt.';
    return `Bạn đọc ảnh chụp màn hình điều khiển (HMI) của máy ép nhựa Haitian. Có thể có nhiều ảnh là nhiều trang khác nhau: nhiệt độ, bắn keo (Injection), bảo áp (Holding), lấy nhựa (Charge), đóng/mở khuôn (Clamp), đẩy (Ejector), giám sát (Monitor). Màn hình có thể bằng tiếng Việt, tiếng Anh hoặc tiếng Trung.

Hãy trích các thông số trong danh sách dưới đây (mỗi dòng: id | nhóm | tên thông số | đơn vị):
${dong.join('\n')}

Quy tắc:
- Chỉ trả về số đọc được RÕ RÀNG trên ảnh. Không đoán, không suy ra. Thông số nào không thấy hoặc không chắc thì bỏ qua.
- ${cachLay}
- Vùng nhiệt: "Vòi phun" là vùng sát đầu phun (Nozzle); Vùng 1, 2, 3, 4 lần lượt đi từ phía vòi phun về phía phễu.
- Bắn keo cấp 1 đến 4 theo thứ tự máy thực hiện (cấp 1 là cấp bắn đầu tiên). Bảo áp 1, 2 và Lấy 1, 2 cũng theo thứ tự thực hiện.
- Giữ đúng đơn vị ghi trong danh sách. Nếu màn hình dùng đơn vị khác thì bỏ qua thông số đó và nêu trong "ghi_chu".

Trả về DUY NHẤT một đối tượng JSON, không kèm chữ nào khác:
{"gia_tri": {"<id>": <số>, ...}, "ghi_chu": "<ghi chú ngắn nếu có, hoặc chuỗi rỗng>"}`;
}

async function dkAiGoi(anh, cauHoi) {
    let cfg = dkAiCfg, text = '';
    if (cfg.loai === 'claude') {
        let r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: cfg.model || DK_AI_MODEL.claude, max_tokens: 4000,
                messages: [{ role: 'user', content: anh.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } })).concat([{ type: 'text', text: cauHoi }]) }]
            })
        });
        let j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j.error && j.error.message) || ('Claude API lỗi ' + r.status));
        text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    } else {
        let r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model || DK_AI_MODEL.gemini)}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
            body: JSON.stringify({
                contents: [{ parts: anh.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: d } })).concat([{ text: cauHoi }]) }],
                generationConfig: { responseMimeType: 'application/json' }
            })
        });
        let j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j.error && j.error.message) || ('Gemini API lỗi ' + r.status));
        text = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
    }
    let m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI không trả về dữ liệu đọc được.');
    let kq = JSON.parse(m[0]);
    return { giaTri: (kq && kq.gia_tri) || {}, ghiChu: (kq && kq.ghi_chu) || '' };
}

async function dkAiChonAnh(input, cheDo) {
    let files = [...(input.files || [])].slice(0, 6);
    input.value = '';
    if (!files.length || !checkAuthOrAlert()) return;
    if (!dkAiCfg || !dkAiCfg.key) { alert('⚠️ Chưa cài khóa API cho AI đọc ảnh. Bấm "⚙️ Khóa AI" để cài (làm 1 lần).'); dkAiCaiDat(); return; }
    let tt = document.getElementById('dkAiTrangThai_' + cheDo);
    let bao = (t, mau) => { if (tt) { tt.textContent = t; tt.style.color = mau || ''; } };
    let oNhap = [...document.querySelectorAll(cheDo === 'chuan' ? '#dkChuanModalBody .dk-c' : '#dkKiemModalBody .dk-v')];
    let pids = new Set(oNhap.map(i => i.dataset.pid));
    try {
        bao(`⏳ AI đang đọc ${files.length} ảnh...`);
        let anh = await Promise.all(files.map(dkAnhNen));
        let kq = await dkAiGoi(anh, dkAiPrompt(cheDo, pids));
        let n = 0;
        oNhap.forEach(i => {
            let v = dkSo(kq.giaTri[i.dataset.pid]);
            if (isNaN(v)) return;
            i.value = v; n++;
            i.style.outline = '2px solid #f59e0b';
            i.title = 'AI đọc từ ảnh – hãy đối chiếu lại';
            let nhom = i.closest('details'); if (nhom) nhom.open = true;
            if (cheDo === 'kiem') dkCapNhatDong(i);
        });
        bao(n ? `✅ AI đã điền ${n} thông số (ô viền vàng) – đối chiếu lại với màn hình máy trước khi lưu.` + (kq.ghiChu ? ' Ghi chú: ' + kq.ghiChu : '')
              : '⚠️ AI không đọc được thông số nào từ ảnh. ' + (kq.ghiChu || 'Chụp lại gần và rõ hơn.'), n ? '#10b981' : '#f59e0b');
    } catch (e) {
        console.warn('AI đọc ảnh lỗi:', e);
        bao('❌ AI đọc ảnh lỗi: ' + (e && e.message), '#ef4444');
    }
}
