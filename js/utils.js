/**
 * QC System - Utility Helpers
 * Xưởng Ép Nhựa Hải Tân
 */

        function getSlotRangeText(slot) {
            const map = {
                '07:30': '7h30 - 9h30',
                '09:30': '9h30 - 11h30',
                '11:30': '11h30 - 13h30',
                '13:30': '13h30 - 15h30',
                '15:30': '15h30 - 17h30',
                '17:30': '17h30 - 19h30',
                '19:30': '19h30 - 21h30',
                '21:30': '21h30 - 23h30',
                '23:30': '23h30 - 1h30',
                '01:30': '1h30 - 3h30',
                '03:30': '3h30 - 5h30',
                '05:30': '5h30 - 7h30'
            };
            return map[slot] || slot;
        }


        function getTodayISO() {
            let d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }


        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }


        function getSafeFirebaseKey(key) {
            if (!key) return '';
            return String(key).trim().replace(/[.#$\[\]\/]/g, '_');
        }


        function getGoogleDriveThumbnailUrl(driveUrlOrId) {
            if (!driveUrlOrId) return '';
            let str = String(driveUrlOrId).trim();
            if (str.startsWith('data:image')) return ''; // Tuyệt đối không dùng base64
            let match = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) 
                     || str.match(/[?&]id=([a-zA-Z0-9_-]+)/)
                     || str.match(/thumbnail\?id=([a-zA-Z0-9_-]+)/)
                     || str.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
            let fileId = match ? match[1] : '';
            if (!fileId && str.length >= 25 && !str.includes('/') && !str.includes('?') && !str.includes(':')) {
                fileId = str;
            }
            if (fileId) {
                return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;
            }
            return str;
        }


        // TAB 3: THỐNG KÊ LỖI THEO KHOẢNG NGÀY
        function getDatesInRange(startDateStr, endDateStr) {
            let dates = [];
            let curr = new Date(startDateStr), end = new Date(endDateStr);
            if (curr > end) { let tmp = curr; curr = end; end = tmp; }
            while (curr <= end) {
                let y = curr.getFullYear(), m = String(curr.getMonth() + 1).padStart(2, '0'), d = String(curr.getDate()).padStart(2, '0');
                dates.push(`${y}-${m}-${d}`);
                curr.setDate(curr.getDate() + 1);
            }
            return dates;
        }


        function getMachineWorkshop(m) {
            let mNum = parseInt(m) || 1;
            return (mNum >= 1 && mNum <= 10) ? 'XUONG1' : 'XUONG2';
        }


        function getRunningMoldFromProd(date, machineId, shiftName) {
            if (prodDataMap[date] && prodDataMap[date][machineId]) {
                let recs = prodDataMap[date][machineId];
                if (Array.isArray(recs)) {
                    let found = recs.find(r => r && (r.shift === shiftName || (shiftName === 'Ca Ngày' && r.shift === 'Ngày') || (shiftName === 'Ca Đêm' && r.shift === 'Đêm')));
                    if (found && found.moldId) return found.moldId;
                }
            }
            return '';
        }


        // Mã khuôn lấy TỰ ĐỘNG từ PM ép nhựa, theo ĐÚNG quy tắc Tab 5 (Nhật ký sản lượng) của PM:
        //  1) Máy đã lưu sản lượng ngày đó -> dùng lượt chạy đã lưu (ca không có lượt = máy không chạy).
        //  2) Máy chưa lưu (Thứ 2 - Thứ 7) -> kế thừa khuôn từ ngày đã lưu gần nhất trước đó
        //     (Thứ 2 lấy từ Thứ 7). Máy 1-10 chỉ chạy ca ngày; máy 11-21 chạy 2 ca.
        //  3) Chủ nhật không tự sinh lượt chạy.
        // Khi chưa kết nối PM thì giữ mã khuôn đã lưu trước đây.
        let qcPrevProdDateCache = {};
        function qcPrevSavedProdDate(date) {
            if (qcPrevProdDateCache.__src !== prodDataMap) qcPrevProdDateCache = { __src: prodDataMap };
            if (date in qcPrevProdDateCache) return qcPrevProdDateCache[date];
            let ds = Object.keys(prodDataMap || {}).filter(d => d < date && prodDataMap[d] && Object.keys(prodDataMap[d]).length > 0).sort();
            return (qcPrevProdDateCache[date] = ds.length ? ds[ds.length - 1] : null);
        }

        function qcProdRecs(date, machineId) {
            let day = prodDataMap && prodDataMap[date];
            if (!day) return [];
            let recs = day[machineId] || day[String(machineId)];
            if (!recs) return [];
            return (Array.isArray(recs) ? recs : Object.values(recs)).filter(r => r && typeof r === 'object');
        }

        function qcShiftMatch(r, shiftName) {
            return r.shift === shiftName || (shiftName === 'Ca Ngày' && r.shift === 'Ngày') || (shiftName === 'Ca Đêm' && r.shift === 'Đêm');
        }

        function qcResolveMold(date, machineId, shiftName, savedMold) {
            let connected = (typeof mesSyncActive !== 'undefined' && mesSyncActive && prodDataMap);
            if (!connected) {
                return { mold: savedMold || getRunningMoldFromProd(date, machineId, shiftName) || '', fromMes: false, inherited: false };
            }
            let m = parseInt(machineId) || 0;
            let saved = qcProdRecs(date, m);
            if (saved.length > 0) {
                let f = saved.find(r => qcShiftMatch(r, shiftName));
                return { mold: (f && f.moldId) || '', fromMes: true, inherited: false };
            }
            let parts = String(date).split('-');
            let isSunday = parts.length === 3 && new Date(+parts[0], +parts[1] - 1, +parts[2]).getDay() === 0;
            if (isSunday) return { mold: '', fromMes: true, inherited: false };
            let prev = qcPrevSavedProdDate(date);
            let prevRecs = prev ? qcProdRecs(prev, m) : [];
            if (!prevRecs.length) return { mold: '', fromMes: true, inherited: false };
            let pDay = prevRecs.find(r => r.shift === 'Ngày'), pNight = prevRecs.find(r => r.shift === 'Đêm');
            let pLast = prevRecs[prevRecs.length - 1];
            let dayMold = (pDay && pDay.moldId) || (pLast && pLast.moldId) || '';
            let isNight = String(shiftName).includes('Đêm');
            if (!isNight) return { mold: dayMold, fromMes: true, inherited: !!dayMold, fromDate: prev };
            if (m >= 1 && m <= 10) return { mold: '', fromMes: true, inherited: false }; // máy 1-10 chỉ chạy ca ngày
            let nightMold = (pNight && pNight.moldId) || (pLast && pLast.moldId) || dayMold;
            return { mold: nightMold, fromMes: true, inherited: !!nightMold, fromDate: prev };
        }


        function qcMoldCellHtml(cls, key, moldId, src) {
            src = src || {};
            let connected = typeof mesSyncActive !== 'undefined' && mesSyncActive;
            let ph = connected ? 'Máy không chạy' : '⚠️ Chưa kết nối PM ép';
            let title = connected ? 'Mã khuôn tự động từ phần mềm ép nhựa (không chỉnh tay)' : 'Bấm để kết nối phần mềm ép nhựa và lấy mã khuôn tự động';
            if (connected && src.inherited) {
                let p = String(src.fromDate || '').split('-');
                title = `Tổ ép chưa lưu sản lượng ngày này - mã khuôn kế thừa từ ngày ${p.length === 3 ? p[2] + '/' + p[1] : src.fromDate} (giống phần mềm ép)`;
                cls += ' qc-mold-inherited';
            }
            let click = connected ? '' : ' onclick="if(typeof mesMoKetNoi===\'function\') mesMoKetNoi()" style="cursor:pointer;"';
            return `<input type="text" readonly tabindex="-1" class="form-control form-control-sm text-center fw-bold text-warning qc-mold-auto ${cls}" value="${escapeHtml(moldId || '')}" placeholder="${ph}" title="${title}" data-key="${key}"${click}>`;
        }


        function getDecoCycleByMoldId(moldId) {
            if (!moldId || !moldCatalog) return 30;
            let target = String(moldId).trim().toLowerCase();
            let catalogList = Array.isArray(moldCatalog) ? moldCatalog : Object.values(moldCatalog);
            let found = catalogList.find(m => m && ((m.id && String(m.id).trim().toLowerCase() === target) || (m.moldId && String(m.moldId).trim().toLowerCase() === target)));
            if (found && found.cycle !== undefined && found.cycle !== null && String(found.cycle).trim() !== '') {
                let c = parseFloat(found.cycle);
                if (!isNaN(c) && c > 0) return c;
            }
            return 30;
        }


        function updateMoldDatalist() {
            let datalist = document.getElementById("moldOptionsList");
            if (!datalist) return;
            datalist.innerHTML = "";
            if (Array.isArray(moldCatalog)) {
                moldCatalog.forEach(m => {
                    if (m && m.id) {
                        let opt = document.createElement('option');
                        opt.value = m.id;
                        datalist.appendChild(opt);
                    }
                });
            }
        }


        function rememberTabInputDrafts(tab, date, before, after) {
            const fields = tab === 1
                ? ['moldId', 'resinType', 'resinColor', 'decoCycle', 'machineCycle', 'result', 'note']
                : ['moldId', 'colorCheck', 'visual', 'dimension', 'mechanical', 'totalCheck', 'defectCheck', 'goodCheck', 'overall', 'note'];
            const drafts = tabInputDrafts[tab][date] || (tabInputDrafts[tab][date] = {});
            Object.keys(after).forEach(key => {
                if (key.endsWith('_inspector')) {
                    if (after[key] !== before[key]) drafts[key] = after[key];
                    return;
                }
                if (!after[key] || typeof after[key] !== 'object') return;
                fields.forEach(field => {
                    if (after[key][field] !== undefined && after[key][field] !== (before[key] || {})[field]) {
                        if (!drafts[key]) drafts[key] = {};
                        drafts[key][field] = after[key][field];
                    }
                });
            });
        }

        function mergeTabInputDrafts(tab, date, cloudData) {
            const merged = { ...(cloudData || {}) };
            const drafts = tabInputDrafts[tab][date] || {};
            Object.keys(drafts).forEach(key => {
                merged[key] = key.endsWith('_inspector') ? drafts[key] : { ...(merged[key] || {}), ...drafts[key] };
            });
            return merged;
        }

        function acknowledgeTabInputDrafts(tab, date, savedData) {
            const drafts = tabInputDrafts[tab][date];
            if (!drafts) return;
            Object.keys(drafts).forEach(key => {
                if (key.endsWith('_inspector')) {
                    if (drafts[key] === savedData[key]) delete drafts[key];
                } else {
                    Object.keys(drafts[key]).forEach(field => {
                        if (drafts[key][field] === (savedData[key] || {})[field]) delete drafts[key][field];
                    });
                    if (!Object.keys(drafts[key]).length) delete drafts[key];
                }
            });
            if (!Object.keys(drafts).length) delete tabInputDrafts[tab][date];
        }

        function debouncedRenderTab1() {
            if (renderTab1Timer) clearTimeout(renderTab1Timer);
            renderTab1Timer = setTimeout(() => {
                let activeEl = document.activeElement;
                let tbody = document.getElementById('tab1Tbody');
                if (tbody && activeEl && tbody.contains(activeEl)) return;
                renderTab1();
            }, 150);
        }


        function debouncedRenderTab2() {
            if (renderTab2Timer) clearTimeout(renderTab2Timer);
            renderTab2Timer = setTimeout(() => {
                let activeEl = document.activeElement;
                let tbody = document.getElementById('tab2Tbody');
                if (tbody && activeEl && tbody.contains(activeEl)) return;
                renderTab2();
            }, 150);
        }


        function debouncedRenderTab3() {
            if (renderTab3Timer) clearTimeout(renderTab3Timer);
            renderTab3Timer = setTimeout(() => {
                let activeEl = document.activeElement;
                let tbody = document.getElementById('tab3Tbody');
                if (tbody && activeEl && tbody.contains(activeEl)) return;
                renderTab3();
            }, 200);
        }
