/**
 * QC System - Zalo & Webhook Service
 * Xưởng Ép Nhựa Hải Tân
 */

        function configZaloWebhook() {
            let currentUrl = ZALO_WEBHOOK_URL;
            let newUrl = prompt("Nhập Webhook URL Google Apps Script xử lý Google Drive & Zalo:", currentUrl);
            if (newUrl !== null && newUrl.trim() !== "") {
                ZALO_WEBHOOK_URL = newUrl.trim();
                localStorage.setItem('qc_zalo_webhook_url', ZALO_WEBHOOK_URL);

                if (isConnected && db) {
                    db.ref('system_config/zalo_webhook_url').set(ZALO_WEBHOOK_URL);
                }
                alert("🟢 Đã lưu Webhook URL mới thành công!");
            }
        }


        async function testGoogleDriveConnection() {
            let webhookUrl = ZALO_WEBHOOK_URL;
            if (!webhookUrl || webhookUrl.includes("URL_GOOGLE_APPS_SCRIPT")) {
                alert("⚠️ Vui lòng cấu hình Webhook URL Google Apps Script trước!");
                configZaloWebhook();
                return;
            }
            
            try {
                let testBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
                let testFileName = "TEST_KET_NOI_" + new Date().getTime() + ".jpg";
                
                alert("⏳ Đang gửi file ảnh test lên Google Drive qua Webhook...\nBấm OK để bắt đầu.");
                
                fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'upload_to_drive',
                        folderId: GOOGLE_DRIVE_FOLDER_ID,
                        fileName: testFileName,
                        fileData: testBase64,
                        mimeType: 'image/jpeg',
                        sendToZalo: false
                    }),
                    mode: 'no-cors'
                });

                alert("🟢 Đã gửi yêu cầu lưu file vào Google Drive!\nNếu sau 10 giây Drive vẫn chưa có file, nguyên nhân là Google Apps Script chưa được CẤP QUYỀN (Authorize) hoặc chưa chọn 'Triển khai mới' (New Deployment) quyền 'Bất kỳ ai'.");
            } catch (err) {
                alert("❌ Lỗi: " + err.message);
            }
        }


        async function sendZaloAlert(message, date) {
            if (!ZALO_WEBHOOK_URL || ZALO_WEBHOOK_URL.includes("URL_GOOGLE_APPS_SCRIPT")) return false;
            let targetDate = date || document.getElementById('tab2Date')?.value || getTodayISO();
            try {
                await fetch(ZALO_WEBHOOK_URL, {
                    method: "POST", mode: "no-cors",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({ message: message, text: message, date: targetDate })
                });
                return true;
            } catch (e) {
                console.error("Lỗi gửi Zalo:", e);
                return false;
            }
        }


        async function triggerCurrentSlotZaloReport() {
            let date = document.getElementById('tab2Date').value || getTodayISO();
            let now = new Date();
            let hh = String(now.getHours()).padStart(2, '0');
            let mm = String(now.getMinutes()).padStart(2, '0');
            let currentShift = (now.getHours() >= 7 && now.getHours() < 19) ? 'Ca Ngày' : 'Ca Đêm';
            let slots = currentShift === 'Ca Ngày' ? QC_SLOTS_DAY : QC_SLOTS_NIGHT;

            // Find closest slot
            let currMin = now.getHours() * 60 + now.getMinutes();
            let closestSlot = slots[0];
            let minDiff = 9999;
            slots.forEach(s => {
                let [sh, sm] = s.split(':').map(Number);
                let sMin = sh * 60 + sm;
                let diff = Math.abs(currMin - sMin);
                if (diff < minDiff) { minDiff = diff; closestSlot = s; }
            });

            if (!confirm(`Phát báo cáo tổng hợp Zalo cho ${currentShift} - Khung giờ ${closestSlot} (Ngày ${date})?`)) return;

            let dayData = tab2Store[date] || {};
            let totalChecked = 0, totalDefects = 0, ngItems = [], checkedCount = 0;

            for (let m = 1; m <= TOTAL_MACHINES; m++) {
                let slotKey = `M${m}_${currentShift}_${closestSlot}`;
                let rec = dayData[slotKey];
                if (rec && rec.moldId) {
                    checkedCount++;
                    let t = parseInt(rec.totalCheck) || 0;
                    let d = parseInt(rec.defectCheck) || 0;
                    totalChecked += t; totalDefects += d;
                    let isNG = (rec.overall === 'NG' || rec.colorCheck === 'NG' || rec.visual === 'NG' || rec.dimension === 'NG' || rec.mechanical === 'NG');
                    if (isNG) {
                        ngItems.push(`  • M${m} (Khuôn ${rec.moldId}): Lỗi ${d}/${t} SP. ĐG: ${rec.overall}. Ghi chú: ${rec.note || 'Không'}`);
                    }
                }
            }

            let msg = `📊 [BÁO CÁO QC XƯỞNG ÉP - ${currentShift.toUpperCase()}]\n📅 Ngày: ${date} | Khung: ${closestSlot}\n📈 Đã kiểm: ${checkedCount}/${TOTAL_MACHINES} máy | Tổng SP: ${totalChecked} | Lỗi: ${totalDefects} SP`;
            if (ngItems.length > 0) {
                msg += `\n🚨 CẢNH BÁO LỖI (NG):\n` + ngItems.join('\n');
            } else {
                msg += `\n✅ Trạng thái: Các máy kiểm tra đều ĐẠT OK.`;
            }

            let res = await sendZaloAlert(msg);
            if (res !== false) alert("✅ Đã phát báo cáo khung giờ lên Zalo thành công!");
        }


        async function testZaloAlert() {
            if (!ZALO_WEBHOOK_URL || ZALO_WEBHOOK_URL.includes("URL_GOOGLE_APPS_SCRIPT")) {
                configZaloWebhook(); return;
            }
            let now = new Date();
            let timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            let testMsg = `🧪 [KIỂM TRA HỆ THỐNG QC XƯỞNG ÉP]\n⏱️ Thời gian: ${timeStr}\n🟢 Kết nối Webhook Zalo đang hoạt động tốt!`;
            let res = await sendZaloAlert(testMsg);
            if (res !== false) alert("🚀 Lệnh gửi thử đã được phát đi! Vui lòng kiểm tra Zalo.");
        }


        function openGoogleDriveFolderModal() {
            let modalEl = document.getElementById('googleDriveFolderModal');
            if (modalEl) {
                let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                modal.show();
            }
        }


        function configDriveWebhook() {
            let currentUrl = ZALO_WEBHOOK_URL;
            let newUrl = prompt("Nhập Webhook URL Google Apps Script xử lý Google Drive (mặc định chung với Zalo):", currentUrl);
            if (newUrl !== null && newUrl.trim() !== "") {
                ZALO_WEBHOOK_URL = newUrl.trim();
                localStorage.setItem('qc_zalo_webhook_url', ZALO_WEBHOOK_URL);
                if (isConnected && db) db.ref('system_config/zalo_webhook_url').set(ZALO_WEBHOOK_URL);
                alert("🟢 Đã lưu Webhook thành công!");
            }
        }
