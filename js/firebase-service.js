/**
 * QC System - Firebase Realtime Service
 * Xưởng Ép Nhựa Hải Tân
 */

        function initFirebase() {
            try {
                if (typeof firebase !== 'undefined' && firebase.initializeApp) {
                    firebase.initializeApp(firebaseConfig);
                    db = firebase.database();
                    isConnected = true;

                    if (firebase.auth) {
                        try {
                            firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => console.warn("Set persistence:", e));
                        } catch (pe) { console.warn("Persistence setup:", pe); }
                    }

                    db.ref('system_config/zalo_webhook_url').on('value', snapshot => {
                        if (snapshot.val()) {
                            ZALO_WEBHOOK_URL = snapshot.val();
                            localStorage.setItem('qc_zalo_webhook_url', ZALO_WEBHOOK_URL);
                        }
                    });

                    firebase.auth().onAuthStateChanged(async (user) => {
                        const statusEl = document.getElementById('fb-status');
                        if (user) {
                            currentUser = user;
                            setAppMode(true);
                            if (statusEl) statusEl.innerHTML = `<span class="badge bg-info text-dark rounded-pill px-3 py-2 small shadow-sm">☁️ QC: ${escapeHtml(user.email)}</span>`;
                            bindRealtimeListeners();
                            subscribeTabRealtime();
                        } else {
                            currentUser = null;
                            // Kiểm tra phiên đăng nhập đã lưu để tự động duy trì đăng nhập
                            let savedAuth = null;
                            try {
                                const raw = localStorage.getItem('qc_saved_auth');
                                if (raw) savedAuth = JSON.parse(raw);
                            } catch (e) { savedAuth = null; }

                            if (savedAuth && savedAuth.email && savedAuth.pwd && !isAutoLoggingIn) {
                                isAutoLoggingIn = true;
                                if (statusEl) statusEl.innerHTML = `<span class="badge bg-warning text-dark rounded-pill px-3 py-2 small shadow-sm">⏳ Đang tự động đăng nhập...</span>`;
                                try {
                                    await firebase.auth().signInWithEmailAndPassword(savedAuth.email, atob(savedAuth.pwd));
                                    isAutoLoggingIn = false;
                                    return;
                                } catch (autoErr) {
                                    console.warn("Tự động đăng nhập không thành công:", autoErr);
                                    isAutoLoggingIn = false;
                                    localStorage.removeItem('qc_saved_auth');
                                }
                            }

                            setAppMode(false);
                            if (statusEl) statusEl.innerHTML = `<span class="badge bg-secondary rounded-pill px-3 py-2 small shadow-sm">🔒 Yêu cầu Đăng nhập</span>`;
                            clearAllSensitiveData();
                        }
                    });
                }
            } catch (e) { console.warn("Lỗi khởi tạo Firebase:", e); }
        }


        function bindRealtimeListeners() {
            if (!isConnected || !db || isRealtimeBound) return;
            isRealtimeBound = true;
            db.ref('mold_prod_v12_mes_clean').on('value', snapshot => {
                if (snapshot.val()) {
                    prodDataMap = snapshot.val();
                    if (isEditMode) { debouncedRenderTab1(); debouncedRenderTab2(); debouncedRenderTab3(); }
                }
            });
            db.ref('mold_catalog_v12_mes_clean').on('value', snapshot => {
                if (snapshot.val()) {
                    moldCatalog = snapshot.val();
                    updateMoldDatalist();
                    if (isEditMode) debouncedRenderTab1();
                }
            });
            db.ref('hmi_mold_preset_store_v1').on('value', snapshot => {
                if (snapshot.val()) {
                    let val = snapshot.val();
                    Object.keys(val).forEach(k => {
                        if (val[k] && typeof val[k] === 'object') {
                            if (val[k].img) {
                                delete val[k].img; // Chỉ lưu trên Google Drive, tuyệt đối không lưu ảnh vào Firebase
                                if (isConnected && db) {
                                    try { db.ref(`hmi_mold_preset_store_v1/${k}/img`).remove(); } catch(e){}
                                }
                            }
                        }
                    });
                    hmiMoldPresetStore = val;
                    try { localStorage.setItem('hmi_mold_preset_store_v1', JSON.stringify(hmiMoldPresetStore)); } catch(e) {}
                    debouncedRenderTab1();
                }
            });
            db.ref('qc_mold_resin_store_v1').on('value', snapshot => {
                if (snapshot.val()) {
                    moldResinStore = snapshot.val();
                    try { localStorage.setItem('qc_mold_resin_store_v1', JSON.stringify(moldResinStore)); } catch(e) {}
                    let activeEl = document.activeElement;
                    let tbody = document.getElementById('tab1Tbody');
                    if (isEditMode && (!tbody || !activeEl || !tbody.contains(activeEl))) {
                        debouncedRenderTab1();
                    }
                }
            });
        }


        function subscribeTabRealtime() {
            if (!isConnected || !db || !isEditMode) return;
            let d1 = document.getElementById('tab1Date').value || getTodayISO();
            let d2 = document.getElementById('tab2Date').value || getTodayISO();

            if (currentTab1DateListener !== d1) {
                if (currentTab1DateListener) db.ref(`qc_tab1_store_v1/${currentTab1DateListener}`).off();
                currentTab1DateListener = d1;
                db.ref(`qc_tab1_store_v1/${d1}`).on('value', snapshot => {
                    tab1Store[d1] = mergeTabInputDrafts(1, d1, snapshot.val());
                    debouncedRenderTab1();
                    debouncedRenderTab3();
                });
            }
            if (currentTab2DateListener !== d2) {
                if (currentTab2DateListener) db.ref(`qc_tab2_store_v1/${currentTab2DateListener}`).off();
                currentTab2DateListener = d2;
                db.ref(`qc_tab2_store_v1/${d2}`).on('value', snapshot => {
                    tab2Store[d2] = mergeTabInputDrafts(2, d2, snapshot.val());
                    debouncedRenderTab2();
                    debouncedRenderTab3();
                });
            }
        }


        function cleanPayloadForFirebase(obj) {
            if (!obj || typeof obj !== 'object') return obj;
            let clean = JSON.parse(JSON.stringify(obj));
            function removeHeavyImg(target) {
                if (!target || typeof target !== 'object') return;
                Object.keys(target).forEach(key => {
                    let val = target[key];
                    // Tuyệt đối không lưu dữ liệu ảnh base64 hoặc chuỗi byte lớn lên Firebase
                    if (typeof key === 'string' && (
                        key.endsWith('_img') || 
                        key === 'img' || 
                        key === 'tempPreview' || 
                        key === 'fileData' || 
                        key.toLowerCase().includes('base64') ||
                        key.toLowerCase().includes('hmi_img')
                    )) {
                        delete target[key];
                    } else if (typeof val === 'string' && (val.startsWith('data:image') || val.length > 3000)) {
                        delete target[key];
                    } else if (val && typeof val === 'object') {
                        removeHeavyImg(val);
                    }
                });
            }
            removeHeavyImg(clean);
            return clean;
        }
