/**
 * QC System - Tab 2: 2-Hour Periodic Quality Inspections
 * Xưởng Ép Nhựa Hải Tân
 */

        function onDateChangedTab2() { subscribeTabRealtime(); }


        function onTab2InspectorChange(shift, value, m) {
            let date = document.getElementById('tab2Date').value || getTodayISO();
            if (!tab2Store[date]) tab2Store[date] = {};
            let mNum = parseInt(m) || 1;
            let ws = getMachineWorkshop(mNum);
            let startM = (ws === 'XUONG1') ? 1 : 11;
            let endM = (ws === 'XUONG1') ? 10 : TOTAL_MACHINES;

            tab2Store[date][`${shift}_${ws}_inspector`] = value;
            for (let i = startM; i <= endM; i++) {
                tab2Store[date][`M${i}_${shift}_inspector`] = value;
            }

            // Chỉ cập nhật các ô input của các máy CÙNG XƯỞNG trên giao diện Tab 2
            document.querySelectorAll(`.t2-shift-inspector[data-shift="${shift}"]`).forEach(input => {
                let inM = parseInt(input.getAttribute('data-machine'));
                if (inM >= startM && inM <= endM) {
                    if (input.value !== value) input.value = value;
                }
            });
        }


        function syncCurrentTab2InputsToStore() {
            let date = document.getElementById('tab2Date')?.value || getTodayISO();
            if (!tab2Store[date]) tab2Store[date] = {};
            let dayData = tab2Store[date];
            let before = JSON.parse(JSON.stringify(dayData));

            document.querySelectorAll('.t2-shift-inspector').forEach(input => {
                let shiftKey = input.getAttribute('data-shiftkey');
                let shift = input.getAttribute('data-shift');
                let inM = parseInt(input.getAttribute('data-machine'));
                let ws = input.getAttribute('data-workshop') || (inM <= 10 ? 'XUONG1' : 'XUONG2');
                let val = input.value.trim();
                if (shiftKey) dayData[`${shiftKey}_inspector`] = val;
                if (shift && ws && val) dayData[`${shift}_${ws}_inspector`] = val;
            });

            let rows = document.querySelectorAll('#tab2Tbody tr');
            rows.forEach(tr => {
                let moldEl = tr.querySelector('.t2-mold');
                if (moldEl) {
                    let key = moldEl.getAttribute('data-key');
                    if (!dayData[key]) dayData[key] = {};
                    dayData[key].moldId = moldEl.value.trim();
                    let colChk = tr.querySelector('.t2-color-chk')?.value || 'OK';
                    let vis = tr.querySelector('.t2-visual')?.value || 'OK';
                    let dim = tr.querySelector('.t2-dim')?.value || 'OK';
                    let mech = tr.querySelector('.t2-mech')?.value || 'OK';
                    let total = parseInt(tr.querySelector('.t2-total')?.value) || 0;
                    let defect = parseInt(tr.querySelector('.t2-defect')?.value) || 0;
                    let good = total - defect; if (good < 0) good = 0;
                    let note = tr.querySelector('.t2-note')?.value.trim() || '';

                    let defectRatio = total > 0 ? (defect / total) : 0;
                    let isNGByRatio = defectRatio > 0.20;
                    let isNG = (colChk === 'NG' || vis === 'NG' || dim === 'NG' || mech === 'NG' || isNGByRatio || defect > 0);

                    let existingImg = dayData[key]?.img;
                    let existingDrive = dayData[key]?.driveFile;
                    dayData[key] = { 
                        ...dayData[key],
                        moldId: moldEl.value.trim(), 
                        colorCheck: colChk, 
                        visual: vis, 
                        dimension: dim, 
                        mechanical: mech, 
                        totalCheck: total, 
                        defectCheck: defect, 
                        goodCheck: good, 
                        overall: isNG ? 'NG' : 'OK', 
                        note: note,
                        ...(existingImg ? { img: existingImg } : {}),
                        ...(existingDrive ? { driveFile: existingDrive } : {})
                    };
                }
            });
            rememberTabInputDrafts(2, date, before, dayData);
        }


        function setTab2WorkshopFilter(filter) {
            syncCurrentTab2InputsToStore();
            tab2WorkshopFilter = filter;
            const btnAll = document.getElementById('btnT2FilterAll');
            const btnX1 = document.getElementById('btnT2FilterX1');
            const btnX2 = document.getElementById('btnT2FilterX2');
            const titleEl = document.getElementById('tab2Title');

            if (btnAll) btnAll.className = filter === 'ALL' ? 'btn btn-sm btn-3d-primary rounded-pill px-3 active' : 'btn btn-sm btn-outline-info rounded-pill px-3';
            if (btnX1) btnX1.className = filter === 'XUONG1' ? 'btn btn-sm btn-3d-primary rounded-pill px-3 active' : 'btn btn-sm btn-outline-info rounded-pill px-3';
            if (btnX2) btnX2.className = filter === 'XUONG2' ? 'btn btn-sm btn-3d-primary rounded-pill px-3 active' : 'btn btn-sm btn-outline-info rounded-pill px-3';

            if (titleEl) {
                if (filter === 'XUONG1') titleEl.innerText = 'Kiểm Tra Sản Phẩm Định Kỳ (2 Giờ / Lần) - Xưởng 1 (M1 - M10)';
                else if (filter === 'XUONG2') titleEl.innerText = 'Kiểm Tra Sản Phẩm Định Kỳ (2 Giờ / Lần) - Xưởng 2 (M11 - M21)';
                else titleEl.innerText = 'Kiểm Tra Sản Phẩm Định Kỳ (2 Giờ / Lần) - Toàn Xưởng (M1 - M21)';
            }
            renderTab2();
        }


        function setTab2ShiftFilter(filter) {
            syncCurrentTab2InputsToStore();
            tab2ShiftFilter = filter;
            const btnAll = document.getElementById('btnT2ShiftAll');
            const btnDay = document.getElementById('btnT2ShiftDay');
            const btnNight = document.getElementById('btnT2ShiftNight');

            if (btnAll) btnAll.className = filter === 'ALL' ? 'btn btn-sm btn-3d-primary rounded-pill px-2 active' : 'btn btn-sm btn-outline-light rounded-pill px-2';
            if (btnDay) btnDay.className = filter === 'NGAY' ? 'btn btn-sm btn-3d-amber rounded-pill px-2 active' : 'btn btn-sm btn-outline-warning rounded-pill px-2';
            if (btnNight) btnNight.className = filter === 'DEM' ? 'btn btn-sm btn-3d-primary rounded-pill px-2 active' : 'btn btn-sm btn-outline-info rounded-pill px-2';

            // Reset tab2SlotFilter nếu khung giờ đang chọn không thuộc ca vừa đổi
            if (tab2SlotFilter !== 'ALL') {
                let inDay = QC_SLOTS_DAY.includes(tab2SlotFilter);
                let inNight = QC_SLOTS_NIGHT.includes(tab2SlotFilter);
                if ((filter === 'NGAY' && !inDay) || (filter === 'DEM' && !inNight)) {
                    tab2SlotFilter = 'ALL';
                }
            }

            renderTab2SlotFilterButtons();
            renderTab2();
        }


        function setTab2SlotFilter(slot) {
            syncCurrentTab2InputsToStore();
            tab2SlotFilter = slot;
            renderTab2SlotFilterSelect();
            renderTab2();
        }


        function renderTab2SlotFilterSelect() {
            let select = document.getElementById('tab2SlotSelect');
            let wrapper = document.getElementById('tab2SlotSelectWrapper');
            if (!select) return;

            let showDay = (tab2ShiftFilter === 'ALL' || tab2ShiftFilter === 'NGAY');
            let showNight = (tab2ShiftFilter === 'ALL' || tab2ShiftFilter === 'DEM');

            let html = `<option value="ALL" class="bg-dark text-white">⏰ Tất Cả Giờ (2h/lần)</option>`;

            if (showDay) {
                html += `<optgroup label="☀️ Ca Ngày" class="bg-dark text-warning">`;
                QC_SLOTS_DAY.forEach(slot => {
                    let range = getSlotRangeText(slot);
                    let isSel = (tab2SlotFilter === slot) ? 'selected' : '';
                    html += `<option value="${slot}" class="bg-dark text-white" ${isSel}>${slot} (${range})</option>`;
                });
                html += `</optgroup>`;
            }

            if (showNight) {
                html += `<optgroup label="🌙 Ca Đêm" class="bg-dark text-info">`;
                QC_SLOTS_NIGHT.forEach(slot => {
                    let range = getSlotRangeText(slot);
                    let isSel = (tab2SlotFilter === slot) ? 'selected' : '';
                    html += `<option value="${slot}" class="bg-dark text-white" ${isSel}>${slot} (${range})</option>`;
                });
                html += `</optgroup>`;
            }

            select.innerHTML = html;
            select.value = tab2SlotFilter;

            if (wrapper) {
                if (tab2SlotFilter !== 'ALL') {
                    wrapper.style.borderColor = '#facc15';
                    wrapper.style.boxShadow = '0 0 10px rgba(250, 204, 21, 0.35)';
                    select.style.color = '#facc15';
                } else {
                    wrapper.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                    wrapper.style.boxShadow = 'none';
                    select.style.color = '#38bdf8';
                }
            }
        }


        // Bí danh đảm bảo tương thích ngược
        function renderTab2SlotFilterButtons() {
            renderTab2SlotFilterSelect();
        }


        // TAB 2 RENDER (HỖ TRỢ M1 ĐẾN M21, LỌC THEO PHÂN XƯỞNG & THEO CA)
        function renderTab2() {
            if (!isEditMode) return;
            let dateEl = document.getElementById('tab2Date');
            if (!dateEl) return;
            let date = dateEl.value || getTodayISO();
            dateEl.value = date;
            let tbody = document.getElementById('tab2Tbody');
            if (!tbody) return;
            tbody.innerHTML = "";

            renderTab2SlotFilterButtons();

            let dayData = tab2Store[date] || {};

            let startM = 1, endM = TOTAL_MACHINES;
            if (tab2WorkshopFilter === 'XUONG1') { startM = 1; endM = 10; }
            else if (tab2WorkshopFilter === 'XUONG2') { startM = 11; endM = 21; }

            let visibleShifts = ['Ca Ngày', 'Ca Đêm'];
            if (tab2ShiftFilter === 'NGAY') visibleShifts = ['Ca Ngày'];
            else if (tab2ShiftFilter === 'DEM') visibleShifts = ['Ca Đêm'];

            for (let m = startM; m <= endM; m++) {
                // Xác định các ca và khung giờ phù hợp với bộ lọc
                let shiftsToRender = [];
                visibleShifts.forEach(shift => {
                    let allSlots = shift === 'Ca Ngày' ? QC_SLOTS_DAY : QC_SLOTS_NIGHT;
                    let filteredSlots = (tab2SlotFilter === 'ALL') 
                        ? allSlots 
                        : allSlots.filter(s => s === tab2SlotFilter);
                    if (filteredSlots.length > 0) {
                        shiftsToRender.push({ shift, slots: filteredSlots });
                    }
                });

                let totalRowsForMachine = shiftsToRender.reduce((sum, item) => sum + item.slots.length, 0);
                if (totalRowsForMachine === 0) continue;

                let machineRendered = false;

                shiftsToRender.forEach((shiftObj) => {
                    let shift = shiftObj.shift;
                    let slots = shiftObj.slots;
                    let shiftKey = `M${m}_${shift}`;
                    let shiftInspector = getShiftInspector(dayData, shift, m) || (tab1Store[date] ? getShiftInspector(tab1Store[date], shift, m) : '');
                    let autoMold = getRunningMoldFromProd(date, m, shift);
                    let shiftIcon = shift === 'Ca Ngày' ? '☀️' : '🌙';

                    slots.forEach((timeSlot, tIdx) => {
                        let key = `${shiftKey}_${timeSlot}`;
                        let rec = dayData[key] || { moldId: autoMold, colorCheck: 'OK', visual: 'OK', dimension: 'OK', mechanical: 'OK', totalCheck: 0, defectCheck: 0, goodCheck: 0, overall: 'OK', note: '' };
                        if (!rec.moldId && autoMold) rec.moldId = autoMold;
                        // Mã khuôn luôn theo phần mềm ép nhựa (không chọn tay)
                        let moldSrc = qcResolveMold(date, m, shift, rec.moldId);
                        if (moldSrc.mold !== (rec.moldId || '')) rec = { ...rec, moldId: moldSrc.mold };

                        let total = rec.totalCheck !== undefined ? rec.totalCheck : 0;
                        let defect = rec.defectCheck !== undefined ? rec.defectCheck : 0;
                        let good = total - defect; if (good < 0) good = 0;

                        let defectRatio = total > 0 ? (defect / total) : 0;
                        let isNGByRatio = defectRatio > 0.20;
                        let isNG = (rec.colorCheck === 'NG' || rec.visual === 'NG' || rec.dimension === 'NG' || rec.mechanical === 'NG' || isNGByRatio || defect > 0);
                        let overallVal = isNG ? 'NG' : 'OK';

                        let actionsData = tab3ActionNotesStore[date] || {};
                        let t3Key = `T2_${key}`;
                        let imgUrl = rec.img || actionsData[`${t3Key}_img`] || '';
                        let driveFile = rec.driveFile || actionsData[`${t3Key}_drive_file`] || '';
                        let driveUrl = rec.driveUrl || actionsData[`${t3Key}_drive_url`] || '';
                        let imgHtml = '';

                        if (imgUrl) {
                            imgHtml = `
                            <div class="d-flex align-items-center justify-content-center gap-1">
                                <img src="${escapeHtml(imgUrl)}" class="rounded border border-info shadow-sm" style="width:28px; height:28px; object-fit:cover; cursor:pointer;" onclick="previewDefectImage('${escapeHtml(imgUrl)}', 'M${m} (${shift} ${timeSlot}) - Khuôn: ${escapeHtml(rec.moldId || '-')}')" title="Bấm để xem ảnh trực tiếp">
                                <div class="btn-group btn-group-sm">
                                    <label class="btn btn-xs btn-outline-warning py-0 px-1 m-0" style="font-size:9px; cursor:pointer;" title="Đổi ảnh">
                                        🔄<input type="file" accept="image/*" style="display:none;" onchange="handleTab2DefectImageUpload(this, '${escapeHtml(date)}', '${escapeHtml(key)}', '${m}', '${escapeHtml(rec.moldId)}')">
                                    </label>
                                    <button type="button" class="btn btn-xs btn-outline-danger py-0 px-1" style="font-size:9px;" onclick="removeTab2DefectImage('${escapeHtml(date)}', '${escapeHtml(key)}')" title="Xóa ảnh">🗑️</button>
                                </div>
                            </div>`;
                        } else if (driveUrl || driveFile) {
                            let viewTarget = driveUrl || driveFile;
                            imgHtml = `
                            <div class="d-flex align-items-center justify-content-center gap-1">
                                <button type="button" class="btn btn-xs btn-3d-primary rounded-pill py-0 px-2 shadow-sm" style="font-size:9.5px;" onclick="previewDefectImage('${escapeHtml(viewTarget)}', 'M${m} (${shift} ${timeSlot}) - Khuôn: ${escapeHtml(rec.moldId || '-')}')" title="Bấm để xem ảnh">🖼️ Xem</button>
                                <label class="btn btn-xs btn-outline-warning py-0 px-1 m-0" style="font-size:9px; cursor:pointer;" title="Tải ảnh mới / Đổi ảnh">
                                    🔄<input type="file" accept="image/*" style="display:none;" onchange="handleTab2DefectImageUpload(this, '${escapeHtml(date)}', '${escapeHtml(key)}', '${m}', '${escapeHtml(rec.moldId)}')">
                                </label>
                                <button type="button" class="btn btn-xs btn-outline-danger py-0 px-1" style="font-size:9px;" onclick="removeTab2DefectImage('${escapeHtml(date)}', '${escapeHtml(key)}')" title="Xóa ảnh lỗi">🗑️</button>
                            </div>`;
                        } else {
                            imgHtml = `
                            <label class="btn btn-xs btn-outline-info rounded-pill py-0 px-2 shadow-sm" style="font-size:10px; cursor:pointer;" title="Chụp / Tải ảnh lỗi lưu vào Drive & Tab 3">
                                📸 Ảnh
                                <input type="file" accept="image/*" style="display:none;" onchange="handleTab2DefectImageUpload(this, '${escapeHtml(date)}', '${escapeHtml(key)}', '${m}', '${escapeHtml(rec.moldId)}')">
                            </label>`;
                        }

                        let machineCellHtml = '';
                        if (!machineRendered) {
                            machineCellHtml = `<td rowspan="${totalRowsForMachine}" class="fw-bold sticky-col">M${m}</td>`;
                            machineRendered = true;
                        }

                        let shiftCellHtml = '';
                        let inspectorCellHtml = '';
                        if (tIdx === 0) {
                            shiftCellHtml = `<td rowspan="${slots.length}" class="fw-bold"><div class="${shift === 'Ca Ngày' ? 'shift-icon-day' : 'shift-icon-night'}">${shiftIcon}<div style="font-size:10px; margin-top:2px; font-weight:700;">${shift}</div></div></td>`;
                            inspectorCellHtml = `<td rowspan="${slots.length}"><input type="text" class="form-control form-control-sm text-center fw-bold t2-shift-inspector text-info" value="${escapeHtml(shiftInspector)}" placeholder="QC Ca" data-shiftkey="${shiftKey}" data-shift="${shift}" data-machine="${m}" data-workshop="${getMachineWorkshop(m)}" oninput="onTab2InspectorChange('${shift}', this.value, ${m})"></td>`;
                        }

                        let tr = document.createElement('tr');
                        tr.innerHTML = `
                        ${machineCellHtml}
                        ${shiftCellHtml}
                        ${inspectorCellHtml}
                        <td class="fw-bold text-info" style="font-size:10.5px;">
                            <div>${timeSlot}</div>
                            <div class="text-secondary" style="font-size:8.5px; white-space:nowrap;">${getSlotRangeText(timeSlot)}</div>
                        </td>
                        <td>${qcMoldCellHtml('t2-mold', key, rec.moldId, moldSrc.fromMes)}</td>
                        <td class="text-center align-middle" style="padding: 2px !important;">
                            <select class="form-select form-select-sm fw-bold qc-select-compact ${rec.colorCheck === 'NG' ? 'bg-danger text-white' : 'bg-success text-white'} t2-color-chk" onchange="recalcTab2Overall(this)">
                                <option value="OK" ${rec.colorCheck === 'OK' ? 'selected' : ''}>OK</option>
                                <option value="NG" ${rec.colorCheck === 'NG' ? 'selected' : ''}>NG</option>
                            </select>
                        </td>
                        <td class="text-center align-middle" style="padding: 2px !important;">
                            <select class="form-select form-select-sm fw-bold qc-select-compact ${rec.visual === 'NG' ? 'bg-danger text-white' : 'bg-success text-white'} t2-visual" onchange="recalcTab2Overall(this)">
                                <option value="OK" ${rec.visual === 'OK' ? 'selected' : ''}>OK</option>
                                <option value="NG" ${rec.visual === 'NG' ? 'selected' : ''}>NG</option>
                            </select>
                        </td>
                        <td class="text-center align-middle" style="padding: 2px !important;">
                            <select class="form-select form-select-sm fw-bold qc-select-compact ${rec.dimension === 'NG' ? 'bg-danger text-white' : 'bg-success text-white'} t2-dim" onchange="recalcTab2Overall(this)">
                                <option value="OK" ${rec.dimension === 'OK' ? 'selected' : ''}>OK</option>
                                <option value="NG" ${rec.dimension === 'NG' ? 'selected' : ''}>NG</option>
                            </select>
                        </td>
                        <td class="text-center align-middle" style="padding: 2px !important;">
                            <select class="form-select form-select-sm fw-bold qc-select-compact ${rec.mechanical === 'NG' ? 'bg-danger text-white' : 'bg-success text-white'} t2-mech" onchange="recalcTab2Overall(this)">
                                <option value="OK" ${rec.mechanical === 'OK' ? 'selected' : ''}>OK</option>
                                <option value="NG" ${rec.mechanical === 'NG' ? 'selected' : ''}>NG</option>
                            </select>
                        </td>
                        <td><input type="number" min="0" class="form-control form-control-sm text-center fw-bold border-info text-info qc-num-compact t2-total" value="${total}" oninput="recalcTab2Overall(this)"></td>
                        <td><input type="number" min="0" class="form-control form-control-sm text-center fw-bold border-danger text-danger qc-num-compact t2-defect" value="${defect}" oninput="recalcTab2Overall(this)"></td>
                        <td><input type="number" class="form-control form-control-sm text-center fw-bold bg-dark text-success border-success qc-num-compact t2-good" value="${good}" readonly></td>
                        <td class="t2-overall-cell">
                            <span class="badge ${overallVal === 'NG' ? 'bg-danger fs-6 shadow' : 'bg-success shadow'} p-1 rounded-pill" style="min-width:36px;">${overallVal}</span>
                        </td>
                        <td>${imgHtml}</td>
                        <td><input type="text" class="form-control form-control-sm t2-note" value="${escapeHtml(rec.note || '')}" placeholder="Mô tả lý do lỗi..."></td>
                    `;
                        tbody.appendChild(tr);
                    });
                });
            }
        }


        function recalcTab2Overall(element) {
            let tr = element.closest('tr');
            if (!tr) return;

            let colorSel = tr.querySelector('.t2-color-chk');
            let visSel = tr.querySelector('.t2-visual');
            let dimSel = tr.querySelector('.t2-dim');
            let mechSel = tr.querySelector('.t2-mech');

            // Cập nhật đổi màu đỏ trực quan khi chọn NG
            [colorSel, visSel, dimSel, mechSel].forEach(sel => {
                if (sel) {
                    if (sel.value === 'NG') {
                        sel.classList.remove('bg-success');
                        sel.classList.add('bg-danger', 'text-white');
                    } else {
                        sel.classList.remove('bg-danger');
                        sel.classList.add('bg-success', 'text-white');
                    }
                }
            });

            let total = parseInt(tr.querySelector('.t2-total')?.value) || 0;
            let defect = parseInt(tr.querySelector('.t2-defect')?.value) || 0;
            let good = total - defect; if (good < 0) good = 0;
            let goodInput = tr.querySelector('.t2-good');
            if (goodInput) goodInput.value = good;

            let colVal = colorSel ? colorSel.value : 'OK';
            let visVal = visSel ? visSel.value : 'OK';
            let dimVal = dimSel ? dimSel.value : 'OK';
            let mechVal = mechSel ? mechSel.value : 'OK';
            let defectRatio = total > 0 ? (defect / total) : 0;
            let isNGByRatio = defectRatio > 0.20;
            let isNG = (colVal === 'NG' || visVal === 'NG' || dimVal === 'NG' || mechVal === 'NG' || isNGByRatio || defect > 0);

            let overallCell = tr.querySelector('.t2-overall-cell');
            if (overallCell) {
                overallCell.innerHTML = `<span class="badge ${isNG ? 'bg-danger fs-6 shadow' : 'bg-success shadow'} p-1 rounded-pill" style="min-width:36px;">${isNG ? 'NG' : 'OK'}</span>`;
            }
        }


        async function saveTab2Data() {
            if (!checkAuthOrAlert()) return;
            let date = document.getElementById('tab2Date').value;
            if (!date) return;

            // 1. TẢI DỮ LIỆU CLOUD MỚI NHẤT ĐỂ BẢO VỆ CHỐNG GHI ĐÈ / MẤT DỮ LIỆU TỪ MÁY KHÁC
            let cloudData = {};
            if (isConnected && db) {
                try {
                    let snap = await db.ref(`qc_tab2_store_v1/${date}`).once('value');
                    cloudData = snap.val() || {};
                } catch(e) { console.warn("Lỗi tải cloud snapshot:", e); }
            }

            // Hợp nhất dữ liệu hiện có trong bộ nhớ và cloud làm nền tảng (Base)
            let dayData = { ...cloudData, ...(tab2Store[date] || {}) };

            // 2. Lưu tên QC theo ca phân biệt Xưởng 1 (M1 - M10) và Xưởng 2 (M11 - M21)
            ['Ca Ngày', 'Ca Đêm'].forEach(shift => {
                // Xưởng 1 (M1 - M10)
                let inputX1 = document.querySelector(`.t2-shift-inspector[data-shift="${shift}"][data-workshop="XUONG1"]`);
                if (inputX1) {
                    let valX1 = inputX1.value.trim();
                    dayData[`${shift}_XUONG1_inspector`] = valX1;
                    for (let m = 1; m <= 10; m++) {
                        dayData[`M${m}_${shift}_inspector`] = valX1;
                    }
                }

                // Xưởng 2 (M11 - M21)
                let inputX2 = document.querySelector(`.t2-shift-inspector[data-shift="${shift}"][data-workshop="XUONG2"]`);
                if (inputX2) {
                    let valX2 = inputX2.value.trim();
                    dayData[`${shift}_XUONG2_inspector`] = valX2;
                    for (let m = 11; m <= TOTAL_MACHINES; m++) {
                        dayData[`M${m}_${shift}_inspector`] = valX2;
                    }
                }
            });

            // 3. Quét các dòng đang hiển thị trên giao diện và ghi đè những ô người dùng vừa chỉnh sửa
            let rows = document.querySelectorAll('#tab2Tbody tr');
            rows.forEach(tr => {
                let moldEl = tr.querySelector('.t2-mold');
                if (moldEl) {
                    let key = moldEl.getAttribute('data-key');
                    if (!key) return;
                    let existingRowData = dayData[key] || {};
                    let moldVal = moldEl.value.trim();
                    let colChk = tr.querySelector('.t2-color-chk') ? tr.querySelector('.t2-color-chk').value : (existingRowData.colorCheck || 'OK');
                    let vis = tr.querySelector('.t2-visual') ? tr.querySelector('.t2-visual').value : (existingRowData.visual || 'OK');
                    let dim = tr.querySelector('.t2-dim') ? tr.querySelector('.t2-dim').value : (existingRowData.dimension || 'OK');
                    let mech = tr.querySelector('.t2-mech') ? tr.querySelector('.t2-mech').value : (existingRowData.mechanical || 'OK');
                    let total = tr.querySelector('.t2-total') ? (parseInt(tr.querySelector('.t2-total').value) || 0) : (existingRowData.totalCheck || 0);
                    let defect = tr.querySelector('.t2-defect') ? (parseInt(tr.querySelector('.t2-defect').value) || 0) : (existingRowData.defectCheck || 0);
                    let good = total - defect; if (good < 0) good = 0;
                    let note = tr.querySelector('.t2-note') ? tr.querySelector('.t2-note').value.trim() : (existingRowData.note || '');

                    let defectRatio = total > 0 ? (defect / total) : 0;
                    let isNGByRatio = defectRatio > 0.20;
                    let isNG = (colChk === 'NG' || vis === 'NG' || dim === 'NG' || mech === 'NG' || isNGByRatio || defect > 0);

                    dayData[key] = { 
                        ...existingRowData,
                        moldId: moldVal, 
                        colorCheck: colChk, 
                        visual: vis, 
                        dimension: dim, 
                        mechanical: mech, 
                        totalCheck: total, 
                        defectCheck: defect, 
                        goodCheck: good, 
                        overall: isNG ? 'NG' : 'OK', 
                        note: note
                    };
                }
            });

            tab2Store[date] = dayData;

            // 4. Thu thập các điểm lỗi NG của Tab 2 để gửi cảnh báo Zalo
            let ngItemsTab2 = [];
            Object.keys(dayData).forEach(key => {
                if (key.endsWith('_inspector')) return;
                let rec = dayData[key] || {};
                let total = parseInt(rec.totalCheck) || 0;
                let defect = parseInt(rec.defectCheck) || 0;
                let defectRatio = total > 0 ? (defect / total) : 0;
                let isNG = (rec.overall === 'NG' || defectRatio > 0.20 || defect > 0);

                if (isNG && rec.moldId) {
                    let p = key.split('_'); // M1, Ca Ngày, 07:30
                    let mTag = p[0];
                    let shiftTag = p[1] || 'Ca Ngày';
                    let slotTag = p[2] || '';
                    
                    let ngTypes = [];
                    if (rec.colorCheck === 'NG') ngTypes.push('Màu sắc');
                    if (rec.visual === 'NG') ngTypes.push('Ngoại quan');
                    if (rec.dimension === 'NG') ngTypes.push('Kích thước');
                    if (rec.mechanical === 'NG') ngTypes.push('Lắp ráp');
                    let ngTypeStr = ngTypes.length > 0 ? ngTypes.join(', ') : 'Mẫu lỗi / Ngoại quan';

                    let ratioStr = total > 0 ? `${defect}/${total} SP (${(defectRatio * 100).toFixed(0)}%)` : (defect > 0 ? `${defect} SP` : 'NG');
                    let photoLink = rec.driveUrl || (tab3ActionNotesStore[date] && tab3ActionNotesStore[date][`T2_${key}_drive_url`]);
                    let photoTag = '';
                    if (photoLink) {
                        photoTag = `\n   📸 Link ảnh: ${photoLink}`;
                    } else if (rec.driveFile) {
                        photoTag = `\n   📸 File ảnh: ${rec.driveFile}`;
                    }

                    ngItemsTab2.push(`⚠️ ${mTag} (${shiftTag} - Khung giờ: ${slotTag}) | Khuôn: ${rec.moldId}\n   • Mẫu lỗi: ${ratioStr} | Loại lỗi: ${ngTypeStr}\n   • Lý do: ${rec.note || 'Không có ghi chú'}${photoTag}`);
                }
            });

            if (isConnected && db) {
                const savedPayload = cleanPayloadForFirebase(dayData);
                db.ref(`qc_tab2_store_v1/${date}`).set(savedPayload)
                    .then(() => {
                        acknowledgeTabInputDrafts(2, date, savedPayload);
                        if (ngItemsTab2.length > 0) {
                            let tab2Alert = `🚨 [CẢNH BÁO QC TAB 2 - KIỂM TRA SẢN PHẨM THEO KHUNG GIỜ]\n` +
                                            `📅 Ngày: ${date}\n\n` +
                                            ngItemsTab2.join('\n\n');
                            sendZaloAlert(tab2Alert, date);
                        }
                        loadAndRenderTab3();
                        alert(`🟢 Đã lưu Tab 2 an toàn & đồng bộ toàn bộ dữ liệu lên Firebase Cloud (Ảnh lưu an toàn trên Google Drive)!`);
                    })
                    .catch(err => alert("⚠️ Lỗi lưu dữ liệu: " + err.message));
            } else {
                alert("⚠️ Không thể kết nối tới Firebase Database. Vui lòng kiểm tra mạng hoặc đăng nhập lại!");
            }
        }
