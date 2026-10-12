/**
 * QC System - Authentication & Mode Management
 * Xưởng Ép Nhựa Hải Tân
 */

        async function loginFirebase() {
            const emailInput = document.getElementById('qcEmailInput');
            const pwdInput = document.getElementById('qcPasswordInput');
            const email = emailInput ? emailInput.value.trim() : '';
            const pwd = pwdInput ? pwdInput.value : '';
            const errEl = document.getElementById('authErrorMsg');
            const btnSubmit = document.getElementById('btnLoginSubmit');

            if (!email || !pwd) {
                if (errEl) {
                    errEl.innerText = "⚠️ Vui lòng nhập đầy đủ Email và Mật khẩu!";
                    errEl.classList.remove('d-none');
                }
                return;
            }

            try {
                if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = '⏳ Đang đăng nhập...'; }
                if (firebase && firebase.auth && isConnected) {
                    if (firebase.auth) {
                        try {
                            await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
                        } catch (pe) { console.warn("Set persistence:", pe); }
                    }
                    await firebase.auth().signInWithEmailAndPassword(email, pwd);

                    // Tự động lưu thông tin để duy trì phiên đăng nhập vĩnh viễn
                    try {
                        localStorage.setItem('qc_saved_auth', JSON.stringify({ email: email, pwd: btoa(pwd) }));
                        localStorage.setItem('qc_saved_email', email);
                    } catch (se) { console.warn("Lưu session:", se); }

                    if (errEl) errEl.classList.add('d-none');
                    if (pwdInput) pwdInput.value = '';
                    if (authModalInstance) authModalInstance.hide();
                } else {
                    if (errEl) {
                        errEl.innerText = "⚠️ Chưa kết nối được cơ sở dữ liệu Firebase!";
                        errEl.classList.remove('d-none');
                    }
                }
            } catch (error) {
                if (errEl) {
                    errEl.innerText = "⚠️ Email hoặc Mật khẩu không đúng!";
                    errEl.classList.remove('d-none');
                }
            } finally {
                if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = 'Đăng Nhập'; }
            }
        }


        function handleAuthToggle() {
            if (isEditMode) {
                if (confirm("Bạn có chắc chắn muốn Đăng xuất khỏi tài khoản QC?")) {
                    try {
                        localStorage.removeItem('qc_saved_auth');
                    } catch (e) {}
                    if (firebase && firebase.auth && isConnected) {
                        firebase.auth().signOut();
                    } else {
                        setAppMode(false);
                    }
                }
            } else {
                let modalEl = document.getElementById('authModal');
                try {
                    const savedEmail = localStorage.getItem('qc_saved_email');
                    const emailInput = document.getElementById('qcEmailInput');
                    if (emailInput && savedEmail) emailInput.value = savedEmail;
                } catch (e) {}
                if (!authModalInstance) authModalInstance = new bootstrap.Modal(modalEl);
                authModalInstance.show();
                setTimeout(() => {
                    const pwdInput = document.getElementById('qcPasswordInput');
                    if (pwdInput) pwdInput.focus();
                }, 300);
            }
        }


        function checkAuthOrAlert() {
            if (!isEditMode || (firebase && firebase.auth && !firebase.auth().currentUser)) {
                alert("🔒 Yêu cầu đăng nhập tài khoản QC để thực hiện thao tác này!");
                handleAuthToggle();
                return false;
            }
            return true;
        }


        function setAppMode(loggedIn) {
            isEditMode = loggedIn;
            let btn = document.getElementById('btnToggleAuth');
            if (isEditMode) {
                document.body.classList.remove('not-logged-in');
                if (btn) { btn.className = "btn btn-sm btn-3d-primary px-3"; btn.innerHTML = "🚪 ĐĂNG XUẤT"; }
            } else {
                document.body.classList.add('not-logged-in');
                if (btn) { btn.className = "btn btn-sm btn-3d-amber px-3"; btn.innerHTML = "🔑 ĐĂNG NHẬP"; }
                clearAllSensitiveData();
            }
        }


        function clearAllSensitiveData() {
            tabInputDrafts = { 1: {}, 2: {} };
            tab1Store = {}; tab2Store = {}; tab3ActionNotesStore = {};
            if (typeof qcResetDefectMemory === 'function') qcResetDefectMemory();
            prodDataMap = {}; moldCatalog = []; hmiMoldPresetStore = {};
            if (document.getElementById('tab1Tbody')) document.getElementById('tab1Tbody').innerHTML = "";
            if (document.getElementById('tab2Tbody')) document.getElementById('tab2Tbody').innerHTML = "";
            if (document.getElementById('tab3Tbody')) document.getElementById('tab3Tbody').innerHTML = "";
            if (typeof chartTab2CategoriesInst !== 'undefined' && chartTab2CategoriesInst) { chartTab2CategoriesInst.destroy(); chartTab2CategoriesInst = null; }
            if (typeof chartTab2ReasonsInst !== 'undefined' && chartTab2ReasonsInst) { chartTab2ReasonsInst.destroy(); chartTab2ReasonsInst = null; }
            if (typeof chartTab2MachinesInst !== 'undefined' && chartTab2MachinesInst) { chartTab2MachinesInst.destroy(); chartTab2MachinesInst = null; }
            if (typeof chartTab2TimeSlotsInst !== 'undefined' && chartTab2TimeSlotsInst) { chartTab2TimeSlotsInst.destroy(); chartTab2TimeSlotsInst = null; }

            if (currentTab1DateListener && db) db.ref(`qc_tab1_store_v1/${currentTab1DateListener}`).off();
            if (currentTab2DateListener && db) db.ref(`qc_tab2_store_v1/${currentTab2DateListener}`).off();
            currentTab1DateListener = null; currentTab2DateListener = null;
            isRealtimeBound = false;
        }
