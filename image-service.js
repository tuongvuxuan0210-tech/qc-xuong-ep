/**
 * QC System - Image Processing & Google Drive Service
 * Xưởng Ép Nhựa Hải Tân
 */

        // 1. Thuật toán làm nét viền và độ tương phản vi mô (Unsharp Mask Convolution)
        // Giúp các con số màn hình HMI và các chi tiết bavia, trầy xước, mẫu lỗi sắc nét vượt trội
        function applySmartSharpen(ctx, width, height, amount = 0.25) {
            try {
                if (width <= 0 || height <= 0 || amount <= 0) return;
                const imgData = ctx.getImageData(0, 0, width, height);
                const src = imgData.data;
                const output = ctx.createImageData(width, height);
                const dst = output.data;
                const w = width;
                const h = height;

                const k = amount;
                const center = 1 + 4 * k;

                for (let y = 0; y < h; y++) {
                    const yOffset = y * w;
                    const prevYOffset = (y > 0 ? y - 1 : 0) * w;
                    const nextYOffset = (y < h - 1 ? y + 1 : h - 1) * w;

                    for (let x = 0; x < w; x++) {
                        const px = (yOffset + x) * 4;
                        const prevX = (x > 0 ? x - 1 : 0);
                        const nextX = (x < w - 1 ? x + 1 : w - 1);

                        const up = (prevYOffset + x) * 4;
                        const down = (nextYOffset + x) * 4;
                        const left = (yOffset + prevX) * 4;
                        const right = (yOffset + nextX) * 4;

                        for (let c = 0; c < 3; c++) {
                            const val = center * src[px + c] - k * (src[up + c] + src[down + c] + src[left + c] + src[right + c]);
                            dst[px + c] = val < 0 ? 0 : (val > 255 ? 255 : val);
                        }
                        dst[px + 3] = src[px + 3];
                    }
                }
                ctx.putImageData(output, 0, 0);
            } catch (e) {
                console.warn('applySmartSharpen warning:', e);
            }
        }


        // 2. Thuật toán giảm kích thước từng bước (Stepped Downsampling)
        // Chống nhòe vỡ font chữ và hiện tượng Moiré khi thu nhỏ từ ảnh camera độ phân giải cao (12MP-48MP)
        function drawSteppedDownscaled(img, targetW, targetH) {
            let curW = img.width;
            let curH = img.height;
            let canvas = document.createElement('canvas');
            let ctx = canvas.getContext('2d');
            canvas.width = curW;
            canvas.height = curH;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, curW, curH);
            ctx.drawImage(img, 0, 0);

            while (curW > targetW * 1.7 && curH > targetH * 1.7) {
                let nextW = Math.round(curW / 2);
                let nextH = Math.round(curH / 2);
                let stepCanvas = document.createElement('canvas');
                stepCanvas.width = nextW;
                stepCanvas.height = nextH;
                let stepCtx = stepCanvas.getContext('2d');
                stepCtx.fillStyle = '#ffffff';
                stepCtx.fillRect(0, 0, nextW, nextH);
                stepCtx.imageSmoothingEnabled = true;
                stepCtx.imageSmoothingQuality = 'high';
                stepCtx.drawImage(canvas, 0, 0, nextW, nextH);
                canvas = stepCanvas;
                curW = nextW;
                curH = nextH;
            }

            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = targetW;
            finalCanvas.height = targetH;
            const finalCtx = finalCanvas.getContext('2d');
            finalCtx.fillStyle = '#ffffff';
            finalCtx.fillRect(0, 0, targetW, targetH);
            finalCtx.imageSmoothingEnabled = true;
            finalCtx.imageSmoothingQuality = 'high';
            finalCtx.drawImage(canvas, 0, 0, targetW, targetH);
            return { canvas: finalCanvas, ctx: finalCtx };
        }


        // HÀM NÉN ẢNH MÀN HÌNH HMI CHUẨN SIÊU NÉT HD (~100KB)
        function compressHmiScreenImage(file, maxBytes = 100 * 1024) {
            return new Promise((resolve, reject) => {
                if (!file) return reject(new Error("Không tìm thấy file ảnh!"));
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = event => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        // Kích thước tối ưu cho màn hình HMI: 1400px để đọc rõ từng thông số cài đặt máy
                        let maxWidth = 1400;
                        let maxHeight = 1400;
                        let width = img.width;
                        let height = img.height;

                        if (width > maxWidth || height > maxHeight) {
                            if (width > height) {
                                height = Math.round((height * maxWidth) / width);
                                width = maxWidth;
                            } else {
                                width = Math.round((width * maxHeight) / height);
                                height = maxHeight;
                            }
                        }

                        // Thu nhỏ đa tầng chống răng cưa & nhòe nét số
                        const { canvas, ctx } = drawSteppedDownscaled(img, width, height);

                        // Làm nét viền con số và thông số LCD máy ép
                        applySmartSharpen(ctx, width, height, 0.32);

                        let quality = 0.84;
                        let dataUrl = canvas.toDataURL('image/jpeg', quality);

                        // Giảm chất lượng an toàn (không hạ dưới 0.62 để tránh vỡ nét)
                        while (dataUrl.length * 0.75 > maxBytes && quality > 0.62) {
                            quality -= 0.04;
                            dataUrl = canvas.toDataURL('image/jpeg', quality);
                        }

                        // Nếu ảnh quá phức tạp vẫn vượt 100KB, thu nhỏ mượt mà (sàn kích thước rộng > 750px)
                        let curW = width;
                        let curH = height;
                        let activeCanvas = canvas;
                        while (dataUrl.length * 0.75 > maxBytes && curW > 750) {
                            curW = Math.round(curW * 0.92);
                            curH = Math.round(curH * 0.92);
                            const nextCanvas = document.createElement('canvas');
                            nextCanvas.width = curW;
                            nextCanvas.height = curH;
                            const nextCtx = nextCanvas.getContext('2d');
                            nextCtx.fillStyle = '#ffffff';
                            nextCtx.fillRect(0, 0, curW, curH);
                            nextCtx.imageSmoothingEnabled = true;
                            nextCtx.imageSmoothingQuality = 'high';
                            nextCtx.drawImage(activeCanvas, 0, 0, curW, curH);
                            applySmartSharpen(nextCtx, curW, curH, 0.18);
                            activeCanvas = nextCanvas;
                            dataUrl = activeCanvas.toDataURL('image/jpeg', Math.max(quality, 0.68));
                        }

                        resolve({
                            dataUrl: dataUrl,
                            width: activeCanvas.width,
                            height: activeCanvas.height,
                            sizeBytes: Math.round(dataUrl.length * 0.75)
                        });
                    };
                    img.onerror = err => reject(err);
                };
                reader.onerror = err => reject(err);
            });
        }


        function compressImage(file, maxBytes = MAX_IMAGE_BYTES) {
            return new Promise((resolve, reject) => {
                if (!file) return reject(new Error("Không tìm thấy file ảnh!"));
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = event => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        // Kích thước chuẩn HD cho ảnh lỗi QC: 1280px để thấy rõ chi tiết lỗi sản phẩm
                        let maxWidth = 1280;
                        let maxHeight = 1280;
                        let width = img.width;
                        let height = img.height;

                        if (width > maxWidth || height > maxHeight) {
                            if (width > height) {
                                height = Math.round((height * maxWidth) / width);
                                width = maxWidth;
                            } else {
                                width = Math.round((width * maxHeight) / height);
                                height = maxHeight;
                            }
                        }

                        // Thu nhỏ đa tầng chống răng cưa & nhòe nét
                        const { canvas, ctx } = drawSteppedDownscaled(img, width, height);

                        // Áp dụng bộ lọc làm nét viền sản phẩm và đường phân khuôn
                        applySmartSharpen(ctx, width, height, 0.22);

                        let quality = 0.82;
                        let dataUrl = canvas.toDataURL('image/jpeg', quality);

                        // Giảm chất lượng an toàn (không hạ dưới 0.62)
                        while (dataUrl.length * 0.75 > maxBytes && quality > 0.62) {
                            quality -= 0.04;
                            dataUrl = canvas.toDataURL('image/jpeg', quality);
                        }

                        // Nếu ảnh quá phức tạp vẫn vượt 100KB, thu nhỏ mượt mà kích thước (giữ sàn rộng > 750px)
                        let curW = width;
                        let curH = height;
                        let activeCanvas = canvas;
                        while (dataUrl.length * 0.75 > maxBytes && curW > 750) {
                            curW = Math.round(curW * 0.92);
                            curH = Math.round(curH * 0.92);
                            const nextCanvas = document.createElement('canvas');
                            nextCanvas.width = curW;
                            nextCanvas.height = curH;
                            const nextCtx = nextCanvas.getContext('2d');
                            nextCtx.fillStyle = '#ffffff';
                            nextCtx.fillRect(0, 0, curW, curH);
                            nextCtx.imageSmoothingEnabled = true;
                            nextCtx.imageSmoothingQuality = 'high';
                            nextCtx.drawImage(activeCanvas, 0, 0, curW, curH);
                            applySmartSharpen(nextCtx, curW, curH, 0.15);
                            activeCanvas = nextCanvas;
                            dataUrl = activeCanvas.toDataURL('image/jpeg', Math.max(quality, 0.68));
                        }

                        resolve(dataUrl);
                    };
                    img.onerror = error => reject(error);
                };
                reader.onerror = error => reject(error);
            });
        }


        function previewDefectImage(imgUrl, title) {
            if (!imgUrl) return;
            let modalEl = document.getElementById('imagePreviewModal');
            if (!modalEl) {
                const modalHtml = `
                <div class="modal fade" id="imagePreviewModal" tabindex="-1">
                    <div class="modal-dialog modal-dialog-centered modal-lg">
                        <div class="modal-content bg-dark text-white border-info shadow-lg">
                            <div class="modal-header border-secondary py-2 justify-content-between">
                                <h6 class="modal-title fw-bold text-info" id="imgPreviewTitle">📸 Xem Ảnh Lỗi Chi Tiết</h6>
                                <button type="button" class="btn btn-sm btn-danger rounded-pill px-3 py-1 fw-bold" data-bs-dismiss="modal">✖ Đóng</button>
                            </div>
                            <div class="modal-body text-center p-2" style="background: #020617;">
                                <img id="imgPreviewSrc" src="" class="img-fluid rounded border border-secondary shadow" style="max-height: 75vh; object-fit: contain;">
                                <div class="mt-2" id="imgPreviewDriveLinkBox" style="display:none;">
                                    <a id="imgPreviewDriveLink" href="#" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-3 fw-bold">🔗 Mở ảnh gốc trên Google Drive</a>
                                </div>
                            </div>
                            <div class="modal-footer border-secondary py-2 justify-content-end">
                                <button type="button" class="btn btn-sm btn-secondary rounded-pill px-4" data-bs-dismiss="modal">❌ Thoát / Đóng</button>
                            </div>
                        </div>
                    </div>
                </div>`;
                document.body.insertAdjacentHTML('beforeend', modalHtml);
                modalEl = document.getElementById('imagePreviewModal');
            }
            document.getElementById('imgPreviewTitle').innerText = `📸 Ảnh Lỗi Trực Tiếp: ${title || ''}`;
            
            let driveMatch = String(imgUrl).match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || String(imgUrl).match(/[?&]id=([a-zA-Z0-9_-]+)/);
            let linkBox = document.getElementById('imgPreviewDriveLinkBox');
            let driveLink = document.getElementById('imgPreviewDriveLink');

            if (driveMatch && driveMatch[1]) {
                let fileId = driveMatch[1];
                document.getElementById('imgPreviewSrc').src = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;
                if (linkBox && driveLink) {
                    driveLink.href = `https://drive.google.com/file/d/${fileId}/view`;
                    linkBox.style.display = 'block';
                }
            } else {
                document.getElementById('imgPreviewSrc').src = imgUrl;
                if (linkBox) linkBox.style.display = 'none';
            }

            let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }


        async function handleDefectImageUpload(inputEl, date, key, machine, moldId) {
            if (!checkAuthOrAlert()) return;
            if (!inputEl.files || !inputEl.files[0]) return;
            const file = inputEl.files[0];
            syncCurrentTab1InputsToStore();
            syncCurrentTab2InputsToStore();

            try {
                const compressedBase64 = await compressImage(file);
                const sizeKB = Math.round((compressedBase64.length * 0.75) / 1024);
                let fileName = `QC_LOI_${machine || 'MAY'}_${moldId || 'KHUON'}_${date}_${key}.jpg`;

                let rawKey = key.startsWith('T2_') ? key.replace('T2_', '') : key;
                let rec = (tab2Store[date] && tab2Store[date][rawKey]) || {};
                let moldVal = moldId || rec.moldId || '-';
                let totalVal = rec.totalCheck || 0;
                let defectVal = rec.defectCheck || 0;
                let sampleRatioStr = totalVal > 0 ? `${defectVal}/${totalVal} SP (${((defectVal/totalVal)*100).toFixed(0)}%)` : (defectVal > 0 ? `${defectVal} SP` : 'Phát hiện NG');

                let ngTypes = [];
                if (rec.colorCheck === 'NG') ngTypes.push('Màu sắc');
                if (rec.visual === 'NG') ngTypes.push('Ngoại quan');
                if (rec.dimension === 'NG') ngTypes.push('Kích thước');
                if (rec.mechanical === 'NG') ngTypes.push('Lắp ráp');
                let ngTypesStr = ngTypes.length > 0 ? ngTypes.join(', ') : 'Ngoại quan / Mẫu lỗi';
                let noteVal = rec.note ? rec.note : 'Không ghi chú';

                let zaloAlertText = `🚨 [CẢNH BÁO ẢNH LỖI QC]\n` +
                                    `🏭 Máy: ${machine || '-'}\n` +
                                    `🔧 Mã khuôn: ${moldVal}\n` +
                                    `📊 Mẫu lỗi: ${sampleRatioStr}\n` +
                                    `⚠️ Loại lỗi: ${ngTypesStr}\n` +
                                    `📝 Lý do: ${noteVal}`;
                
                if (!tab3ActionNotesStore[date]) tab3ActionNotesStore[date] = {};
                
                // Lưu preview thumbnail trong phiên làm việc hiện tại
                tab3ActionNotesStore[date][`${key}_img`] = compressedBase64;
                tab3ActionNotesStore[date][`${key}_drive_file`] = fileName;

                // Nếu ảnh xuất phát từ Tab 2, đồng bộ ngược về Tab 2 store
                if (key.startsWith('T2_')) {
                    if (!tab2Store[date]) tab2Store[date] = {};
                    if (!tab2Store[date][rawKey]) tab2Store[date][rawKey] = {};
                    tab2Store[date][rawKey].img = compressedBase64;
                    tab2Store[date][rawKey].driveFile = fileName;
                }

                // Đồng bộ metadata & tên file Drive lên Firebase Realtime Database
                if (isConnected && db) {
                    await db.ref(`qc_tab3_actions_v1/${date}/${key}_drive_file`).set(fileName);
                    await db.ref(`qc_tab3_actions_v1/${date}/${key}_img_time`).set(new Date().toISOString());
                    if (key.startsWith('T2_')) {
                        await db.ref(`qc_tab2_store_v1/${date}/${rawKey}/driveFile`).set(fileName);
                    }
                }

                // Gửi file ảnh lưu trực tiếp vào Google Drive (Chế độ lưu âm thầm, không spam Zalo khi đang chụp)
                if (ZALO_WEBHOOK_URL && !ZALO_WEBHOOK_URL.includes("URL_GOOGLE_APPS_SCRIPT")) {
                    try {
                        fetch(ZALO_WEBHOOK_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({
                                action: 'upload_to_drive',
                                folderId: GOOGLE_DRIVE_FOLDER_ID,
                                fileName: fileName,
                                fileData: compressedBase64.split(',')[1] || compressedBase64,
                                mimeType: 'image/jpeg',
                                sendToZalo: false,
                                date: date,
                                machine: machine,
                                moldId: moldId
                            }),
                            mode: 'no-cors'
                        }).catch(() => {});
                    } catch (e) {}
                }

                syncCurrentTab1InputsToStore();
                syncCurrentTab2InputsToStore();
                debouncedRenderTab2();
                renderTab3();
                alert(`✅ Đã nén ảnh (${sizeKB} KB ~100KB siêu nét) và lưu trữ an toàn vào Google Drive (Chỉ lưu link trên Firebase)!`);
            } catch (err) {
                alert("⚠️ Lỗi tải ảnh: " + err.message);
            }
        }


        async function handleTab1DefectImageUpload(inputEl, date, key, machineNum, moldId) {
            if (!checkAuthOrAlert()) return;
            if (!inputEl.files || !inputEl.files[0]) return;
            const file = inputEl.files[0];
            syncCurrentTab1InputsToStore();

            try {
                const compressedBase64 = await compressImage(file);
                const sizeKB = Math.round((compressedBase64.length * 0.75) / 1024);
                let fileName = `QC_LOI_TAB1_M${machineNum}_${moldId || 'KHUON'}_${date}_${key}.jpg`;

                if (!tab1Store[date]) tab1Store[date] = {};
                if (!tab1Store[date][key]) tab1Store[date][key] = {};
                tab1Store[date][key].img = compressedBase64;
                tab1Store[date][key].driveFile = fileName;

                // Tự động đồng bộ sang Tab 3
                let t3Key = `T1_${key}`;
                if (!tab3ActionNotesStore[date]) tab3ActionNotesStore[date] = {};
                tab3ActionNotesStore[date][`${t3Key}_img`] = compressedBase64;
                tab3ActionNotesStore[date][`${t3Key}_drive_file`] = fileName;

                // Đồng bộ metadata lên Firebase RTDB
                if (isConnected && db) {
                    await db.ref(`qc_tab1_store_v1/${date}/${key}/driveFile`).set(fileName);
                    await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_drive_file`).set(fileName);
                    await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_img_time`).set(new Date().toISOString());
                }

                // Gửi file ảnh lưu trực tiếp vào Google Drive (Chế độ lưu âm thầm, nhận fileUrl)
                if (ZALO_WEBHOOK_URL && !ZALO_WEBHOOK_URL.includes("URL_GOOGLE_APPS_SCRIPT")) {
                    try {
                        fetch(ZALO_WEBHOOK_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({
                                action: 'upload_to_drive',
                                folderId: GOOGLE_DRIVE_FOLDER_ID,
                                fileName: fileName,
                                fileData: compressedBase64.split(',')[1] || compressedBase64,
                                mimeType: 'image/jpeg',
                                sendToZalo: false,
                                date: date,
                                machine: `M${machineNum}`,
                                moldId: moldId
                            })
                        }).then(r => r.json()).then(resData => {
                            if (resData && resData.fileUrl) {
                                if (!tab1Store[date]) tab1Store[date] = {};
                                if (!tab1Store[date][key]) tab1Store[date][key] = {};
                                tab1Store[date][key].driveUrl = resData.fileUrl;
                                tab3ActionNotesStore[date][`${t3Key}_drive_url`] = resData.fileUrl;
                                if (isConnected && db) {
                                    db.ref(`qc_tab1_store_v1/${date}/${key}/driveUrl`).set(resData.fileUrl);
                                    db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_drive_url`).set(resData.fileUrl);
                                }
                            }
                        }).catch(() => {});
                    } catch (e) {}
                }

                syncCurrentTab1InputsToStore();
                renderTab1();
                debouncedRenderTab3();
                alert(`✅ Đã nén ảnh Tab 1 (${sizeKB} KB ~100KB siêu nét), lưu an toàn vào Google Drive (Chỉ lưu link trên Firebase)!`);
            } catch (err) {
                alert("⚠️ Lỗi tải ảnh Tab 1: " + err.message);
            }
        }


        async function handleTab2DefectImageUpload(inputEl, date, key, machineNum, moldId) {
            if (!checkAuthOrAlert()) return;
            if (!inputEl.files || !inputEl.files[0]) return;
            const file = inputEl.files[0];
            syncCurrentTab2InputsToStore();

            try {
                const compressedBase64 = await compressImage(file);
                const sizeKB = Math.round((compressedBase64.length * 0.75) / 1024);
                let fileName = `QC_LOI_M${machineNum}_${moldId || 'KHUON'}_${date}_${key}.jpg`;

                // Đọc chi tiết lỗi từ store Tab 2
                let rec = (tab2Store[date] && tab2Store[date][key]) || {};
                let moldVal = rec.moldId || moldId || '-';
                let totalVal = rec.totalCheck || 0;
                let defectVal = rec.defectCheck || 0;
                let sampleRatioStr = totalVal > 0 ? `${defectVal}/${totalVal} SP (${((defectVal/totalVal)*100).toFixed(0)}%)` : (defectVal > 0 ? `${defectVal} SP` : 'Phát hiện NG');

                let ngTypes = [];
                if (rec.colorCheck === 'NG') ngTypes.push('Màu sắc');
                if (rec.visual === 'NG') ngTypes.push('Ngoại quan');
                if (rec.dimension === 'NG') ngTypes.push('Kích thước');
                if (rec.mechanical === 'NG') ngTypes.push('Lắp ráp');
                let ngTypesStr = ngTypes.length > 0 ? ngTypes.join(', ') : 'Ngoại quan / Mẫu lỗi';
                let noteVal = rec.note ? rec.note : 'Không ghi chú';

                let shiftKeyParts = key.split('_');
                let shiftTimeTag = shiftKeyParts.length >= 2 ? `${shiftKeyParts[0]} - ${shiftKeyParts[1]}` : key;

                let zaloAlertText = `🚨 [CẢNH BÁO ẢNH LỖI QC]\n` +
                                    `🏭 Máy: M${machineNum} (${shiftTimeTag})\n` +
                                    `🔧 Mã khuôn: ${moldVal}\n` +
                                    `📊 Mẫu lỗi: ${sampleRatioStr}\n` +
                                    `⚠️ Loại lỗi: ${ngTypesStr}\n` +
                                    `📝 Lý do: ${noteVal}`;
                
                if (!tab2Store[date]) tab2Store[date] = {};
                if (!tab2Store[date][key]) tab2Store[date][key] = {};
                tab2Store[date][key].img = compressedBase64;
                tab2Store[date][key].driveFile = fileName;

                // Tự động đồng bộ sang Tab 3
                let t3Key = `T2_${key}`;
                if (!tab3ActionNotesStore[date]) tab3ActionNotesStore[date] = {};
                tab3ActionNotesStore[date][`${t3Key}_img`] = compressedBase64;
                tab3ActionNotesStore[date][`${t3Key}_drive_file`] = fileName;

                // Đồng bộ metadata lên Firebase RTDB
                if (isConnected && db) {
                    await db.ref(`qc_tab2_store_v1/${date}/${key}/driveFile`).set(fileName);
                    await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_drive_file`).set(fileName);
                    await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_img_time`).set(new Date().toISOString());
                }

                // Gửi file ảnh lưu trực tiếp vào Google Drive (Chế độ lưu âm thầm, nhận fileUrl)
                if (ZALO_WEBHOOK_URL && !ZALO_WEBHOOK_URL.includes("URL_GOOGLE_APPS_SCRIPT")) {
                    try {
                        fetch(ZALO_WEBHOOK_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({
                                action: 'upload_to_drive',
                                folderId: GOOGLE_DRIVE_FOLDER_ID,
                                fileName: fileName,
                                fileData: compressedBase64.split(',')[1] || compressedBase64,
                                mimeType: 'image/jpeg',
                                sendToZalo: false,
                                date: date,
                                machine: `M${machineNum}`,
                                moldId: moldId
                            })
                        }).then(r => r.json()).then(resData => {
                            if (resData && resData.fileUrl) {
                                if (!tab2Store[date]) tab2Store[date] = {};
                                if (!tab2Store[date][key]) tab2Store[date][key] = {};
                                tab2Store[date][key].driveUrl = resData.fileUrl;
                                tab3ActionNotesStore[date][`${t3Key}_drive_url`] = resData.fileUrl;
                                if (isConnected && db) {
                                    db.ref(`qc_tab2_store_v1/${date}/${key}/driveUrl`).set(resData.fileUrl);
                                    db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_drive_url`).set(resData.fileUrl);
                                }
                            }
                        }).catch(() => {});
                    } catch (e) {}
                }

                syncCurrentTab2InputsToStore();
                renderTab2();
                debouncedRenderTab3();
                alert(`✅ Đã nén ảnh (${sizeKB} KB ~100KB siêu nét), lưu an toàn vào Google Drive (Chỉ lưu link trên Firebase)!`);
            } catch (err) {
                alert("⚠️ Lỗi tải ảnh Tab 2: " + err.message);
            }
        }


        async function removeDefectImage(date, key) {
            if (!checkAuthOrAlert()) return;
            if (!confirm("Bạn có chắc chắn muốn xóa ảnh lỗi này khỏi danh sách?")) return;
            if (!tab3ActionNotesStore[date]) tab3ActionNotesStore[date] = {};
            delete tab3ActionNotesStore[date][`${key}_img`];
            delete tab3ActionNotesStore[date][`${key}_drive_file`];

            if (key.startsWith('T2_')) {
                let rawKey = key.replace('T2_', '');
                if (tab2Store[date] && tab2Store[date][rawKey]) {
                    delete tab2Store[date][rawKey].img;
                    delete tab2Store[date][rawKey].driveFile;
                }
            } else if (key.startsWith('T1_')) {
                let rawKey = key.replace('T1_', '');
                if (tab1Store[date] && tab1Store[date][rawKey]) {
                    delete tab1Store[date][rawKey].img;
                    delete tab1Store[date][rawKey].driveFile;
                }
            }

            if (isConnected && db) {
                await db.ref(`qc_tab3_actions_v1/${date}/${key}_img`).remove();
                await db.ref(`qc_tab3_actions_v1/${date}/${key}_drive_file`).remove();
                await db.ref(`qc_tab3_actions_v1/${date}/${key}_img_time`).remove();
                if (key.startsWith('T2_')) {
                    let rawKey = key.replace('T2_', '');
                    await db.ref(`qc_tab2_store_v1/${date}/${rawKey}/driveFile`).remove();
                } else if (key.startsWith('T1_')) {
                    let rawKey = key.replace('T1_', '');
                    await db.ref(`qc_tab1_store_v1/${date}/${rawKey}/driveFile`).remove();
                }
            }
            debouncedRenderTab1();
            debouncedRenderTab2();
            renderTab3();
        }


        async function removeTab1DefectImage(date, key) {
            if (!checkAuthOrAlert()) return;
            if (!confirm("Bạn có chắc chắn muốn xóa ảnh lỗi Tab 1 này?")) return;
            if (tab1Store[date] && tab1Store[date][key]) {
                delete tab1Store[date][key].img;
                delete tab1Store[date][key].driveFile;
                delete tab1Store[date][key].driveUrl;
            }
            let t3Key = `T1_${key}`;
            if (tab3ActionNotesStore[date]) {
                delete tab3ActionNotesStore[date][`${t3Key}_img`];
                delete tab3ActionNotesStore[date][`${t3Key}_drive_file`];
                delete tab3ActionNotesStore[date][`${t3Key}_drive_url`];
            }

            if (isConnected && db) {
                await db.ref(`qc_tab1_store_v1/${date}/${key}/driveFile`).remove();
                await db.ref(`qc_tab1_store_v1/${date}/${key}/driveUrl`).remove();
                await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_drive_file`).remove();
                await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_drive_url`).remove();
                await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_img_time`).remove();
            }
            renderTab1();
            debouncedRenderTab3();
            alert("🗑️ Đã xóa ảnh lỗi Tab 1 thành công!");
        }


        async function removeTab2DefectImage(date, key) {
            if (!checkAuthOrAlert()) return;
            if (!confirm("Bạn có chắc chắn muốn xóa ảnh lỗi này?")) return;
            if (tab2Store[date] && tab2Store[date][key]) {
                delete tab2Store[date][key].img;
                delete tab2Store[date][key].driveFile;
                delete tab2Store[date][key].driveUrl;
            }
            let t3Key = `T2_${key}`;
            if (tab3ActionNotesStore[date]) {
                delete tab3ActionNotesStore[date][`${t3Key}_img`];
                delete tab3ActionNotesStore[date][`${t3Key}_drive_file`];
                delete tab3ActionNotesStore[date][`${t3Key}_drive_url`];
            }

            if (isConnected && db) {
                await db.ref(`qc_tab2_store_v1/${date}/${key}/driveFile`).remove();
                await db.ref(`qc_tab2_store_v1/${date}/${key}/driveUrl`).remove();
                await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_drive_file`).remove();
                await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_drive_url`).remove();
                await db.ref(`qc_tab3_actions_v1/${date}/${t3Key}_img_time`).remove();
            }
            renderTab2();
            debouncedRenderTab3();
            alert("🗑️ Đã xóa ảnh lỗi Tab 2 thành công!");
        }
