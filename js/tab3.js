/**
 * QC System - Tab 3: Summary Reports & Defect Analytics
 * Xưởng Ép Nhựa Hải Tân
 */

        async function loadAndRenderTab3() {
            if (!isEditMode) return;
            let fromEl = document.getElementById('tab3FromDate'), toEl = document.getElementById('tab3ToDate');
            if (!fromEl || !toEl) return;
            let today = getTodayISO();
            if (!fromEl.value) fromEl.value = today;
            if (!toEl.value) toEl.value = today;

            let dates = getDatesInRange(fromEl.value, toEl.value);
            let tbody = document.getElementById('tab3Tbody');
            if (tbody && tbody.children.length === 0) {
                tbody.innerHTML = `<tr><td colspan="12" class="text-center text-info py-4 fw-bold">⌛ Đang tải dữ liệu kiểm tra lỗi...</td></tr>`;
            }

            if (isConnected && db) {
                let promises = [];
                dates.forEach(d => {
                    if (!tab1Store[d]) promises.push(db.ref(`qc_tab1_store_v1/${d}`).once('value').then(s => tab1Store[d] = s.val() || {}));
                    if (!tab2Store[d]) promises.push(db.ref(`qc_tab2_store_v1/${d}`).once('value').then(s => tab2Store[d] = s.val() || {}));
                    if (!tab3ActionNotesStore[d]) promises.push(db.ref(`qc_tab3_actions_v1/${d}`).once('value').then(s => tab3ActionNotesStore[d] = s.val() || {}));
                });
                promises.push(qcEnsureDefectMemory());
                if (typeof rvLoadDates === 'function') promises.push(rvLoadDates(dates));
                if (promises.length > 0) await Promise.all(promises);
            }
            debouncedRenderTab3();
        }


        function renderTab3() {
            if (!isEditMode) return;
            let fromEl = document.getElementById('tab3FromDate'), toEl = document.getElementById('tab3ToDate');
            if (!fromEl || !toEl) return;

            let dates = getDatesInRange(fromEl.value, toEl.value);
            let filterSource = document.getElementById('tab3FilterSource') ? document.getElementById('tab3FilterSource').value : 'ALL';
            let tbody = document.getElementById('tab3Tbody');
            if (!tbody) return;

            let defectList = [], countTab1 = 0, countTab2 = 0, totalDefectPcs = 0;
            let allDefects = [];

            // Thu thập lỗi Tab 1 + Tab 2 (dùng chung với bộ nhớ lỗi lặp lại)
            dates.forEach(date => allDefects.push(...qcThuThapLoiTheoNgay(date)));
            // Ghi các lỗi vừa tải vào bộ nhớ để nhận diện lặp lại về sau
            tab3LastAllDefects = allDefects;
            qcDongBoBoNho(dates, allDefects);

            allDefects.forEach(item => {
                if (tab3WorkshopFilter !== 'ALL' && item.ws !== tab3WorkshopFilter) return;
                if (tab3ShiftFilter === 'NGAY' && !item.isDay) return;
                if (tab3ShiftFilter === 'DEM' && item.isDay) return;
                if (item.source === 'TAB1') countTab1++;
                else if (item.source === 'TAB2') { countTab2++; totalDefectPcs += item.defectQty; }
                defectList.push(item);
            });

            document.getElementById('kpiTotalDefects').innerText = defectList.length;
            document.getElementById('kpiTab1Defects').innerText = countTab1;
            document.getElementById('kpiTab2Defects').innerText = countTab2;
            document.getElementById('kpiTotalDefectPcs').innerText = totalDefectPcs;

            // Cập nhật biểu đồ thống kê các loại lỗi & số lượng lỗi Tab 2 theo ngày đã chọn
            renderTab2DefectCharts(dates);

            let displayList = defectList.filter(item => {
                if (filterSource === 'TAB1') return item.source === 'TAB1';
                if (filterSource === 'TAB2') return item.source === 'TAB2';
                if (filterSource === 'TRAVE') return item.source === 'TRAVE';
                if (filterSource === 'TRAVE_CDS') return item.source === 'TRAVE' && item.nguon !== 'KH';
                if (filterSource === 'TRAVE_KH') return item.source === 'TRAVE' && item.nguon === 'KH';
                return true;
            });

            tab3LastDisplayList = displayList;
            let qcPool = qcPoolHienTai();
            tbody.innerHTML = "";
            if (displayList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-success fw-bold">🎉 Không ghi nhận lỗi phát sinh nào từ ${fromEl.value} đến ${toEl.value}! Tất cả đều ĐẠT.</td></tr>`;
                return;
            }

            displayList.forEach((item, index) => {
                let tr = document.createElement('tr');
                let lapLaiInfo = qcPhanTichLapLai(item, qcPool);
                if (lapLaiInfo.lapLai) tr.classList.add('qc-row-lap-lai');
                let badgeSource = item.source === 'TAB1' ? `<span class="badge bg-warning text-dark fw-bold">⚙️ Tab 1</span>`
                    : item.source === 'TRAVE' ? (item.nguon === 'KH' ? `<span class="badge bg-danger fw-bold">🚚 KH trả về</span>` : `<span class="badge bg-warning text-dark fw-bold">↩️ CĐ sau trả</span>`)
                    : `<span class="badge bg-info text-dark fw-bold">📋 Tab 2</span>`;
                let actionsData = tab3ActionNotesStore[item.date] || {};
                let t1Data = tab1Store[item.date] || {};
                let t2Data = tab2Store[item.date] || {};
                let rawKey = item.key.startsWith('T1_') ? item.key.replace('T1_', '') : (item.key.startsWith('T2_') ? item.key.replace('T2_', '') : item.key);
                let sourceRec = item.source === 'TAB1' ? (t1Data[rawKey] || {}) : (t2Data[rawKey] || {});
                
                let imgUrl = actionsData[`${item.key}_img`] || sourceRec.img || '';
                let driveUrl = actionsData[`${item.key}_drive_url`] || sourceRec.driveUrl || '';
                let driveFile = actionsData[`${item.key}_drive_file`] || sourceRec.driveFile || '';
                let titleText = `${item.source === 'TAB1' ? 'Tab 1: ' : item.source === 'TRAVE' ? 'Trả về: ' : 'Tab 2: '} ${item.machine} (${item.shiftTime}) - Khuôn: ${item.moldId || '-'}`;
                let imgHtml = '';

                if (imgUrl) {
                    imgHtml = `
                    <div class="d-flex align-items-center justify-content-center gap-1 mt-1">
                        <img src="${escapeHtml(imgUrl)}" class="rounded border border-info shadow-sm" style="width:34px; height:34px; object-fit:cover; cursor:pointer;" onclick="previewDefectImage('${escapeHtml(imgUrl)}', '${escapeHtml(titleText)}')" title="Bấm để xem ảnh trực tiếp">
                        <div class="btn-group btn-group-sm">
                            <button type="button" class="btn btn-xs btn-outline-info py-0 px-1" style="font-size:10px;" onclick="previewDefectImage('${escapeHtml(imgUrl)}', '${escapeHtml(titleText)}')" title="Xem ảnh lớn">🔍</button>
                            <label class="btn btn-xs btn-outline-warning py-0 px-1 m-0" style="font-size:10px; cursor:pointer;" title="Đổi ảnh">
                                🔄<input type="file" accept="image/*" style="display:none;" onchange="handleDefectImageUpload(this, '${escapeHtml(item.date)}', '${escapeHtml(item.key)}', '${escapeHtml(item.machine)}', '${escapeHtml(item.moldId)}')">
                            </label>
                            <button type="button" class="btn btn-xs btn-outline-danger py-0 px-1" style="font-size:10px;" onclick="removeDefectImage('${escapeHtml(item.date)}', '${escapeHtml(item.key)}')" title="Xóa ảnh">🗑️</button>
                        </div>
                    </div>`;
                } else if (driveUrl || driveFile) {
                    let viewTarget = driveUrl || driveFile;
                    imgHtml = `
                    <div class="d-flex align-items-center justify-content-center gap-1 mt-1">
                        <button type="button" class="btn btn-xs btn-3d-primary rounded-pill py-0 px-2 shadow-sm" style="font-size:10.5px;" onclick="previewDefectImage('${escapeHtml(viewTarget)}', '${escapeHtml(titleText)}')" title="Bấm để xem ảnh lỗi chi tiết">
                            🖼️ Xem Ảnh
                        </button>
                        <div class="btn-group btn-group-sm">
                            <label class="btn btn-xs btn-outline-warning py-0 px-1 m-0" style="font-size:10px; cursor:pointer;" title="Tải ảnh mới / Đổi ảnh">
                                🔄<input type="file" accept="image/*" style="display:none;" onchange="handleDefectImageUpload(this, '${escapeHtml(item.date)}', '${escapeHtml(item.key)}', '${escapeHtml(item.machine)}', '${escapeHtml(item.moldId)}')">
                            </label>
                            <button type="button" class="btn btn-xs btn-outline-danger py-0 px-1" style="font-size:10px;" onclick="removeDefectImage('${escapeHtml(item.date)}', '${escapeHtml(item.key)}')" title="Xóa ảnh">🗑️</button>
                        </div>
                    </div>`;
                } else {
                    imgHtml = `
                    <div class="mt-1">
                        <label class="btn btn-xs btn-outline-info rounded-pill py-0 px-2 shadow-sm" style="font-size:10.5px; cursor:pointer;" title="Chụp / Tải ảnh lỗi">
                            📸 Tải Ảnh (Drive)
                            <input type="file" accept="image/*" style="display:none;" onchange="handleDefectImageUpload(this, '${escapeHtml(item.date)}', '${escapeHtml(item.key)}', '${escapeHtml(item.machine)}', '${escapeHtml(item.moldId)}')">
                        </label>
                    </div>`;
                }

                tr.innerHTML = `
                <td class="fw-bold sticky-col">${index + 1}</td>
                <td class="fw-bold text-info small">${escapeHtml(item.date)}</td>
                <td>${badgeSource}</td>
                <td class="fw-bold text-info">${escapeHtml(item.machine)}</td>
                <td class="small fw-semibold">${escapeHtml(item.shiftTime)}</td>
                <td class="text-info fw-bold small">${escapeHtml(item.inspector || '-')}</td>
                <td class="fw-bold text-warning">${escapeHtml(item.moldId || 'Chưa rõ')}</td>
                <td class="text-danger fw-bold small text-start">
                    <div>${escapeHtml(item.category)}</div>
                    ${imgHtml}
                </td>
                <td class="fw-bold text-danger fs-6">${item.defectQty > 0 ? item.defectQty : '-'}</td>
                <td class="text-start small fw-bold t3-desc-cell">${escapeHtml(item.description)}</td>
                <td class="qc-lap-cell">${qcHtmlLapLai(item, lapLaiInfo)}</td>
                <td class="qc-4m-cell">${qcHtmlDoiSach(item, lapLaiInfo, index)}</td>
            `;
                tbody.appendChild(tr);
            });
        }


        function setTab3WorkshopFilter(ws) {
            tab3WorkshopFilter = ws;
            const btnAll = document.getElementById('btnT3WsAll');
            const btnX1 = document.getElementById('btnT3WsX1');
            const btnX2 = document.getElementById('btnT3WsX2');
            if (btnAll) btnAll.className = ws === 'ALL' ? 'btn btn-sm btn-3d-primary rounded-pill px-2 py-1' : 'btn btn-sm btn-outline-info rounded-pill px-2 py-1';
            if (btnX1) btnX1.className = ws === 'XUONG1' ? 'btn btn-sm btn-3d-primary rounded-pill px-2 py-1' : 'btn btn-sm btn-outline-info rounded-pill px-2 py-1';
            if (btnX2) btnX2.className = ws === 'XUONG2' ? 'btn btn-sm btn-3d-primary rounded-pill px-2 py-1' : 'btn btn-sm btn-outline-info rounded-pill px-2 py-1';
            renderTab3();
        }


        function setTab3ShiftFilter(shift) {
            tab3ShiftFilter = shift;
            const btnAll = document.getElementById('btnT3ShiftAll');
            const btnDay = document.getElementById('btnT3ShiftDay');
            const btnNight = document.getElementById('btnT3ShiftNight');
            if (btnAll) btnAll.className = shift === 'ALL' ? 'btn btn-sm btn-3d-primary rounded-pill px-2 py-1' : 'btn btn-sm btn-outline-info rounded-pill px-2 py-1';
            if (btnDay) btnDay.className = shift === 'NGAY' ? 'btn btn-sm btn-warning text-dark fw-bold rounded-pill px-2 py-1' : 'btn btn-sm btn-outline-warning rounded-pill px-2 py-1';
            if (btnNight) btnNight.className = shift === 'DEM' ? 'btn btn-sm btn-info text-dark fw-bold rounded-pill px-2 py-1' : 'btn btn-sm btn-outline-info rounded-pill px-2 py-1';
            renderTab3();
        }


        // Backward compatibility
        function setTab2ChartWsFilter(ws) { setTab3WorkshopFilter(ws); }


        function setTab2ChartShiftFilter(shift) { setTab3ShiftFilter(shift); }


        function calcTab2DefectAnalytics(targetDates) {
            let wsFilter = tab3WorkshopFilter;
            let shiftFilter = tab3ShiftFilter;

            let totalChecked = 0;
            let totalDefects = 0;
            let ngEntriesCount = 0;

            // 6 LOẠI LỖI TIÊU CHUẨN ÉP NHỰA
            let categories = {
                visual: 0,      // 1. Ngoại quan (Bavia, vết trầy, đốm đen, cháy, bẩn...)
                dimension: 0,   // 2. Kích thước (Dày/mỏng, dài/ngắn, dung sai...)
                color: 0,       // 3. Màu sắc (Sai màu, loang màu, lẫn hạt...)
                mechanical: 0,  // 4. Lắp ráp (Kẹt ngàm, hở, lệch khớp...)
                deformation: 0, // 5. Co rút / Cong vênh (Biến dạng, lõm bề mặt, rỗ khí...)
                ratio20: 0      // 6. Tỷ lệ lỗi > 20% (Phế phẩm hàng loạt)
            };

            // THỐNG KÊ ĐẦY ĐỦ TẤT CẢ CÁC LÝ DO LỖI (KHÔNG BỎ SÓT BẤT KỲ LÝ DO NÀO)
            let reasonsCount = {};
            let reasonsMachinesMap = {};

            let machinesData = {};
            for (let m = 1; m <= TOTAL_MACHINES; m++) {
                machinesData[`M${m}`] = {
                    machine: `M${m}`,
                    machineNum: m,
                    workshop: (m <= 10) ? 'XUONG1' : 'XUONG2',
                    defectQty: 0,
                    checkedQty: 0,
                    ngOccurrences: 0,
                    molds: new Set()
                };
            }

            let allSlots = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'];
            let slotsData = {};
            allSlots.forEach(s => {
                slotsData[s] = { slot: s, defectQty: 0, isDay: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'].includes(s) };
            });

            targetDates.forEach(d => {
                let dayData = tab2Store[d] || {};
                Object.keys(dayData).forEach(key => {
                    if (key.endsWith('_inspector')) return;
                    let parts = key.split('_');
                    if (parts.length < 3) return;
                    let mStr = parts[0];
                    let mNum = parseInt(mStr.replace('M', '')) || 0;
                    if (mNum < 1 || mNum > TOTAL_MACHINES) return;

                    let ws = (mNum <= 10) ? 'XUONG1' : 'XUONG2';
                    if (wsFilter !== 'ALL' && ws !== wsFilter) return;

                    let shiftStr = parts[1] || '';
                    let isDayShift = shiftStr.includes('Ngày');
                    if (shiftFilter === 'NGAY' && !isDayShift) return;
                    if (shiftFilter === 'DEM' && isDayShift) return;

                    let slotStr = parts[2] || '';
                    let rec = dayData[key] || {};
                    let t = parseInt(rec.totalCheck) || 0;
                    let df = parseInt(rec.defectCheck) || 0;
                    totalChecked += t;
                    totalDefects += df;

                    let defectRatio = t > 0 ? (df / t) : 0;
                    let isNGByRatio = defectRatio > 0.20;
                    let hasDefect = rec.overall === 'NG' || df > 0 || isNGByRatio ||
                                    rec.colorCheck === 'NG' || rec.visual === 'NG' ||
                                    rec.dimension === 'NG' || rec.mechanical === 'NG';

                    machinesData[mStr].checkedQty += t;
                    machinesData[mStr].defectQty += df;
                    if (rec.moldId) machinesData[mStr].molds.add(rec.moldId);

                    if (slotsData[slotStr]) {
                        slotsData[slotStr].defectQty += df;
                    }

                    if (hasDefect) {
                        ngEntriesCount++;
                        machinesData[mStr].ngOccurrences++;

                        let noteLower = (rec.note || '').toLowerCase();
                        let isDeform = /co rút|lõm|hút mặt|sink|cong|vênh|méo|biến dạng|bọt|khí/i.test(noteLower);

                        let matchedCategory = false;
                        if (isDeform) { categories.deformation++; matchedCategory = true; }
                        if (rec.colorCheck === 'NG') { categories.color++; matchedCategory = true; }
                        if (rec.visual === 'NG') {
                            if (!isDeform) categories.visual++;
                            matchedCategory = true;
                        }
                        if (rec.dimension === 'NG') { categories.dimension++; matchedCategory = true; }
                        if (rec.mechanical === 'NG') { categories.mechanical++; matchedCategory = true; }
                        if (isNGByRatio) { categories.ratio20++; matchedCategory = true; }
                        if (!matchedCategory && df > 0) {
                            if (isDeform) categories.deformation++;
                            else categories.visual++;
                        }

                        // BÓC TÁCH ĐẦY ĐỦ TẤT CẢ CÁC NGUYÊN NHÂN LỖI TỪ GHI CHÚ VÀ HẠNG MỤC
                        let rawNote = (rec.note || '').trim();
                        if (rawNote) {
                            let subReasons = rawNote.split(/[,;+/\n&]|\s+và\s+/i).map(s => s.trim()).filter(s => s.length > 0);
                            if (subReasons.length === 0) subReasons = [rawNote];

                            subReasons.forEach(sub => {
                                let subLower = sub.toLowerCase();
                                let canonicalName = '';

                                if (/bavia|ba vớ|dư nhựa|bè/i.test(subLower)) canonicalName = 'Bavia / Ba vớ';
                                else if (/co rút|lõm|hút mặt|sink/i.test(subLower)) canonicalName = 'Co rút / Lõm bề mặt';
                                else if (/cong|vênh|méo|biến dạng/i.test(subLower)) canonicalName = 'Cong vênh / Biến dạng';
                                else if (/đốm đen|cháy|vết đen|black/i.test(subLower)) canonicalName = 'Đốm đen / Cháy nhựa';
                                else if (/trầy|xước|scratch/i.test(subLower)) canonicalName = 'Trầy xước bề mặt';
                                else if (/thiếu|hụt|short/i.test(subLower)) canonicalName = 'Thiếu thịt / Hụt liệu';
                                else if (/dầu|bẩn|ố|nhớt/i.test(subLower)) canonicalName = 'Dính dầu / Vết bẩn';
                                else if (/sai màu|loang|đổi màu/i.test(subLower)) canonicalName = 'Sai màu / Loang màu';
                                else if (/bọt|khí|gas/i.test(subLower)) canonicalName = 'Bọt khí / Rỗ khí';
                                else if (/nứt|gãy/i.test(subLower)) canonicalName = 'Nứt / Gãy chi tiết';
                                else if (/kích thước|size|dày|mỏng|dài|ngắn/i.test(subLower)) canonicalName = 'Sai lệch kích thước';
                                else if (/lắp ráp|kẹt|hở|khớp/i.test(subLower)) canonicalName = 'Lỗi lắp ráp / Kẹt ngàm';
                                else {
                                    canonicalName = sub.charAt(0).toUpperCase() + sub.slice(1);
                                }

                                reasonsCount[canonicalName] = (reasonsCount[canonicalName] || 0) + 1;
                                if (!reasonsMachinesMap[canonicalName]) reasonsMachinesMap[canonicalName] = new Set();
                                reasonsMachinesMap[canonicalName].add(mStr);
                            });
                        } else {
                            let autoReasons = [];
                            if (rec.visual === 'NG') autoReasons.push('Lỗi Ngoại quan (chưa ghi rõ)');
                            if (rec.colorCheck === 'NG') autoReasons.push('Lỗi Màu sắc');
                            if (rec.dimension === 'NG') autoReasons.push('Lỗi Kích thước');
                            if (rec.mechanical === 'NG') autoReasons.push('Lỗi Lắp ráp');
                            if (isNGByRatio) autoReasons.push('Tỷ lệ lỗi mẫu > 20%');
                            if (autoReasons.length === 0 && df > 0) autoReasons.push('Lỗi mẫu định kỳ');

                            autoReasons.forEach(rName => {
                                reasonsCount[rName] = (reasonsCount[rName] || 0) + 1;
                                if (!reasonsMachinesMap[rName]) reasonsMachinesMap[rName] = new Set();
                                reasonsMachinesMap[rName].add(mStr);
                            });
                        }
                    }
                });
            });

            return {
                totalChecked,
                totalDefects,
                ngEntriesCount,
                defectRatio: totalChecked > 0 ? ((totalDefects / totalChecked) * 100).toFixed(1) : '0.0',
                categories,
                reasonsCount,
                reasonsMachinesMap,
                machinesData,
                slotsData
            };
        }


        function renderTab2DefectCharts(providedDates) {
            if (typeof Chart === 'undefined') {
                console.warn("Thư viện Chart.js chưa được tải!");
                return;
            }

            let fromEl = document.getElementById('tab3FromDate');
            let toEl = document.getElementById('tab3ToDate');
            let dates = providedDates || (fromEl && toEl ? getDatesInRange(fromEl.value, toEl.value) : [getTodayISO()]);
            if (!dates || dates.length === 0) dates = [getTodayISO()];

            // Cập nhật badge hiển thị ngày phân tích theo ngày chọn trên đầu
            let badgeEl = document.getElementById('t2ChartDateBadge');
            if (badgeEl) {
                let fromVal = fromEl ? fromEl.value : (dates[0] || getTodayISO());
                let toVal = toEl ? toEl.value : (dates[dates.length - 1] || fromVal);
                if (fromVal === toVal) {
                    badgeEl.innerText = `📅 Ngày: ${fromVal}`;
                } else {
                    badgeEl.innerText = `📅 Từ: ${fromVal} ➔ ${toVal} (${dates.length} ngày)`;
                }
            }

            // Cập nhật badge phạm vi xưởng và ca theo bộ lọc trên đầu
            let scopeBadgeEl = document.getElementById('t2ChartScopeBadge');
            if (scopeBadgeEl) {
                let wsText = tab3WorkshopFilter === 'XUONG1' ? '🏭 Xưởng 2 (M1-10)' : (tab3WorkshopFilter === 'XUONG2' ? '🏭 Xưởng 1 (M11-21)' : '🌐 Toàn Xưởng');
                let shiftText = tab3ShiftFilter === 'NGAY' ? '☀️ Ca Ngày' : (tab3ShiftFilter === 'DEM' ? '🌙 Ca Đêm' : '☀️🌙 Cả Ca');
                scopeBadgeEl.innerText = `${wsText} | ${shiftText}`;
            }

            // Tính toán số liệu phân tích trực tiếp theo ngày và bộ lọc trên đầu
            let stats = calcTab2DefectAnalytics(dates);

            // Cập nhật Mini KPI
            let kpiChecked = document.getElementById('t2KpiTotalChecked');
            let kpiDefects = document.getElementById('t2KpiTotalDefects');
            let kpiRatio = document.getElementById('t2KpiDefectRatio');
            let kpiTopM = document.getElementById('t2KpiTopMachine');

            if (kpiChecked) kpiChecked.innerHTML = `${stats.totalChecked.toLocaleString()} <span class="small fw-normal opacity-75" style="font-size:11px;">SP</span>`;
            if (kpiDefects) kpiDefects.innerHTML = `${stats.totalDefects.toLocaleString()} <span class="small fw-normal opacity-75" style="font-size:11px;">SP</span>`;
            if (kpiRatio) kpiRatio.innerText = `${stats.defectRatio}%`;

            // Tìm máy lỗi nhiều nhất
            let maxDefect = 0, topMachineName = 'Không có lỗi';
            Object.values(stats.machinesData).forEach(m => {
                if (m.defectQty > maxDefect) {
                    maxDefect = m.defectQty;
                    topMachineName = `${m.machine} (${m.defectQty} SP lỗi)`;
                }
            });
            if (kpiTopM) kpiTopM.innerText = maxDefect > 0 ? topMachineName : '🎉 Không có lỗi';

            // Hiển thị alert nếu 100% OK
            let alertEl = document.getElementById('tab2ChartsEmptyAlert');
            if (alertEl) {
                if (stats.totalDefects === 0 && stats.ngEntriesCount === 0) {
                    alertEl.classList.remove('d-none');
                } else {
                    alertEl.classList.add('d-none');
                }
            }

            // Thiết lập cấu hình chung Chart.js Dark/Light Mode - Tối ưu tương phản cao để chụp ảnh báo cáo
            const isLightMode = (document.documentElement.getAttribute('data-theme') === 'light');
            Chart.defaults.color = isLightMode ? '#44403c' : '#cbd5e1';
            Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
            const chartGridColor = isLightMode ? 'rgba(68, 64, 60, 0.1)' : 'rgba(255, 255, 255, 0.08)';
            const chartTickMuted = isLightMode ? '#57534e' : '#94a3b8';
            const chartTickText = isLightMode ? '#1c1917' : '#f1f5f9';
            const chartTooltipBg = isLightMode ? 'rgba(28, 25, 23, 0.95)' : 'rgba(11, 19, 41, 0.95)';
            const chartTooltipBorder = isLightMode ? '#0284c7' : '#38bdf8';
            const chartDoughnutBorder = isLightMode ? '#fffdfa' : '#0b1329';

            // =============================================================
            // BIỂU ĐỒ 1: CƠ CẤU 6 LOẠI LỖI (HIỆN SỐ LIỆU VÀO TRONG VÒNG TRÒN)
            // =============================================================
            let ctxCat = document.getElementById('chartTab2Categories');
            if (ctxCat) {
                if (chartTab2CategoriesInst) {
                    chartTab2CategoriesInst.destroy();
                    chartTab2CategoriesInst = null;
                }

                let catLabels = [
                    '🔍 Ngoại Quan',
                    '📏 Kích Thước',
                    '🎨 Màu Sắc',
                    '⚙️ Lắp Ráp',
                    '📐 Co Rút / Vênh',
                    '⚠️ Lỗi > 20%'
                ];
                let catData = [
                    stats.categories.visual,
                    stats.categories.dimension,
                    stats.categories.color,
                    stats.categories.mechanical,
                    stats.categories.deformation,
                    stats.categories.ratio20
                ];
                let catColors = [
                    '#f43f5e', // Rose Red (Ngoại quan - siêu nổi bật)
                    '#0ea5e9', // Sky Blue (Kích thước)
                    '#f59e0b', // Bright Amber (Màu sắc)
                    '#8b5cf6', // Violet Purple (Lắp ráp)
                    '#ec4899', // Hot Pink (Co rút / Cong vênh)
                    '#ef4444'  // Vivid Red (Lỗi > 20%)
                ];

                let totalCatNG = catData.reduce((a, b) => a + b, 0);

                // PLUGIN HIỂN THỊ SỐ LIỆU VÀO TRONG VÒNG TRÒN (TÂM VÒNG TRÒN & TRÊN TỪNG LÁT CẮT)
                const doughnutLabelsInsidePlugin = {
                    id: 'doughnutLabelsInsidePlugin',
                    afterDatasetsDraw(chart) {
                        const { ctx } = chart;
                        const meta = chart.getDatasetMeta(0);
                        if (!meta || !meta.data || meta.data.length === 0) return;

                        // 1. Vẽ số liệu lớn ở TÂM VÒNG TRÒN
                        const firstArc = meta.data[0];
                        if (firstArc) {
                            const centerX = firstArc.x;
                            const centerY = firstArc.y;
                            ctx.save();
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';

                            ctx.font = '800 24px "Plus Jakarta Sans", sans-serif';
                            ctx.fillStyle = totalCatNG > 0 ? (isLightMode ? '#dc2626' : '#f43f5e') : (isLightMode ? '#15803d' : '#10b981');
                            ctx.fillText(totalCatNG, centerX, centerY - 9);

                            ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
                            ctx.fillStyle = isLightMode ? '#0284c7' : '#38bdf8';
                            ctx.fillText(totalCatNG > 0 ? 'LƯỢT LỖI' : 'OK 100%', centerX, centerY + 13);
                            ctx.restore();
                        }

                        // 2. Vẽ số liệu TRỰC TIẾP VÀO TRONG TỪNG LÁT CẮT
                        if (totalCatNG > 0) {
                            meta.data.forEach((arc, idx) => {
                                const val = catData[idx];
                                if (!val || val === 0) return;

                                const angleSpan = arc.endAngle - arc.startAngle;
                                if (angleSpan < 0.20) return; // Lát cắt quá hẹp bỏ qua để không đè chữ

                                const angle = (arc.startAngle + arc.endAngle) / 2;
                                const r = (arc.innerRadius + arc.outerRadius) / 2;
                                const x = arc.x + Math.cos(angle) * r;
                                const y = arc.y + Math.sin(angle) * r;
                                const pct = ((val / totalCatNG) * 100).toFixed(0);

                                ctx.save();
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                ctx.fillStyle = '#ffffff';
                                ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
                                ctx.shadowBlur = 4;

                                if (angleSpan > 0.45) {
                                    ctx.font = '800 12px "Plus Jakarta Sans", sans-serif';
                                    ctx.fillText(val, x, y - 5);
                                    ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
                                    ctx.fillText(`${pct}%`, x, y + 7);
                                } else {
                                    ctx.font = '800 11px "Plus Jakarta Sans", sans-serif';
                                    ctx.fillText(`${val}`, x, y);
                                }
                                ctx.restore();
                            });
                        }
                    }
                };

                chartTab2CategoriesInst = new Chart(ctxCat, {
                    type: 'doughnut',
                    data: {
                        labels: catLabels,
                        datasets: [{
                            data: totalCatNG > 0 ? catData : [1],
                            backgroundColor: totalCatNG > 0 ? catColors : ['rgba(148, 163, 184, 0.2)'],
                            borderColor: chartDoughnutBorder,
                            borderWidth: 2,
                            hoverOffset: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '60%',
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: chartTooltipBg,
                                borderColor: chartTooltipBorder,
                                borderWidth: 1,
                                padding: 10,
                                callbacks: {
                                    label: function(ctx) {
                                        if (totalCatNG === 0) return ' Không có lỗi nào';
                                        let v = ctx.raw || 0;
                                        let pct = ((v / totalCatNG) * 100).toFixed(1);
                                        return ` ${ctx.label}: ${v} lượt (${pct}%)`;
                                    }
                                }
                            }
                        }
                    },
                    plugins: [doughnutLabelsInsidePlugin]
                });

                // Render custom legend
                let legendEl = document.getElementById('chartTab2CategoriesLegend');
                if (legendEl) {
                    if (totalCatNG === 0) {
                        legendEl.innerHTML = `<span class="badge bg-success bg-opacity-25 text-success border border-success border-opacity-25 py-1 px-2">Đạt 100% - Không ghi nhận lỗi</span>`;
                    } else {
                        legendEl.innerHTML = catLabels.map((lbl, idx) => {
                            let count = catData[idx];
                            let pct = totalCatNG > 0 ? ((count / totalCatNG) * 100).toFixed(0) : 0;
                            let pillBg = isLightMode ? '#ffffff' : 'rgba(15, 28, 63, 0.85)';
                            let pillBorder = isLightMode ? '#cbd5e1' : 'rgba(255,255,255,0.15)';
                            let labelColor = isLightMode ? '#475569' : '#cbd5e1';
                            let valColor = isLightMode ? '#0f172a' : '#ffffff';
                            return `
                                <span class="d-inline-flex align-items-center gap-1 px-2 py-1 rounded-pill shadow-sm" style="background: ${pillBg}; border: 1px solid ${pillBorder};">
                                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${catColors[idx]};"></span>
                                    <span style="font-size: 11px; color: ${labelColor}; font-weight: 600;">${lbl}: <strong style="color: ${valColor}; font-weight: 800;">${count}</strong> (${pct}%)</span>
                                </span>
                            `;
                        }).join('');
                    }
                }
            }

            // =============================================================
            // BIỂU ĐỒ 2: THỐNG KÊ ĐẦY ĐỦ CÁC NGUYÊN NHÂN LỖI (HIỆN SỐ LIỆU ĐẦU CỘT)
            // =============================================================
            let ctxReasons = document.getElementById('chartTab2Reasons');
            if (ctxReasons) {
                if (chartTab2ReasonsInst) {
                    chartTab2ReasonsInst.destroy();
                    chartTab2ReasonsInst = null;
                }

                // Sắp xếp ĐẦY ĐỦ tất cả các lý do lỗi có phát sinh
                let sortedReasons = Object.entries(stats.reasonsCount)
                    .filter(([_, cnt]) => cnt > 0)
                    .sort((a, b) => b[1] - a[1]);

                let totalReasonHits = sortedReasons.reduce((sum, item) => sum + item[1], 0);

                // Cập nhật badge số loại lỗi
                let reasonBadgeEl = document.getElementById('t2ReasonCountBadge');
                if (reasonBadgeEl) {
                    reasonBadgeEl.innerText = `${sortedReasons.length} Loại Lỗi`;
                }

                // Tự động điều chỉnh chiều cao canvas để hiển thị ĐẦY ĐỦ các lý do mà không bị co ép
                let wrapperEl = document.getElementById('chartTab2ReasonsWrapper');
                if (wrapperEl) {
                    let neededH = Math.max(250, Math.min(sortedReasons.length * 30 + 45, 600));
                    wrapperEl.style.height = `${neededH}px`;
                }

                let displayReasons = sortedReasons.length > 0 ? sortedReasons : [['Không có lỗi phát sinh', 0]];
                let rLabels = displayReasons.map(item => item[0]);
                let rData = displayReasons.map(item => item[1]);
                let maxRVal = Math.max(...rData, 1);

                // PLUGIN HIỂN THỊ SỐ LIỆU NGAY ĐẦU CỘT NGANG
                const horizontalBarLabelsPlugin = {
                    id: 'horizontalBarLabelsPlugin',
                    afterDatasetsDraw(chart) {
                        const { ctx } = chart;
                        const meta = chart.getDatasetMeta(0);
                        if (!meta || !meta.data) return;

                        meta.data.forEach((bar, index) => {
                            const val = rData[index];
                            if (val !== undefined && val !== null && val > 0) {
                                const pct = totalReasonHits > 0 ? ((val / totalReasonHits) * 100).toFixed(0) : 0;
                                ctx.save();
                                ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
                                ctx.textAlign = 'left';
                                ctx.textBaseline = 'middle';
                                ctx.fillStyle = isLightMode ? '#0f172a' : '#ffffff';
                                if (!isLightMode) {
                                    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
                                    ctx.shadowBlur = 4;
                                }
                                ctx.fillText(`${val} lần (${pct}%)`, bar.x + 8, bar.y);
                                ctx.restore();
                            }
                        });
                    }
                };

                chartTab2ReasonsInst = new Chart(ctxReasons, {
                    type: 'bar',
                    data: {
                        labels: rLabels,
                        datasets: [{
                            label: 'Số lần ghi nhận',
                            data: rData,
                            backgroundColor: isLightMode ? 'rgba(225, 29, 72, 0.85)' : 'rgba(244, 63, 94, 0.9)',
                            borderColor: isLightMode ? '#e11d48' : '#f43f5e',
                            borderWidth: 1.5,
                            borderRadius: 6,
                            barThickness: 16
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: chartTooltipBg,
                                borderColor: chartTooltipBorder,
                                borderWidth: 1,
                                padding: 10,
                                callbacks: {
                                    label: function(ctx) {
                                        let v = ctx.raw || 0;
                                        let pct = totalReasonHits > 0 ? ((v / totalReasonHits) * 100).toFixed(1) : 0;
                                        return ` Tần suất: ${v} lần (${pct}%)`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                beginAtZero: true,
                                suggestedMax: Math.ceil(maxRVal * 1.25),
                                grid: { color: chartGridColor },
                                ticks: { precision: 0, color: chartTickMuted }
                            },
                            y: {
                                grid: { display: false },
                                ticks: { font: { size: 11.5, weight: '600' }, color: chartTickText }
                            }
                        }
                    },
                    plugins: [horizontalBarLabelsPlugin]
                });

                // BẢNG THỐNG KÊ CHI TIẾT ĐẦY ĐỦ TẤT CẢ CÁC LOẠI LỖI & NGUYÊN NHÂN
                let detailEl = document.getElementById('chartTab2ReasonsDetail');
                if (detailEl) {
                    if (sortedReasons.length === 0 || sortedReasons[0][1] === 0) {
                        detailEl.innerHTML = `<div class="text-center text-success small py-2 fw-bold">🎉 Không phát sinh lỗi sản phẩm nào trong ngày đã chọn.</div>`;
                    } else {
                        let rowsHtml = sortedReasons.map(([reason, count], idx) => {
                            let pct = totalReasonHits > 0 ? ((count / totalReasonHits) * 100).toFixed(1) : 0;
                            let machinesSet = stats.reasonsMachinesMap[reason] || new Set();
                            let machinesArr = Array.from(machinesSet);
                            let machinesBadge = machinesArr.length > 0
                                ? machinesArr.map(m => `<span class="badge ${isLightMode ? 'bg-light text-primary border border-primary' : 'bg-dark border border-info text-info'} me-1 px-1 py-0" style="font-size:10px;">${m}</span>`).join('')
                                : '<span class="text-muted small">-</span>';
                            return `
                                <tr>
                                    <td class="fw-bold ${isLightMode ? 'text-secondary' : 'text-muted'}">${idx + 1}</td>
                                    <td class="text-start fw-bold ${isLightMode ? 'text-primary' : 'text-warning'}">${escapeHtml(reason)}</td>
                                    <td class="fw-bold ${isLightMode ? 'text-dark' : 'text-white'} fs-6">${count}</td>
                                    <td class="${isLightMode ? 'text-danger' : 'text-info'} fw-bold">${pct}%</td>
                                    <td class="text-start">${machinesBadge}</td>
                                </tr>
                            `;
                        }).join('');

                        detailEl.innerHTML = `
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <span class="small fw-bold ${isLightMode ? 'text-dark' : 'text-light opacity-75'}">📋 Bảng Thống Kê Đầy Đủ Các Loại Lỗi & Máy Bị Ảnh Hưởng:</span>
                                <span class="badge ${isLightMode ? 'bg-primary bg-opacity-10 text-primary border border-primary' : 'bg-secondary bg-opacity-50 text-light'} small py-0 px-2" style="font-size:10px;">Tổng ${totalReasonHits} lượt lỗi</span>
                            </div>
                            <table class="table table-sm table-bordered align-middle text-center mb-0" style="font-size: 11.5px; ${isLightMode ? 'background: #ffffff;' : 'background: rgba(15, 23, 42, 0.65);'}">
                                <thead class="${isLightMode ? '' : 'table-dark text-info'}">
                                    <tr>
                                        <th style="width: 32px;">#</th>
                                        <th class="text-start">Tên Loại Lỗi / Lý Do Chi Tiết</th>
                                        <th style="width: 65px;">Số Lần</th>
                                        <th style="width: 65px;">Tỷ Lệ</th>
                                        <th class="text-start">Các Máy Phát Sinh</th>
                                    </tr>
                                </thead>
                                <tbody>${rowsHtml}</tbody>
                            </table>
                        `;
                    }
                }
            }

            // =============================================================
            // BIỂU ĐỒ 3: SỐ LƯỢNG LỖI THEO TỪNG MÁY (HIỆN SỐ LIỆU TRÊN ĐẦU CỘT)
            // =============================================================
            let ctxMachines = document.getElementById('chartTab2Machines');
            if (ctxMachines) {
                if (chartTab2MachinesInst) {
                    chartTab2MachinesInst.destroy();
                    chartTab2MachinesInst = null;
                }

                let machineKeys = Object.keys(stats.machinesData);
                let defectCounts = machineKeys.map(k => stats.machinesData[k].defectQty);
                let checkCounts = machineKeys.map(k => stats.machinesData[k].checkedQty);
                let maxMVal = Math.max(...defectCounts, 1);

                let barColors = machineKeys.map(k => {
                    let m = stats.machinesData[k];
                    if (m.defectQty > 0) return 'rgba(244, 63, 94, 0.95)';
                    if (m.workshop === 'XUONG1') return 'rgba(2, 132, 199, 0.75)';
                    return 'rgba(124, 58, 237, 0.75)';
                });

                let borderColors = machineKeys.map(k => {
                    let m = stats.machinesData[k];
                    if (m.defectQty > 0) return '#f43f5e';
                    if (m.workshop === 'XUONG1') return '#38bdf8';
                    return '#a855f7';
                });

                // PLUGIN HIỂN THỊ SỐ LIỆU ĐẦU CỘT CHO BIỂU ĐỒ MÁY
                const machineBarLabelsPlugin = {
                    id: 'machineBarLabelsPlugin',
                    afterDatasetsDraw(chart) {
                        const { ctx } = chart;
                        const meta = chart.getDatasetMeta(0);
                        if (!meta || !meta.data) return;

                        meta.data.forEach((bar, index) => {
                            const val = defectCounts[index];
                            ctx.save();
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';
                            if (!isLightMode) {
                                ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
                                ctx.shadowBlur = 4;
                            }

                            if (val > 0) {
                                ctx.font = '800 12.5px "Plus Jakarta Sans", sans-serif';
                                ctx.fillStyle = isLightMode ? '#dc2626' : '#f43f5e'; // Màu đỏ nổi bật trên đầu cột
                                ctx.fillText(val, bar.x, bar.y - 3);
                            } else {
                                ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
                                ctx.fillStyle = isLightMode ? '#94a3b8' : 'rgba(148, 163, 184, 0.45)';
                                ctx.fillText('0', bar.x, bar.y - 3);
                            }
                            ctx.restore();
                        });
                    }
                };

                chartTab2MachinesInst = new Chart(ctxMachines, {
                    type: 'bar',
                    data: {
                        labels: machineKeys,
                        datasets: [{
                            label: 'Số SP Lỗi (Chiếc)',
                            data: defectCounts,
                            backgroundColor: barColors,
                            borderColor: borderColors,
                            borderWidth: 1.5,
                            borderRadius: 6,
                            barPercentage: 0.7
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: chartTooltipBg,
                                borderColor: chartTooltipBorder,
                                borderWidth: 1,
                                padding: 10,
                                callbacks: {
                                    title: function(ctxArr) {
                                        let k = ctxArr[0].label;
                                        let m = stats.machinesData[k];
                                        let wsName = m.workshop === 'XUONG1' ? 'Xưởng 2' : 'Xưởng 1';
                                        return `Máy ${k} (${wsName})`;
                                    },
                                    label: function(ctx) {
                                        let k = ctx.label;
                                        let m = stats.machinesData[k];
                                        let moldsStr = m.molds.size > 0 ? Array.from(m.molds).join(', ') : 'Chưa rõ';
                                        return [
                                            ` Số SP lỗi: ${m.defectQty} chiếc`,
                                            ` Đã kiểm tra: ${m.checkedQty} mẫu`,
                                            ` Tỷ lệ lỗi: ${m.checkedQty > 0 ? ((m.defectQty / m.checkedQty)*100).toFixed(1) : 0}%`,
                                            ` Mã khuôn: ${moldsStr}`
                                        ];
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                suggestedMax: Math.ceil(maxMVal * 1.25),
                                grid: { color: chartGridColor },
                                ticks: { precision: 0, color: chartTickMuted }
                            },
                            x: {
                                grid: { display: false },
                                ticks: { font: { weight: 'bold', size: 11 }, color: chartTickText }
                            }
                        }
                    },
                    plugins: [machineBarLabelsPlugin]
                });
            }

            // =============================================================
            // BIỂU ĐỒ 4: DIỄN BIẾN THEO KHUNG GIỜ (HIỆN SỐ LIỆU ĐẦU CỘT)
            // =============================================================
            let ctxSlots = document.getElementById('chartTab2TimeSlots');
            if (ctxSlots) {
                if (chartTab2TimeSlotsInst) {
                    chartTab2TimeSlotsInst.destroy();
                    chartTab2TimeSlotsInst = null;
                }

                let slotKeys = Object.keys(stats.slotsData);
                let slotDefects = slotKeys.map(k => stats.slotsData[k].defectQty);
                let maxSVal = Math.max(...slotDefects, 1);

                let slotBarColors = slotKeys.map(k => {
                    let s = stats.slotsData[k];
                    return s.isDay ? 'rgba(245, 158, 11, 0.9)' : 'rgba(6, 182, 212, 0.9)';
                });
                let slotBorderColors = slotKeys.map(k => {
                    let s = stats.slotsData[k];
                    return s.isDay ? '#f59e0b' : '#06b6d4';
                });

                // PLUGIN HIỂN THỊ SỐ LIỆU ĐẦU CỘT CHO KHUNG GIỜ
                const timeSlotBarLabelsPlugin = {
                    id: 'timeSlotBarLabelsPlugin',
                    afterDatasetsDraw(chart) {
                        const { ctx } = chart;
                        const meta = chart.getDatasetMeta(0);
                        if (!meta || !meta.data) return;

                        meta.data.forEach((bar, index) => {
                            const val = slotDefects[index];
                            const s = stats.slotsData[slotKeys[index]];
                            ctx.save();
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';
                            if (!isLightMode) {
                                ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
                                ctx.shadowBlur = 4;
                            }

                            if (val > 0) {
                                ctx.font = '800 12.5px "Plus Jakarta Sans", sans-serif';
                                ctx.fillStyle = s && s.isDay ? (isLightMode ? '#d97706' : '#fbbf24') : (isLightMode ? '#0284c7' : '#22d3ee');
                                ctx.fillText(val, bar.x, bar.y - 3);
                            } else {
                                ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
                                ctx.fillStyle = isLightMode ? '#94a3b8' : 'rgba(148, 163, 184, 0.4)';
                                ctx.fillText('0', bar.x, bar.y - 3);
                            }
                            ctx.restore();
                        });
                    }
                };

                chartTab2TimeSlotsInst = new Chart(ctxSlots, {
                    type: 'bar',
                    data: {
                        labels: slotKeys.map(k => {
                            let isDay = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'].includes(k);
                            return `${isDay ? '☀️' : '🌙'} ${k}`;
                        }),
                        datasets: [{
                            label: 'Số SP Lỗi Phát Hiện',
                            data: slotDefects,
                            backgroundColor: slotBarColors,
                            borderColor: slotBorderColors,
                            borderWidth: 1.5,
                            borderRadius: 6,
                            barPercentage: 0.65
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: chartTooltipBg,
                                borderColor: chartTooltipBorder,
                                borderWidth: 1,
                                padding: 10,
                                callbacks: {
                                    label: function(ctx) {
                                        return ` Số SP lỗi phát hiện: ${ctx.raw} chiếc`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                suggestedMax: Math.ceil(maxSVal * 1.25),
                                grid: { color: chartGridColor },
                                ticks: { precision: 0, color: chartTickMuted }
                            },
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 11, weight: 'bold' }, color: chartTickText }
                            }
                        }
                    },
                    plugins: [timeSlotBarLabelsPlugin]
                });
            }
        }


        function saveTab3ActionNotes() {
            // Từ bản 4M: đối sách được lưu ngay trong từng phiếu, không cần lưu hàng loạt.
            alert("ℹ️ Đối sách 4M được lưu ngay khi bấm \"💾 Lưu đối sách\" trong từng phiếu.");
        }
