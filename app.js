/**
 * QC System - Application Bootstrapper
 * Xưởng Ép Nhựa Hải Tân
 */

document.addEventListener('DOMContentLoaded', function () {
    let today = getTodayISO();
    if (document.getElementById('tab1Date')) document.getElementById('tab1Date').value = today;
    if (document.getElementById('tab2Date')) document.getElementById('tab2Date').value = today;
    if (document.getElementById('tab3FromDate')) document.getElementById('tab3FromDate').value = today;
    if (document.getElementById('tab3ToDate')) document.getElementById('tab3ToDate').value = today;

    // Khởi tạo giao diện theme
    QCTheme.init();

    // Nếu đã từng đăng nhập trước đó, hiển thị trạng thái chờ tự động vào hệ thống
    try {
        let savedAuth = localStorage.getItem('qc_saved_auth');
        let savedEmail = localStorage.getItem('qc_saved_email');
        if (savedEmail && document.getElementById('qcEmailInput')) {
            document.getElementById('qcEmailInput').value = savedEmail;
        }
        if (savedAuth && document.getElementById('fb-status')) {
            document.getElementById('fb-status').innerHTML = `<span class="badge bg-warning text-dark rounded-pill px-3 py-2 small shadow-sm">⏳ Đang tự động đăng nhập...</span>`;
        }
    } catch (e) {}

    initFirebase();
});
