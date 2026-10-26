/**
 * QC System - Excel Export & JSON Database Backup/Restore
 * Xưởng Ép Nhựa Hải Tân
 */

        function exportTab3Excel() {
            // Xuất kèm đối sách 4M + tình trạng lần đầu / lặp lại
            qcXuatExcelDoiSach();
        }


        function exportTab1Excel() {
            let date = document.getElementById('tab1Date').value, dayData = tab1Store[date];
            if (!dayData) { alert("Chưa có dữ liệu Tab 1!"); return; }
            let rows = [];
            for (let m = 1; m <= TOTAL_MACHINES; m++) {
                ['Ca Ngày', 'Ca Đêm'].forEach(shift => {
                    let shiftInspector = getShiftInspector(dayData, shift, m);
                    let k = `M${m}_${shift}`;
                    let r = dayData[k] || dayData[`${k}_Đầu ca`] || dayData[`${k}_Cuối ca`] || {};
                    let xFactor = m <= 10 ? 'Xưởng 2' : 'Xưởng 1';
                    rows.push({
                        "Phân Xưởng": xFactor,
                        "Máy": `M${m}`,
                        "Ca": shift,
                        "QC Ca": shiftInspector,
                        "Mã Khuôn": r.moldId || '',
                        "KT Khuôn": r.moldCheckOverall || 'OK',
                        "Loại Nhựa": r.resinType || 'PP',
                        "Màu Nhựa": r.resinColor || 'Trắng',
                        "Chu Kỳ Deco (s)": r.decoCycle || 30,
                        "Chu Kỳ Máy (s)": r.machineCycle || 30,
                        "KQ": r.result || 'OK',
                        "Ghi Chú Lỗi": r.note || ''
                    });
                });
            }
            let ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Tab1"); XLSX.writeFile(wb, `MES_QC_Tab1_${date}.xlsx`);
        }


        function exportTab2Excel() {
            let date = document.getElementById('tab2Date').value, dayData = tab2Store[date];
            if (!dayData) { alert("Chưa có dữ liệu Tab 2!"); return; }
            let rows = [];

            let startM = 1, endM = TOTAL_MACHINES;
            if (tab2WorkshopFilter === 'XUONG1') { startM = 1; endM = 10; }
            else if (tab2WorkshopFilter === 'XUONG2') { startM = 11; endM = 21; }

            let visibleShifts = ['Ca Ngày', 'Ca Đêm'];
            if (tab2ShiftFilter === 'NGAY') visibleShifts = ['Ca Ngày'];
            else if (tab2ShiftFilter === 'DEM') visibleShifts = ['Ca Đêm'];

            for (let m = startM; m <= endM; m++) {
                visibleShifts.forEach(shift => {
                    let shiftInspector = getShiftInspector(dayData, shift, m);
                    let allSlots = shift === 'Ca Ngày' ? QC_SLOTS_DAY : QC_SLOTS_NIGHT;
                    let slots = (tab2SlotFilter === 'ALL') ? allSlots : allSlots.filter(s => s === tab2SlotFilter);
                    slots.forEach(slot => {
                        let k = `M${m}_${shift}_${slot}`;
                        let r = dayData[k] || {};
                        let xFactor = m <= 10 ? 'Xưởng 2' : 'Xưởng 1';
                        rows.push({
                            "Phân Xưởng": xFactor,
                            "Máy": `M${m}`,
                            "Ca": shift,
                            "Khung Giờ": `${slot} (${getSlotRangeText(slot)})`,
                            "QC Ca": shiftInspector,
                            "Mã Khuôn": r.moldId || '',
                            "Màu Sắc": r.colorCheck || 'OK',
                            "Ngoại Quan": r.visual || 'OK',
                            "Kích Thước": r.dimension || 'OK',
                            "Lắp Ráp": r.mechanical || 'OK',
                            "SL Kiểm": r.totalCheck !== undefined ? r.totalCheck : 0,
                            "SL Lỗi": r.defectCheck !== undefined ? r.defectCheck : 0,
                            "SL Đạt": r.goodCheck !== undefined ? r.goodCheck : 0,
                            "Đ.Giá": r.overall || 'OK',
                            "Ghi Chú Lỗi": r.note || ''
                        });
                    });
                });
            }
            let ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
            let suffix = tab2SlotFilter !== 'ALL' ? `_${tab2SlotFilter.replace(':', 'h')}` : '';
            XLSX.utils.book_append_sheet(wb, ws, "Tab2"); XLSX.writeFile(wb, `MES_QC_Tab2_${date}${suffix}.xlsx`);
        }


        async function exportBackupJson() {
            if (!checkAuthOrAlert()) return;
            try {
                // Tải toàn bộ dữ liệu từ Cloud nếu có kết nối để bản backup đầy đủ nhất
                let t1Cloud = {}, t2Cloud = {}, t3Cloud = {}, moldResinCloud = {}, hmiCloud = {};
                if (isConnected && db) {
                    let [s1, s2, s3, sMr, sHmi] = await Promise.all([
                        db.ref('qc_tab1_store_v1').once('value'),
                        db.ref('qc_tab2_store_v1').once('value'),
                        db.ref('qc_tab3_actions_v1').once('value'),
                        db.ref('qc_mold_resin_store_v1').once('value'),
                        db.ref('hmi_mold_preset_store_v1').once('value')
                    ]);
                    t1Cloud = s1.val() || {};
                    t2Cloud = s2.val() || {};
                    t3Cloud = s3.val() || {};
                    moldResinCloud = sMr.val() || {};
                    hmiCloud = sHmi.val() || {};
                }

                let backupData = {
                    version: "1.0",
                    app: "QC_HAITHIEN_SYSTEM",
                    exportedAt: new Date().toISOString(),
                    exportedBy: currentUser ? currentUser.email : "QC User",
                    qc_tab1_store_v1: cleanPayloadForFirebase({ ...t1Cloud, ...tab1Store }),
                    qc_tab2_store_v1: cleanPayloadForFirebase({ ...t2Cloud, ...tab2Store }),
                    qc_tab3_actions_v1: cleanPayloadForFirebase({ ...t3Cloud, ...tab3ActionNotesStore }),
                    qc_mold_resin_store_v1: cleanPayloadForFirebase({ ...moldResinCloud, ...moldResinStore }),
                    hmi_mold_preset_store_v1: cleanPayloadForFirebase({ ...hmiCloud, ...hmiMoldPresetStore })
                };

                let jsonStr = JSON.stringify(backupData, null, 2);
                let blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
                let url = URL.createObjectURL(blob);
                let a = document.createElement("a");
                let timeStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                a.href = url;
                a.download = `QC_HAITHIEN_BACKUP_${timeStr}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                alert(`✅ Đã tải file sao lưu JSON thành công!\n\nTên file: QC_HAITHIEN_BACKUP_${timeStr}.json\nLưu trữ an toàn trên máy tính của bạn.`);
            } catch (err) {
                alert("⚠️ Lỗi xuất file sao lưu: " + err.message);
            }
        }


        async function importBackupJson(inputEl) {
            if (!checkAuthOrAlert()) return;
            if (!inputEl.files || !inputEl.files[0]) return;
            let file = inputEl.files[0];

            if (!confirm(`Bạn có chắc chắn muốn KHÔI PHỤC dữ liệu từ file "${file.name}"?\n\nDữ liệu trong file sẽ được đồng bộ và cập nhật vào hệ thống và Firebase Cloud.`)) {
                inputEl.value = '';
                return;
            }

            let reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    let imported = JSON.parse(e.target.result);
                    if (!imported || typeof imported !== 'object') {
                        throw new Error("Cấu trúc file JSON không hợp lệ.");
                    }

                    let t1 = imported.qc_tab1_store_v1 || imported.tab1Store || {};
                    let t2 = imported.qc_tab2_store_v1 || imported.tab2Store || {};
                    let t3 = imported.qc_tab3_actions_v1 || imported.tab3ActionNotesStore || {};
                    let mr = imported.qc_mold_resin_store_v1 || imported.moldResinStore || {};
                    let hmi = imported.hmi_mold_preset_store_v1 || imported.hmiMoldPresetStore || {};

                    // Hợp nhất vào bộ nhớ máy
                    Object.keys(t1).forEach(d => { tab1Store[d] = { ...(tab1Store[d] || {}), ...t1[d] }; });
                    Object.keys(t2).forEach(d => { tab2Store[d] = { ...(tab2Store[d] || {}), ...t2[d] }; });
                    Object.keys(t3).forEach(d => { tab3ActionNotesStore[d] = { ...(tab3ActionNotesStore[d] || {}), ...t3[d] }; });
                    Object.keys(mr).forEach(k => { moldResinStore[k] = { ...(moldResinStore[k] || {}), ...mr[k] }; });
                    Object.keys(hmi).forEach(k => { hmiMoldPresetStore[k] = { ...(hmiMoldPresetStore[k] || {}), ...hmi[k] }; });

                    localStorage.setItem('qc_mold_resin_store_v1', JSON.stringify(moldResinStore));
                    localStorage.setItem('hmi_mold_preset_store_v1', JSON.stringify(hmiMoldPresetStore));

                    // Đồng bộ lên Firebase Cloud an toàn
                    if (isConnected && db) {
                        let promises = [];
                        Object.keys(t1).forEach(d => promises.push(db.ref(`qc_tab1_store_v1/${d}`).set(cleanPayloadForFirebase(tab1Store[d]))));
                        Object.keys(t2).forEach(d => promises.push(db.ref(`qc_tab2_store_v1/${d}`).set(cleanPayloadForFirebase(tab2Store[d]))));
                        Object.keys(t3).forEach(d => promises.push(db.ref(`qc_tab3_actions_v1/${d}`).update(cleanPayloadForFirebase(tab3ActionNotesStore[d]))));
                        Object.keys(mr).forEach(k => {
                            let safeK = getSafeFirebaseKey(k);
                            if (safeK) promises.push(db.ref(`qc_mold_resin_store_v1/${safeK}`).set(moldResinStore[k]));
                        });
                        Object.keys(hmi).forEach(k => {
                            let safeK = getSafeFirebaseKey(k);
                            if (safeK) promises.push(db.ref(`hmi_mold_preset_store_v1/${safeK}`).set(cleanPayloadForFirebase(hmiMoldPresetStore[k])));
                        });
                        await Promise.all(promises);
                    }

                    // Tải lại giao diện
                    renderTab1();
                    renderTab2();
                    debouncedRenderTab3();

                    alert(`🎉 Khôi phục dữ liệu thành công từ file "${file.name}"!\n\n• Ngày xuất: ${imported.exportedAt || 'Không rõ'}\n• Đã đồng bộ đầy đủ Tab 1, Tab 2, Tab 3, Nhựa-Màu và HMI.`);
                } catch (err) {
                    alert("❌ Lỗi khi đọc và khôi phục file JSON: " + err.message);
                } finally {
                    inputEl.value = '';
                }
            };
            reader.readAsText(file, "UTF-8");
        }
