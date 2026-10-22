/**
 * QC System - Day & Night Theme Manager
 * Xưởng Ép Nhựa Hải Tân
 */

const QCTheme = {
    STORAGE_KEY: 'qc_theme_mode',
    
    getTheme() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved === 'light' || saved === 'dark') return saved;
        // Kiểm tra cài đặt hệ thống (system preference)
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'light';
        }
        // Mặc định giao diện Dark 3D Luxury Ocean
        return 'dark';
    },

    setTheme(theme) {
        if (theme !== 'light' && theme !== 'dark') theme = 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(this.STORAGE_KEY, theme);
        this.updateUI(theme);
        this.syncChartTheme(theme);
    },

    toggleTheme() {
        const current = this.getTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        this.setTheme(next);
    },

    updateUI(theme) {
        const btn = document.getElementById('btnThemeToggle');
        if (!btn) return;
        
        if (theme === 'light') {
            btn.innerHTML = '☀️ <span class="theme-text">Giao Diện Ngày</span>';
            btn.title = 'Đang ở Giao diện Ngày (Tone ấm bảo vệ mắt iPhone). Bấm để chuyển sang Giao diện Đêm';
            btn.classList.add('theme-light-active');
            btn.classList.remove('theme-dark-active');
        } else {
            btn.innerHTML = '🌙 <span class="theme-text">Giao Diện Đêm</span>';
            btn.title = 'Đang ở Giao diện Đêm. Bấm để chuyển sang Giao diện Ngày (Tone ấm)';
            btn.classList.add('theme-dark-active');
            btn.classList.remove('theme-light-active');
        }
    },

    syncChartTheme(theme) {
        if (typeof Chart !== 'undefined') {
            const isDay = theme === 'light';
            Chart.defaults.color = isDay ? '#44403c' : '#cbd5e1';
        }
        
        // Nếu các hàm render Tab 3 có sẵn, chạy lại để cập nhật màu bảng & biểu đồ ngay lập tức
        if (typeof renderTab3 === 'function') {
            try {
                renderTab3();
            } catch (e) {
                // Chưa đăng nhập hoặc chưa sẵn sàng
            }
        } else if (typeof renderTab2DefectCharts === 'function') {
            try {
                renderTab2DefectCharts();
            } catch (e) {
                // Bỏ qua
            }
        }
    },

    init() {
        const theme = this.getTheme();
        this.setTheme(theme);
    }
};

// Khởi chạy ngay lập tức để tránh nhấp nháy giao diện (FOUC)
QCTheme.init();

// Lắng nghe sự kiện DOMContentLoaded để đảm bảo nút bấm được cập nhật icon chính xác
document.addEventListener('DOMContentLoaded', function () {
    QCTheme.updateUI(QCTheme.getTheme());
});

// Bí danh toàn cục để gọi từ HTML onclick="toggleTheme()"
function toggleTheme() {
    QCTheme.toggleTheme();
}

function initTheme() {
    QCTheme.init();
}
