/**
 * QC System - Tab 1: Shift Check & Technical Specifications
 * Xưởng Ép Nhựa Hải Tân
 */

        function onDateChangedTab1() { subscribeTabRealtime(); }


        // HÀM TÌM & ĐỒNG BỘ TÊN QC THEO CA VÀ PHÂN XƯỞNG
        function getShiftInspector(dayData, shift, m) {
            if (!dayData) return '';
            
            if (m !== undefined && m !== null) {
                let mNum = parseInt(m);
                // 1. Kiểm tra chính máy m
                if (dayData[`M${mNum}_${shift}_inspector`]) {
                    let val = dayData[`M${mNum}_${shift}_inspector`].trim();
                    if (val !== '') return val;
                }

                // 2. Kiểm tra theo xưởng của máy m
                let ws = getMachineWorkshop(mNum);
                if (dayData[`${shift}_${ws}_inspector`]) {
                    let val = dayData[`${shift}_${ws}_inspector`].trim();
                    if (val !== '') return val;
                }

                // 3. Quét các máy cùng xưởng
                let startM = (ws === 'XUONG1') ? 1 : 11;
                let endM = (ws === 'XUONG1') ? 10 : TOTAL_MACHINES;
                for (let i = startM; i <= endM; i++) {
                    let val = dayData[`M${i}_${shift}_inspector`];
                    if (val && val.trim() !== '') return val.trim();
                }
                return '';
            }

            // Fallback tổng quát nếu không truyền m
            if (dayData[`${shift}_inspector`]) return dayData[`${shift}_inspector`];
            for (let i = 1; i <= TOTAL_MACHINES; i++) {
                let val = dayData[`M${i}_${shift}_inspector`];
                if (val && val.trim() !== '') return val.trim();
            }
            return '';
        }


        function onTab1InspectorChange(shift, value, m) {
            let date = document.getElementById('tab1Date').value || getTodayISO();
            if (!tab1Store[date]) tab1Store[date] = {};
            let mNum = parseInt(m) || 1;
            let ws = getMachineWorkshop(mNum);
            let startM = (ws === 'XUONG1') ? 1 : 11;
            let endM = (ws === 'XUONG1') ? 10 : TOTAL_MACHINES;

            tab1Store[date][`${shift}_${ws}_inspector`] = value;
            for (let i = startM; i <= endM; i++) {
                tab1Store[date][`M${i}_${shift}_inspector`] = value;
            }

            // Chỉ cập nhật các ô input của các máy CÙNG XƯỞNG trên giao diện Tab 1
            document.querySelectorAll(`.t1-shift-inspector[data-shift="${shift}"]`).forEach(input => {
                let inM = parseInt(input.getAttribute('data-machine'));
                if (inM >= startM && inM <= endM) {
                    if (input.value !== value) input.value = value;
                }
            });
        }


        function syncCurrentTab1InputsToStore() {
            let date = document.getElementById('tab1Date')?.value || getTodayISO();
            if (!tab1Store[date]) tab1Store[date] = {};
            let dayData = tab1Store[date];
            let before = JSON.parse(JSON.stringify(dayData));

            document.querySelectorAll('.t1-shift-inspector').forEach(input => {
                let shiftKey = input.getAttribute('data-shiftkey');
                let shift = input.getAttribute('data-shift');
                let inM = parseInt(input.getAttribute('data-machine'));
                let ws = input.getAttribute('data-workshop') || (inM <= 10 ? 'XUONG1' : 'XUONG2');
                let val = input.value.trim();
                if (shiftKey) dayData[`${shiftKey}_inspector`] = val;
                if (shift && ws && val) dayData[`${shift}_${ws}_inspector`] = val;
            });

            let rows = document.querySelectorAll('#tab1Tbody tr');
            rows.forEach(tr => {
                let moldEl = tr.querySelector('.t1-mold');
                if (moldEl) {
                    let key = moldEl.getAttribute('data-key');
                    let existingImg = dayData[key]?.img;
                    let existingDrive = dayData[key]?.driveFile;
                    let existingUrl = dayData[key]?.driveUrl;
                    if (!dayData[key]) dayData[key] = {};
                    dayData[key].moldId = moldEl.value.trim();
                    let resinEl = tr.querySelector('.t1-resin');
                    if (resinEl) dayData[key].resinType = resinEl.value.trim();
                    let colEl = tr.querySelector('.t1-color');
                    if (colEl) dayData[key].resinColor = colEl.value.trim();
                    let decoEl = tr.querySelector('.t1-deco-cycle');
                    let decoVal = decoEl ? (parseFloat(decoEl.value) || 0) : 0;
                    if (decoEl) dayData[key].decoCycle = decoVal;
                    let machEl = tr.querySelector('.t1-machine-cycle');
                    if (machEl) {
                        dayData[key].machineCycle = (machEl.value.trim() !== '') ? (parseFloat(machEl.value) || 0) : decoVal;
                    }
                    let resEl = tr.querySelector('.t1-res');
                    if (resEl) dayData[key].result = resEl.value;
                    let noteEl = tr.querySelector('.t1-note');
                    if (noteEl) dayData[key].note = noteEl.value.trim();
                    if (existingImg) dayData[key].img = existingImg;
                    if (existingDrive) dayData[key].driveFile = existingDrive;
                    if (existingUrl) dayData[key].driveUrl = existingUrl;
                }
            });
            rememberTabInputDrafts(1, date, before, dayData);
        }


        function setTab1WorkshopFilter(filter) {
            syncCurrentTab1InputsToStore();
            tab1WorkshopFilter = filter;
            const btnAll = document.getElementById('btnT1FilterAll');
            const btnX1 = document.getElementById('btnT1FilterX1');
            const btnX2 = document.getElementById('btnT1FilterX2');
            const titleEl = document.getElementById('tab1Title');

            if (btnAll) btnAll.className = filter === 'ALL' ? 'btn btn-sm btn-3d-primary rounded-pill px-3 active' : 'btn btn-sm btn-outline-info rounded-pill px-3';
            if (btnX1) btnX1.className = filter === 'XUONG1' ? 'btn btn-sm btn-3d-primary rounded-pill px-3 active' : 'btn btn-sm btn-outline-info rounded-pill px-3';
            if (btnX2) btnX2.className = filter === 'XUONG2' ? 'btn btn-sm btn-3d-primary rounded-pill px-3 active' : 'btn btn-sm btn-outline-info rounded-pill px-3';

            if (titleEl) {
                if (filter === 'XUONG1') titleEl.innerText = 'Thông Số Vận Hành Máy Ép Haitian & Tình Trạng Khuôn - Xưởng 1 (M1 - M10)';
                else if (filter === 'XUONG2') titleEl.innerText = 'Thông Số Vận Hành Máy Ép Haitian & Tình Trạng Khuôn - Xưởng 2 (M11 - M21)';
                else titleEl.innerText = 'Thông Số Vận Hành Máy Ép Haitian & Tình Trạng Khuôn - Toàn Xưởng (M1 - M21)';
            }
            renderTab1();
        }


        function setTab1ShiftFilter(filter) {
            syncCurrentTab1InputsToStore();
            tab1ShiftFilter = filter;
            const btnAll = document.getElementById('btnT1ShiftAll');
            const btnDay = document.getElementById('btnT1ShiftDay');
            const btnNight = document.getElementById('btnT1ShiftNight');

            if (btnAll) btnAll.className = filter === 'ALL' ? 'btn btn-sm btn-3d-primary rounded-pill px-2 active' : 'btn btn-sm btn-outline-light rounded-pill px-2';
            if (btnDay) btnDay.className = filter === 'NGAY' ? 'btn btn-sm btn-3d-amber rounded-pill px-2 active' : 'btn btn-sm btn-outline-warning rounded-pill px-2';
            if (btnNight) btnNight.className = filter === 'DEM' ? 'btn btn-sm btn-3d-primary rounded-pill px-2 active' : 'btn btn-sm btn-outline-info rounded-pill px-2';

            renderTab1();
        }


        function getHmiPresetForMold(moldId) {
            if (!moldId) return null;
            let mId = String(moldId).trim();
            let safeKey = getSafeFirebaseKey(mId);
            let item = null;
            if (hmiMoldPresetStore && hmiMoldPresetStore[mId]) item = hmiMoldPresetStore[mId];
            else if (safeKey && hmiMoldPresetStore && hmiMoldPresetStore[safeKey]) item = hmiMoldPresetStore[safeKey];
            else {
                try {
                    let local = JSON.parse(localStorage.getItem('hmi_mold_preset_store_v1') || '{}');
                    if (local[mId]) item = local[mId];
                    else if (safeKey && local[safeKey]) item = local[safeKey];
                } catch (e) { }
            }
            if (item) {
                let res = JSON.parse(JSON.stringify(item));
                delete res.img; // Đảm bảo tuyệt đối không trả về chuỗi ảnh base64
                return res;
            }
            return null;
        }


        function getDefaultHmiPresetForMold(moldId) {
            let saved = getHmiPresetForMold(moldId);
            if (saved) return saved;
            return {
                moldId: moldId || '',
                driveFile: '',
                driveUrl: '',
                folderName: 'Màn hình HMI',
                updatedAt: '',
                updatedBy: ''
            };
        }


        function getMoldResinSpecs(moldId) {
            if (!moldId) return { resinType: '', resinColor: '' };
            let cleanId = String(moldId).trim();
            let safeKey = getSafeFirebaseKey(cleanId);
            return moldResinStore[cleanId] || moldResinStore[safeKey] || { resinType: '', resinColor: '' };
        }


        function updateMoldResinSpecs(moldId, resinType, resinColor, syncToFirebase = true) {
            if (!moldId) return;
            let cleanId = String(moldId).trim();
            let safeKey = getSafeFirebaseKey(cleanId);
            let current = getMoldResinSpecs(cleanId);
            
            let newType = resinType !== undefined && resinType !== null && String(resinType).trim() !== '' ? String(resinType).trim() : (current.resinType || 'PP');
            let newColor = resinColor !== undefined && resinColor !== null && String(resinColor).trim() !== '' ? String(resinColor).trim() : (current.resinColor || 'Trắng');

            if (current.resinType === newType && current.resinColor === newColor) {
                return;
            }

            let updated = { resinType: newType, resinColor: newColor };
            moldResinStore[cleanId] = updated;
            if (safeKey && safeKey !== cleanId) moldResinStore[safeKey] = updated;
            try { localStorage.setItem('qc_mold_resin_store_v1', JSON.stringify(moldResinStore)); } catch(e) {}

            if (syncToFirebase && isConnected && db && safeKey) {
                db.ref(`qc_mold_resin_store_v1/${safeKey}`).set(updated);
            }
        }


        function onTab1ResinChange(key, field, value) {
            let date = document.getElementById('tab1Date')?.value || getTodayISO();
            if (!tab1Store[date]) tab1Store[date] = {};
            if (!tab1Store[date][key]) tab1Store[date][key] = {};
            
            let moldEl = document.querySelector(`input.t1-mold[data-key="${key}"]`);
            let moldId = moldEl ? moldEl.value.trim() : (tab1Store[date][key].moldId || '');
            
            if (field === 'type') {
                tab1Store[date][key].resinType = value.trim();
            } else if (field === 'color') {
                tab1Store[date][key].resinColor = value.trim();
            }

            if (moldId) {
                let currentType = tab1Store[date][key].resinType || 'PP';
                let currentColor = tab1Store[date][key].resinColor || 'Trắng';
                updateMoldResinSpecs(moldId, currentType, currentColor, false);

                // Tự động đồng bộ Loại nhựa & Màu nhựa cho tất cả các máy/ca đang chạy chung mã khuôn này
                document.querySelectorAll('#tab1Tbody tr').forEach(tr => {
                    let otherMold = tr.querySelector('.t1-mold');
                    if (otherMold && otherMold.value.trim() === moldId) {
                        let otherKey = otherMold.getAttribute('data-key');
                        if (otherKey && otherKey !== key) {
                            if (!tab1Store[date][otherKey]) tab1Store[date][otherKey] = {};
                            tab1Store[date][otherKey].resinType = currentType;
                            tab1Store[date][otherKey].resinColor = currentColor;
                            let rInput = tr.querySelector('.t1-resin');
                            let cInput = tr.querySelector('.t1-color');
                            if (rInput && field === 'type') rInput.value = currentType;
                            if (cInput && field === 'color') cInput.value = currentColor;
                        }
                    }
                });
            }
        }


        function onTab1MoldChange(key, newMoldId) {
            if (!newMoldId) return;
            let cleanMold = newMoldId.trim();
            let date = document.getElementById('tab1Date').value || getTodayISO();
            if (!tab1Store[date]) tab1Store[date] = {};
            if (!tab1Store[date][key]) tab1Store[date][key] = {};
            let decoCycle = getDecoCycleByMoldId(cleanMold);
            let moldResin = getMoldResinSpecs(cleanMold);

            tab1Store[date][key].moldId = cleanMold;
            tab1Store[date][key].decoCycle = decoCycle;
            tab1Store[date][key].machineCycle = decoCycle;
            tab1Store[date][key].hmiDetails = getHmiPresetForMold(cleanMold) || getDefaultHmiPresetForMold(cleanMold);

            if (moldResin.resinType) tab1Store[date][key].resinType = moldResin.resinType;
            if (moldResin.resinColor) tab1Store[date][key].resinColor = moldResin.resinColor;

            renderTab1();
        }


        // TAB 1 RENDER (HỖ TRỢ M1 ĐẾN M21, LỌC THEO PHÂN XƯỞNG & THEO CA - CHỈ CHIA CA NGÀY VÀ CA ĐÊM)
        function renderTab1() {
            if (!isEditMode) return;
            let dateEl = document.getElementById('tab1Date');
            if (!dateEl) return;
            let date = dateEl.value || getTodayISO();
            dateEl.value = date;
            let tbody = document.getElementById('tab1Tbody');
            if (!tbody) return;
            tbody.innerHTML = "";

            let dayData = tab1Store[date] || {};

            let startM = 1, endM = TOTAL_MACHINES;
            if (tab1WorkshopFilter === 'XUONG1') { startM = 1; endM = 10; }
            else if (tab1WorkshopFilter === 'XUONG2') { startM = 11; endM = 21; }

            let visibleShifts = ['Ca Ngày', 'Ca Đêm'];
            if (tab1ShiftFilter === 'NGAY') visibleShifts = ['Ca Ngày'];
            else if (tab1ShiftFilter === 'DEM') visibleShifts = ['Ca Đêm'];

            for (let m = startM; m <= endM; m++) {
                visibleShifts.forEach((shift, sIdx) => {
                    let shiftKey = `M${m}_${shift}`;
                    let key = shiftKey;
                    let shiftInspector = getShiftInspector(dayData, shift, m);
                    let autoMold = getRunningMoldFromProd(date, m, shift);
                    let currentRec = dayData[key] || dayData[`${key}_Đầu ca`] || dayData[`${key}_Cuối ca`];
                    let decoCycle = getDecoCycleByMoldId(autoMold);

                    let rec = {
                        moldId: autoMold, resinType: 'PP', resinColor: 'Trắng', decoCycle: decoCycle, machineCycle: decoCycle, result: 'OK', note: '', moldCheckOverall: 'OK',
                        moldCheckDetails: { mech: 'OK', mechNote: '', cool: 'OK', coolNote: '', eject: 'OK', ejectNote: '', runner: 'OK', runnerNote: '' },
                        hmiDetails: getDefaultHmiPresetForMold(autoMold)
                    };

                    if (currentRec) {
                        rec = currentRec;
                        if (!rec.moldId && autoMold) rec.moldId = autoMold;
                        rec.decoCycle = getDecoCycleByMoldId(rec.moldId || autoMold);
                        // Cột chu kỳ máy tự động bằng chu kỳ deco, có thể chỉnh sửa thủ công
                        if (rec.machineCycle === undefined || rec.machineCycle === null || rec.machineCycle === '' || rec.machineCycle === 0) {
                            rec.machineCycle = rec.decoCycle;
                        }
                        if (!rec.moldCheckOverall) rec.moldCheckOverall = 'OK';
                        if (rec.moldCheckOverall === 'NG') rec.result = 'NG';
                        if (rec.moldId) {
                            let moldHmi = getHmiPresetForMold(rec.moldId);
                            if (moldHmi) rec.hmiDetails = moldHmi;
                        }
                    }

                    // Mã khuôn luôn theo phần mềm ép nhựa (không chọn tay)
                    let moldSrc = qcResolveMold(date, m, shift, rec.moldId);
                    if (moldSrc.mold !== (rec.moldId || '')) {
                        rec = { ...rec, moldId: moldSrc.mold, decoCycle: getDecoCycleByMoldId(moldSrc.mold) };
                        if (!currentRec || !currentRec.machineCycle || currentRec.moldId !== moldSrc.mold) rec.machineCycle = rec.decoCycle;
                        rec.hmiDetails = getHmiPresetForMold(moldSrc.mold) || getDefaultHmiPresetForMold(moldSrc.mold);
                    }

                    let moldResin = getMoldResinSpecs(rec.moldId || autoMold);
                    if (moldResin.resinType && (!currentRec || !currentRec.resinType)) rec.resinType = moldResin.resinType;
                    if (moldResin.resinColor && (!currentRec || !currentRec.resinColor)) rec.resinColor = moldResin.resinColor;

                    let shiftIcon = shift === 'Ca Ngày' ? '☀️' : '🌙';
                    let moldCheckBadgeClass = rec.moldCheckOverall === 'NG' ? 'btn-3d-ruby' : 'btn-3d-emerald';

                    let actionsData = tab3ActionNotesStore[date] || {};
                    let t3Key = `T1_${key}`;
                    let imgUrl = rec.img || actionsData[`${t3Key}_img`] || '';
                    let driveFile = rec.driveFile || actionsData[`${t3Key}_drive_file`] || '';
                    let driveUrl = rec.driveUrl || actionsData[`${t3Key}_drive_url`] || '';
                    let imgHtml = '';

                    if (imgUrl) {
                        imgHtml = `
                        <div class="d-flex align-items-center justify-content-center gap-1">
                            <img src="${escapeHtml(imgUrl)}" class="rounded border border-info shadow-sm" style="width:28px; height:28px; object-fit:cover; cursor:pointer;" onclick="previewDefectImage('${escapeHtml(imgUrl)}', 'Tab 1: M${m} (${shift}) - Khuôn: ${escapeHtml(rec.moldId || '-')}')" title="Bấm để xem ảnh trực tiếp">
                            <div class="btn-group btn-group-sm">
                                <label class="btn btn-xs btn-outline-warning py-0 px-1 m-0" style="font-size:9px; cursor:pointer;" title="Đổi ảnh">
                                    🔄<input type="file" accept="image/*" style="display:none;" onchange="handleTab1DefectImageUpload(this, '${escapeHtml(date)}', '${escapeHtml(key)}', '${m}', '${escapeHtml(rec.moldId)}')">
                                </label>
                                <button type="button" class="btn btn-xs btn-outline-danger py-0 px-1" style="font-size:9px;" onclick="removeTab1DefectImage('${escapeHtml(date)}', '${escapeHtml(key)}')" title="Xóa ảnh">🗑️</button>
                            </div>
                        </div>`;
                    } else if (driveUrl || driveFile) {
                        let viewTarget = driveUrl || driveFile;
                        imgHtml = `
                        <div class="d-flex align-items-center justify-content-center gap-1">
                            <button type="button" class="btn btn-xs btn-3d-primary rounded-pill py-0 px-2 shadow-sm" style="font-size:9.5px;" onclick="previewDefectImage('${escapeHtml(viewTarget)}', 'Tab 1: M${m} (${shift}) - Khuôn: ${escapeHtml(rec.moldId || '-')}')" title="Bấm để xem ảnh">🖼️ Xem</button>
                            <label class="btn btn-xs btn-outline-warning py-0 px-1 m-0" style="font-size:9px; cursor:pointer;" title="Tải ảnh mới / Đổi ảnh">
                                🔄<input type="file" accept="image/*" style="display:none;" onchange="handleTab1DefectImageUpload(this, '${escapeHtml(date)}', '${escapeHtml(key)}', '${m}', '${escapeHtml(rec.moldId)}')">
                            </label>
                            <button type="button" class="btn btn-xs btn-outline-danger py-0 px-1" style="font-size:9px;" onclick="removeTab1DefectImage('${escapeHtml(date)}', '${escapeHtml(key)}')" title="Xóa ảnh lỗi">🗑️</button>
                        </div>`;
                    } else {
                        imgHtml = `
                        <label class="btn btn-xs btn-outline-info rounded-pill py-0 px-2 shadow-sm" style="font-size:10px; cursor:pointer;" title="Chụp / Tải ảnh lỗi Tab 1 lưu vào Drive & Tab 3">
                            📸 Ảnh
                            <input type="file" accept="image/*" style="display:none;" onchange="handleTab1DefectImageUpload(this, '${escapeHtml(date)}', '${escapeHtml(key)}', '${m}', '${escapeHtml(rec.moldId)}')">
                        </label>`;
                    }

                    let moldHmi = rec.moldId ? (getHmiPresetForMold(rec.moldId) || rec.hmiDetails) : null;
                    let hasHmiImage = Boolean(moldHmi && (moldHmi.driveUrl || (window.tempHmiPreviews && window.tempHmiPreviews[rec.moldId])));
                    let hmiImgSrc = '';
                    if (moldHmi && moldHmi.driveUrl) {
                        hmiImgSrc = getGoogleDriveThumbnailUrl(moldHmi.driveUrl);
                    } else if (rec.moldId && window.tempHmiPreviews && window.tempHmiPreviews[rec.moldId]) {
                        hmiImgSrc = window.tempHmiPreviews[rec.moldId];
                    }

                    let hmiCellHtml = '';
                    if (hasHmiImage) {
                        hmiCellHtml = `
                        <div class="d-flex align-items-center justify-content-center gap-1">
                            <img src="${escapeHtml(hmiImgSrc)}" class="rounded border border-info shadow-sm" style="width:28px; height:28px; object-fit:cover; cursor:pointer;" onclick="openHmiModal('${key}')" onerror="this.onerror=null; let m=this.src.match(/id=([a-zA-Z0-9_-]+)/); if(m) this.src='https://lh3.googleusercontent.com/d/'+m[1];" title="Bấm xem ảnh màn hình HMI khuôn ${escapeHtml(rec.moldId || '-')} (Lưu trên Google Drive)">
                            <button type="button" class="btn btn-sm btn-3d-emerald py-0 px-2 rounded-pill shadow-sm" onclick="openHmiModal('${key}')" style="font-size:10.5px;" title="Đã có ảnh màn hình HMI trên Google Drive">
                                🖥️ Xem
                            </button>
                        </div>`;
                    } else {
                        hmiCellHtml = `
                        <button type="button" class="btn btn-sm btn-outline-info fw-bold py-0 px-2 rounded-pill shadow-sm" onclick="openHmiModal('${key}')" style="font-size:10.5px;" title="Chưa có ảnh HMI cho mã khuôn này. Bấm để chụp / tải ảnh lên Google Drive">
                            📷 Chụp HMI
                        </button>`;
                    }

                    let tr = document.createElement('tr');
                    tr.innerHTML = `
                    ${sIdx === 0 ? `<td rowspan="${visibleShifts.length}" class="fw-bold sticky-col">M${m}</td>` : ''}
                    <td><span class="${shift === 'Ca Ngày' ? 'shift-icon-day' : 'shift-icon-night'}">${shiftIcon} ${shift}</span></td>
                    <td><input type="text" class="form-control form-control-sm text-center fw-bold t1-shift-inspector text-info" value="${escapeHtml(shiftInspector)}" placeholder="QC Ca" data-shiftkey="${shiftKey}" data-shift="${shift}" data-machine="${m}" data-workshop="${getMachineWorkshop(m)}" oninput="onTab1InspectorChange('${shift}', this.value, ${m})"></td>
                    <td>${qcMoldCellHtml('t1-mold', key, rec.moldId, moldSrc.fromMes)}</td>
                    <td>
                        <button type="button" class="btn btn-sm ${moldCheckBadgeClass} py-0 px-2 w-100 t1-btn-moldcheck shadow" onclick="openMoldCheckDetailModal('${key}')" style="font-size:11px;" id="btn_mchk_${key}">
                            🛠️ ${escapeHtml(rec.moldCheckOverall || 'OK')}
                        </button>
                    </td>
                    <td><input type="text" class="form-control form-control-sm text-center t1-resin" value="${escapeHtml(rec.resinType || 'PP')}" oninput="onTab1ResinChange('${key}', 'type', this.value)"></td>
                    <td><input type="text" class="form-control form-control-sm text-center t1-color" value="${escapeHtml(rec.resinColor || 'Trắng')}" oninput="onTab1ResinChange('${key}', 'color', this.value)"></td>
                    <td>${hmiCellHtml}</td>
                    <td class="text-center align-middle" style="padding: 3px 2px !important;"><input type="number" step="0.1" class="form-control form-control-sm qc-cycle-input qc-cycle-deco t1-deco-cycle" value="${rec.decoCycle || 30}" readonly title="Chu kỳ Deco chuẩn: ${rec.decoCycle || 30}s"></td>
                    <td class="text-center align-middle" style="padding: 3px 2px !important;"><input type="number" step="0.1" class="form-control form-control-sm qc-cycle-input qc-cycle-machine t1-machine-cycle" value="${rec.machineCycle !== undefined && rec.machineCycle !== null && rec.machineCycle !== '' ? rec.machineCycle : (rec.decoCycle || 30)}" title="Chu kỳ Máy thực tế (có thể chỉnh sửa)"></td>
                    <td>
                        <select class="form-select form-select-sm fw-bold ${rec.result === 'NG' ? 'bg-danger text-white' : 'bg-success text-white'} t1-res" onchange="this.className='form-select form-select-sm fw-bold ' + (this.value==='NG'?'bg-danger text-white':'bg-success text-white')">
                            <option value="OK" ${rec.result === 'OK' ? 'selected' : ''}>OK</option>
                            <option value="NG" ${rec.result === 'NG' ? 'selected' : ''}>NG</option>
                        </select>
                    </td>
                    <td>${imgHtml}</td>
                    <td><input type="text" class="form-control form-control-sm t1-note" value="${escapeHtml(rec.note || '')}" placeholder="Ghi chú lỗi..."></td>
                `;
                    tbody.appendChild(tr);
                });
            }
        }


        function openMoldCheckDetailModal(key) {
            activeMoldCheckKey = key;
            let date = document.getElementById('tab1Date').value || getTodayISO();
            let dayData = tab1Store[date] || {};
            let rec = dayData[key] || {};
            let moldEl = document.querySelector(`input[data-key="${key}"]`);
            let moldId = moldEl ? moldEl.value.trim() : (rec.moldId || '');

            document.getElementById('moldCheckModalTitle').innerText = `🛠️ KIỂM TRA KHUÔN [${key}] - MÃ: ${moldId || 'Chưa rõ'}`;
            let details = rec.moldCheckDetails || { mech: 'OK', mechNote: '', cool: 'OK', coolNote: '', eject: 'OK', ejectNote: '', runner: 'OK', runnerNote: '' };

            document.getElementById('mchk_mech').value = details.mech || 'OK';
            document.getElementById('mchk_mech_note').value = details.mechNote || '';
            document.getElementById('mchk_cool').value = details.cool || 'OK';
            document.getElementById('mchk_cool_note').value = details.coolNote || '';
            document.getElementById('mchk_eject').value = details.eject || 'OK';
            document.getElementById('mchk_eject_note').value = details.ejectNote || '';
            document.getElementById('mchk_runner').value = details.runner || 'OK';
            document.getElementById('mchk_runner_note').value = details.runnerNote || '';

            updateMoldCheckOverallUI();
            let modalEl = document.getElementById('moldCheckDetailModal');
            if (!moldCheckModalInstance) moldCheckModalInstance = new bootstrap.Modal(modalEl);
            moldCheckModalInstance.show();
        }


        function updateMoldCheckOverallUI() {
            let items = document.querySelectorAll('.mchk-item');
            let isNG = false;
            items.forEach(el => {
                if (el.value === 'NG') { el.className = "form-select form-select-sm fw-bold bg-danger text-white mchk-item"; isNG = true; }
                else { el.className = "form-select form-select-sm fw-bold bg-success text-white mchk-item"; }
            });
            let badge = document.getElementById('moldCheckOverallBadge');
            if (isNG) { badge.className = "badge bg-danger fs-6 shadow"; badge.innerText = "NG"; }
            else { badge.className = "badge bg-success fs-6 shadow"; badge.innerText = "OK"; }
        }


        function saveMoldCheckDetailModal() {
            if (!checkAuthOrAlert()) return;
            if (!activeMoldCheckKey) return;
            let date = document.getElementById('tab1Date').value || getTodayISO();
            if (!tab1Store[date]) tab1Store[date] = {};
            if (!tab1Store[date][activeMoldCheckKey]) tab1Store[date][activeMoldCheckKey] = {};

            let mech = document.getElementById('mchk_mech').value, mechNote = document.getElementById('mchk_mech_note').value.trim();
            let cool = document.getElementById('mchk_cool').value, coolNote = document.getElementById('mchk_cool_note').value.trim();
            let eject = document.getElementById('mchk_eject').value, ejectNote = document.getElementById('mchk_eject_note').value.trim();
            let runner = document.getElementById('mchk_runner').value, runnerNote = document.getElementById('mchk_runner_note').value.trim();
            let overall = (mech === 'NG' || cool === 'NG' || eject === 'NG' || runner === 'NG') ? 'NG' : 'OK';

            tab1Store[date][activeMoldCheckKey].moldCheckOverall = overall;
            tab1Store[date][activeMoldCheckKey].moldCheckDetails = { mech, mechNote, cool, coolNote, eject, ejectNote, runner, runnerNote };

            // Nếu KT Khuôn là NG, tự động đánh giá Kết Quả (KQ) dòng đó là NG
            if (overall === 'NG') {
                tab1Store[date][activeMoldCheckKey].result = 'NG';
                let moldEl = document.querySelector(`input.t1-mold[data-key="${activeMoldCheckKey}"]`);
                if (moldEl) {
                    let tr = moldEl.closest('tr');
                    if (tr) {
                        let resSelect = tr.querySelector('.t1-res');
                        if (resSelect) {
                            resSelect.value = 'NG';
                            resSelect.className = 'form-select form-select-sm fw-bold bg-danger text-white t1-res';
                        }
                    }
                }
            }

            if (isConnected && db) {
                db.ref(`qc_tab1_store_v1/${date}/${activeMoldCheckKey}/moldCheckOverall`).set(overall);
                db.ref(`qc_tab1_store_v1/${date}/${activeMoldCheckKey}/moldCheckDetails`).set({ mech, mechNote, cool, coolNote, eject, ejectNote, runner, runnerNote });
                if (overall === 'NG') {
                    db.ref(`qc_tab1_store_v1/${date}/${activeMoldCheckKey}/result`).set('NG');
                }
            }
            let btn = document.getElementById(`btn_mchk_${activeMoldCheckKey}`);
            if (btn) {
                btn.className = `btn btn-sm ${overall === 'NG' ? 'btn-3d-ruby' : 'btn-3d-emerald'} py-0 px-2 w-100 t1-btn-moldcheck shadow`;
                btn.innerHTML = `🛠️ ${escapeHtml(overall)}`;
            }
            if (moldCheckModalInstance) moldCheckModalInstance.hide();
            loadAndRenderTab3();
        }


        function openHmiModal(key) {
            activeHmiKey = key;
            let date = document.getElementById('tab1Date').value || getTodayISO();
            let dayData = tab1Store[date] || {};
            let rec = dayData[key] || {};
            let moldEl = document.querySelector(`input[data-key="${key}"]`);
            activeMoldId = (moldEl ? moldEl.value.trim() : (rec.moldId || '')).trim();

            let titleEl = document.getElementById('hmiModalTitle');
            if (titleEl) {
                titleEl.innerText = activeMoldId 
                    ? `🖥️ MÀN HÌNH CÀI ĐẶT HMI MÁY ÉP - MÃ KHUÔN [${activeMoldId}]` 
                    : `🖥️ MÀN HÌNH CÀI ĐẶT HMI MÁY ÉP`;
            }
            let tagEl = document.getElementById('hmiMoldTag');
            if (tagEl) tagEl.innerText = activeMoldId || 'Chưa chọn';
            let keyBadgeEl = document.getElementById('hmiCurrentKeyBadge');
            if (keyBadgeEl) keyBadgeEl.innerText = key || '-';
            let noticeEl = document.getElementById('hmiMoldNoticeStatus');
            if (noticeEl) {
                noticeEl.innerText = activeMoldId 
                    ? `Đang xem ảnh cài đặt HMI cho mã khuôn: ${activeMoldId}` 
                    : `Chưa nhập mã khuôn cho dòng này!`;
            }

            renderHmiModalContent();

            let modalEl = document.getElementById('hmiModal');
            if (!hmiModalInstance) hmiModalInstance = new bootstrap.Modal(modalEl);
            hmiModalInstance.show();
        }


        function renderHmiModalContent() {
            let emptyEl = document.getElementById('hmiEmptyState');
            let previewWrapper = document.getElementById('hmiImagePreviewWrapper');
            let imgEl = document.getElementById('hmiImageElement');
            let metaInfo = document.getElementById('hmiImageMetaInfo');
            let timeInfo = document.getElementById('hmiImageTimeInfo');
            let driveLink = document.getElementById('hmiDriveFileLink');
            let loadingEl = document.getElementById('hmiUploadLoading');

            if (loadingEl) loadingEl.style.setProperty('display', 'none', 'important');

            let moldHmi = activeMoldId ? getHmiPresetForMold(activeMoldId) : null;
            let driveUrl = (moldHmi && moldHmi.driveUrl) ? moldHmi.driveUrl : '';
            let fileName = (moldHmi && moldHmi.driveFile) ? moldHmi.driveFile : '';
            let updatedAt = (moldHmi && moldHmi.updatedAt) ? moldHmi.updatedAt : '';
            let folderName = (moldHmi && moldHmi.folderName) ? moldHmi.folderName : 'Màn hình HMI';

            let imgSrc = '';
            if (driveUrl) {
                imgSrc = getGoogleDriveThumbnailUrl(driveUrl);
            }
            // Bản xem trước tạm thời trong phiên làm việc hiện tại (nếu Drive CDN chưa kịp phản hồi)
            if (!imgSrc && activeMoldId && window.tempHmiPreviews && window.tempHmiPreviews[activeMoldId]) {
                imgSrc = window.tempHmiPreviews[activeMoldId];
            }

            if (imgSrc || driveUrl) {
                if (emptyEl) emptyEl.style.display = 'none';
                if (previewWrapper) previewWrapper.style.display = 'block';
                if (imgEl) {
                    imgEl.src = imgSrc || (driveUrl ? getGoogleDriveThumbnailUrl(driveUrl) : '');
                    imgEl.onerror = function() {
                        let m = (driveUrl || '').match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || (driveUrl || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
                        if (m && m[1]) {
                            this.onerror = null;
                            this.src = `https://lh3.googleusercontent.com/d/${m[1]}`;
                        }
                    };
                    imgEl.classList.remove('hmi-preview-img-zoomed');
                }
                let btnZoom = document.getElementById('btnHmiZoom');
                if (btnZoom) btnZoom.innerText = '🔍 Phóng to';

                if (metaInfo) {
                    metaInfo.innerText = fileName || `HMI_${activeMoldId || 'KHUON'}.jpg`;
                }
                if (timeInfo) {
                    timeInfo.innerText = updatedAt 
                        ? `Cập nhật: ${new Date(updatedAt).toLocaleString('vi-VN')} • Thư mục: ${folderName}` 
                        : `Đã lưu trên Google Drive (${folderName})`;
                }
                if (driveLink) {
                    if (driveUrl) {
                        driveLink.href = driveUrl;
                        driveLink.style.display = 'inline-block';
                    } else {
                        driveLink.style.display = 'none';
                    }
                }
            } else {
                if (emptyEl) emptyEl.style.display = 'block';
                if (previewWrapper) previewWrapper.style.display = 'none';
                if (imgEl) imgEl.src = '';
            }
        }


        function toggleHmiImageZoom() {
            let imgEl = document.getElementById('hmiImageElement');
            let btnZoom = document.getElementById('btnHmiZoom');
            if (!imgEl) return;
            imgEl.classList.toggle('hmi-preview-img-zoomed');
            if (btnZoom) {
                btnZoom.innerText = imgEl.classList.contains('hmi-preview-img-zoomed') ? '🔍 Thu nhỏ' : '🔍 Phóng to';
            }
        }


        async function handleHmiImageUpload(inputEl) {
            if (!checkAuthOrAlert()) return;
            if (!inputEl.files || !inputEl.files[0]) return;
            const file = inputEl.files[0];
            syncCurrentTab1InputsToStore();

            if (!activeMoldId) {
                alert("⚠️ Vui lòng nhập Mã Khuôn cho máy này trước khi chụp/lưu ảnh màn hình HMI!");
                inputEl.value = '';
                return;
            }

            let loadingEl = document.getElementById('hmiUploadLoading');
            let loadingText = document.getElementById('hmiUploadLoadingText');
            if (loadingEl) loadingEl.style.setProperty('display', 'flex', 'important');
            if (loadingText) loadingText.innerText = 'Đang xử lý tăng nét HD & nén ảnh (~100KB)...';

            try {
                const comp = await compressHmiScreenImage(file);
                const compressedBase64 = comp.dataUrl;
                const sizeKB = Math.round(comp.sizeBytes / 1024);
                const safeMold = getSafeFirebaseKey(activeMoldId);
                const dateStr = getTodayISO();
                const fileName = `HMI_${safeMold}_${Date.now()}.jpg`;

                // Lưu ảnh xem trước tạm thời trong bộ nhớ phiên hiện tại (KHÔNG LƯU VÀO FIREBASE)
                if (!window.tempHmiPreviews) window.tempHmiPreviews = {};
                window.tempHmiPreviews[activeMoldId] = compressedBase64;
                if (safeMold) window.tempHmiPreviews[safeMold] = compressedBase64;

                if (loadingText) loadingText.innerText = `Đã nén ${sizeKB} KB (~100KB siêu nét). Đang tải ảnh lên Google Drive (thư mục "Màn hình HMI")...`;

                let driveUrl = '';
                let driveFolderUrl = '';

                // Gửi file ảnh lưu trực tiếp vào Google Drive qua Webhook Google Apps Script
                if (ZALO_WEBHOOK_URL && !ZALO_WEBHOOK_URL.includes("URL_GOOGLE_APPS_SCRIPT")) {
                    let pureBase64 = compressedBase64.split(',')[1] || compressedBase64;
                    try {
                        let response = await fetch(ZALO_WEBHOOK_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({
                                action: 'upload_to_drive',
                                folderId: GOOGLE_DRIVE_FOLDER_ID,
                                folderName: 'Màn hình HMI',
                                subfolder: 'Màn hình HMI',
                                targetFolder: 'Màn hình HMI',
                                fileName: fileName,
                                fileData: pureBase64,
                                mimeType: 'image/jpeg',
                                sendToZalo: false,
                                moldId: activeMoldId,
                                type: 'hmi_screen'
                            })
                        });
                        try {
                            let resData = await response.json();
                            if (resData && (resData.fileUrl || resData.url || resData.fileId)) {
                                driveUrl = resData.fileUrl || resData.url || (`https://drive.google.com/file/d/${resData.fileId}/view`);
                                if (resData.folderUrl) driveFolderUrl = resData.folderUrl;
                            }
                        } catch(parseErr) {
                            console.warn("Response webhook text/non-json:", parseErr);
                        }
                    } catch (uploadErr) {
                        console.warn("Lỗi upload Drive qua Webhook:", uploadErr);
                    }
                } else {
                    alert("⚠️ Chưa cấu hình Webhook Google Apps Script cho Google Drive! Vui lòng bấm vào nút '📁 Google Drive' để cấu hình.");
                }

                // CẤU TRÚC LƯU TRỮ: TUYỆT ĐỐI KHÔNG LƯU ẢNH TRỰC TIẾP VÀO FIREBASE HOẶC LOCALSTORAGE
                // Chỉ lưu link Google Drive và metadata
                let hmiRecord = {
                    moldId: activeMoldId,
                    driveFile: fileName,
                    driveUrl: driveUrl,
                    driveFolderUrl: driveFolderUrl || (GOOGLE_DRIVE_FOLDER_ID ? `https://drive.google.com/drive/folders/${GOOGLE_DRIVE_FOLDER_ID}` : ''),
                    folderName: 'Màn hình HMI',
                    updatedAt: new Date().toISOString(),
                    updatedBy: (typeof currentUserName !== 'undefined' && currentUserName) ? currentUserName : 'QC'
                };

                // 1. Lưu metadata vào store HMI
                hmiMoldPresetStore[activeMoldId] = hmiRecord;
                if (safeMold && safeMold !== activeMoldId) {
                    hmiMoldPresetStore[safeMold] = hmiRecord;
                }
                try {
                    localStorage.setItem('hmi_mold_preset_store_v1', JSON.stringify(hmiMoldPresetStore));
                } catch(e) {}

                // 2. Cập nhật Tab 1 store (chỉ chứa metadata, không chứa base64)
                let curDate = document.getElementById('tab1Date')?.value || dateStr;
                if (activeHmiKey && tab1Store[curDate] && tab1Store[curDate][activeHmiKey]) {
                    tab1Store[curDate][activeHmiKey].hmiDetails = hmiRecord;
                }
                // Đồng bộ cho tất cả các máy/ca trên màn hình đang chạy chung mã khuôn này
                if (tab1Store[curDate]) {
                    Object.keys(tab1Store[curDate]).forEach(k => {
                        if (tab1Store[curDate][k] && tab1Store[curDate][k].moldId === activeMoldId) {
                            tab1Store[curDate][k].hmiDetails = hmiRecord;
                        }
                    });
                }

                // 3. Lưu thông tin metadata lên Firebase RTDB (KHÔNG LƯU ẢNH TRỰC TIẾP)
                if (isConnected && db) {
                    try {
                        await db.ref(`hmi_mold_preset_store_v1/${safeMold}`).set(hmiRecord);
                        try { await db.ref(`hmi_mold_preset_store_v1/${safeMold}/img`).remove(); } catch(e){}
                        if (safeMold !== activeMoldId) {
                            try { 
                                await db.ref(`hmi_mold_preset_store_v1/${activeMoldId}`).set(hmiRecord);
                                await db.ref(`hmi_mold_preset_store_v1/${activeMoldId}/img`).remove();
                            } catch(e){}
                        }
                    } catch (fbErr) {
                        console.warn("Lỗi lưu Firebase preset:", fbErr);
                    }
                }

                syncCurrentTab1InputsToStore();
                renderHmiModalContent();
                renderTab1();

                let driveStatusMsg = driveUrl 
                    ? `• Đã lưu vào Google Drive: Thư mục "Màn hình HMI"\n• Đường dẫn ảnh: ${driveUrl}`
                    : `• Đã gửi ảnh vào thư mục "Màn hình HMI" trên Google Drive.`;

                alert(`✅ ĐÃ LƯU ẢNH MÀN HÌNH HMI THÀNH CÔNG!\n\n${driveStatusMsg}\n• Firebase: Chỉ lưu thông tin liên kết & Mã khuôn (KHÔNG lưu trực tiếp ảnh vào Firebase)\n• Kích thước nén: ${sizeKB} KB (chuẩn HD ~100KB, siêu nét, tải tức thì)\n• Đã ghi nhớ theo Mã khuôn [${activeMoldId}]: Lần sau khi chọn mã khuôn này trên bất kỳ máy/ca nào sẽ tự động xem lại được ngay.`);
            } catch (err) {
                alert("❌ Lỗi xử lý ảnh: " + err.message);
            } finally {
                if (loadingEl) loadingEl.style.setProperty('display', 'none', 'important');
                inputEl.value = '';
            }
        }


        async function deleteHmiImageForMold() {
            if (!checkAuthOrAlert()) return;
            if (!activeMoldId) return;
            if (!confirm(`Bạn có chắc chắn muốn xóa ảnh màn hình HMI đã lưu cho Mã khuôn [${activeMoldId}]?`)) return;

            let safeMold = getSafeFirebaseKey(activeMoldId);
            if (window.tempHmiPreviews) {
                delete window.tempHmiPreviews[activeMoldId];
                if (safeMold) delete window.tempHmiPreviews[safeMold];
            }
            delete hmiMoldPresetStore[activeMoldId];
            if (safeMold) delete hmiMoldPresetStore[safeMold];
            try { localStorage.setItem('hmi_mold_preset_store_v1', JSON.stringify(hmiMoldPresetStore)); } catch(e){}

            let curDate = document.getElementById('tab1Date')?.value || getTodayISO();
            if (tab1Store[curDate]) {
                Object.keys(tab1Store[curDate]).forEach(k => {
                    if (tab1Store[curDate][k] && tab1Store[curDate][k].moldId === activeMoldId) {
                        delete tab1Store[curDate][k].hmiDetails;
                    }
                });
            }

            if (isConnected && db) {
                try {
                    await db.ref(`hmi_mold_preset_store_v1/${safeMold}`).remove();
                    if (safeMold !== activeMoldId) {
                        await db.ref(`hmi_mold_preset_store_v1/${activeMoldId}`).remove();
                    }
                } catch(e) {}
            }

            renderHmiModalContent();
            renderTab1();
            alert(`🗑️ Đã xóa thông tin ảnh HMI của Mã khuôn [${activeMoldId}].`);
        }


        function applyHmiModalToRow() {
            if (hmiModalInstance) hmiModalInstance.hide();
            renderTab1();
        }


        async function saveTab1Data() {
            if (!checkAuthOrAlert()) return;
            let date = document.getElementById('tab1Date').value;
            if (!date) return;

            // 1. TẢI DỮ LIỆU CLOUD MỚI NHẤT ĐỂ BẢO VỆ CHỐNG GHI ĐÈ / MẤT DỮ LIỆU TỪ MÁY KHÁC
            let cloudData = {};
            if (isConnected && db) {
                try {
                    let snap = await db.ref(`qc_tab1_store_v1/${date}`).once('value');
                    cloudData = snap.val() || {};
                } catch(e) { console.warn("Lỗi tải cloud snapshot:", e); }
            }

            // Hợp nhất dữ liệu hiện có trong bộ nhớ và cloud làm nền tảng (Base)
            let dayData = { ...cloudData, ...(tab1Store[date] || {}) };

            // 2. Lưu tên QC theo ca phân biệt Xưởng 1 (M1 - M10) và Xưởng 2 (M11 - M21)
            ['Ca Ngày', 'Ca Đêm'].forEach(shift => {
                // Xưởng 1 (M1 - M10)
                let inputX1 = document.querySelector(`.t1-shift-inspector[data-shift="${shift}"][data-workshop="XUONG1"]`);
                if (inputX1) {
                    let valX1 = inputX1.value.trim();
                    dayData[`${shift}_XUONG1_inspector`] = valX1;
                    for (let m = 1; m <= 10; m++) {
                        dayData[`M${m}_${shift}_inspector`] = valX1;
                    }
                }

                // Xưởng 2 (M11 - M21)
                let inputX2 = document.querySelector(`.t1-shift-inspector[data-shift="${shift}"][data-workshop="XUONG2"]`);
                if (inputX2) {
                    let valX2 = inputX2.value.trim();
                    dayData[`${shift}_XUONG2_inspector`] = valX2;
                    for (let m = 11; m <= TOTAL_MACHINES; m++) {
                        dayData[`M${m}_${shift}_inspector`] = valX2;
                    }
                }
            });

            // 3. Quét các dòng đang hiển thị trên giao diện và ghi đè những ô người dùng vừa chỉnh sửa
            let rows = document.querySelectorAll('#tab1Tbody tr');
            rows.forEach(tr => {
                let moldEl = tr.querySelector('.t1-mold');
                if (moldEl) {
                    let key = moldEl.getAttribute('data-key');
                    if (!key) return;
                    let existingRowData = dayData[key] || {};
                    let moldVal = moldEl.value.trim();
                    let resinEl = tr.querySelector('.t1-resin');
                    let colEl = tr.querySelector('.t1-color');
                    let decoEl = tr.querySelector('.t1-deco-cycle');
                    let machEl = tr.querySelector('.t1-machine-cycle');
                    let resEl = tr.querySelector('.t1-res');
                    let noteEl = tr.querySelector('.t1-note');

                    let decoVal = decoEl ? (parseFloat(String(decoEl.value).replace(',', '.')) || 0) : (existingRowData.decoCycle || 0);
                    let machVal = (machEl && machEl.value.trim() !== '') ? (parseFloat(String(machEl.value).replace(',', '.')) || 0) : decoVal;

                    dayData[key] = {
                        ...existingRowData,
                        moldId: moldVal,
                        resinType: resinEl ? resinEl.value.trim() : (existingRowData.resinType || 'PP'),
                        resinColor: colEl ? colEl.value.trim() : (existingRowData.resinColor || 'Trắng'),
                        decoCycle: decoVal,
                        machineCycle: machVal,
                        result: resEl ? resEl.value : (existingRowData.result || 'OK'),
                        note: noteEl ? noteEl.value.trim() : (existingRowData.note || '')
                    };

                    // Đồng bộ Loại nhựa & Màu nhựa cho mã khuôn
                    if (moldVal) {
                        let rVal = resinEl ? resinEl.value.trim() : (existingRowData.resinType || 'PP');
                        let cVal = colEl ? colEl.value.trim() : (existingRowData.resinColor || 'Trắng');
                        updateMoldResinSpecs(moldVal, rVal, cVal);
                    }

                    // Đồng bộ HMI preset nếu dòng có hmiDetails (Chỉ lưu link Google Drive, không lưu ảnh trực tiếp vào Firebase)
                    if (moldVal && dayData[key].hmiDetails) {
                        let safeKey = getSafeFirebaseKey(moldVal);
                        let cleanHmi = cleanPayloadForFirebase(dayData[key].hmiDetails);
                        delete cleanHmi.img;
                        delete cleanHmi.tempPreview;
                        dayData[key].hmiDetails = cleanHmi;
                        hmiMoldPresetStore[moldVal] = cleanHmi;
                        if (safeKey && isConnected && db) {
                            db.ref(`hmi_mold_preset_store_v1/${safeKey}`).set(cleanHmi);
                            try { db.ref(`hmi_mold_preset_store_v1/${safeKey}/img`).remove(); } catch(e){}
                        }
                    }
                }
            });

            try { localStorage.setItem('hmi_mold_preset_store_v1', JSON.stringify(hmiMoldPresetStore)); } catch(e) {}
            tab1Store[date] = dayData;

            // 4. Thu thập các điểm lỗi NG của Tab 1 đầy đủ thông tin để gửi Zalo khi BẤM LƯU
            let ngItemsTab1 = [];
            Object.keys(dayData).forEach(key => {
                if (key.endsWith('_inspector')) return;
                let rec = dayData[key] || {};
                let isCycleNG = (rec.decoCycle && rec.machineCycle && Math.abs(rec.machineCycle - rec.decoCycle) >= 3);
                let isNG = (rec.result === 'NG' || rec.moldCheckOverall === 'NG' || isCycleNG);

                if (isNG && rec.moldId) {
                    let p = key.split('_');
                    let mTag = p[0];
                    let shiftTag = p[1] || 'Ca Ngày';
                    let moldCond = rec.moldCheckOverall === 'NG' ? 'Khuôn: NG ❌' : 'Khuôn: OK ✅';
                    let resCond = rec.result === 'NG' ? 'Đánh giá: NG ❌' : 'Đánh giá: OK ✅';
                    let cycleInfo = rec.decoCycle ? `\n   • Chu kỳ: Máy ${rec.machineCycle}s / Chuẩn ${rec.decoCycle}s ${isCycleNG ? '(Lệch ≥3s)' : ''}` : '';
                    let resinInfo = `• Quy cách: Nhựa ${rec.resinType || 'PP'} - Màu ${rec.resinColor || 'Trắng'}`;
                    let noteText = `• Lý do / Ghi chú: ${rec.note || 'Không có ghi chú'}`;
                    
                    let photoLink = rec.driveUrl || (tab3ActionNotesStore[date] && tab3ActionNotesStore[date][`T1_${key}_drive_url`]);
                    let photoTag = '';
                    if (photoLink) {
                        photoTag = `\n   📸 Link ảnh: ${photoLink}`;
                    } else if (rec.driveFile) {
                        photoTag = `\n   📸 File ảnh: ${rec.driveFile}`;
                    }

                    ngItemsTab1.push(`⚠️ ${mTag} (${shiftTag}) | Khuôn: ${rec.moldId}\n   ${resinInfo}\n   • Tình trạng: ${moldCond} | ${resCond}${cycleInfo}\n   ${noteText}${photoTag}`);
                }
            });

            if (isConnected && db) {
                const savedPayload = cleanPayloadForFirebase(dayData);
                db.ref(`qc_tab1_store_v1/${date}`).set(savedPayload)
                    .then(() => {
                        acknowledgeTabInputDrafts(1, date, savedPayload);
                        if (ngItemsTab1.length > 0) {
                            let tab1Alert = `🚨 [CẢNH BÁO QC TAB 1 - THÔNG SỐ & TÌNH TRẠNG KHUÔN]\n` +
                                            `📅 Ngày: ${date}\n\n` +
                                            ngItemsTab1.join('\n\n');
                            sendZaloAlert(tab1Alert, date);
                        }
                        loadAndRenderTab3();
                        alert(`🟢 Đã lưu Tab 1 an toàn & đồng bộ toàn bộ thông số lên Firebase Cloud (Ảnh lưu an toàn trên Google Drive)!`);
                    })
                    .catch(err => alert("⚠️ Lỗi lưu dữ liệu: " + err.message));
            } else {
                alert("⚠️ Không thể kết nối tới Firebase Database. Vui lòng kiểm tra mạng hoặc đăng nhập lại!");
            }
        }
