/**
 * QC System - Configuration & Constants
 * Xưởng Ép Nhựa Hải Tân
 */

// CẤU HÌNH TỔNG QUAN: 21 MÁY. Mã nội bộ (dữ liệu Firebase, PM ép nhựa): 1-21; bộ lọc XUONG1 = mã 1-10, XUONG2 = mã 11-21.
// Cách gọi tại xưởng (hiển thị): XƯỞNG 1 = M1-M11 (mã nội bộ 11-21), XƯỞNG 2 = M1-M10 (mã nội bộ 1-10).
const TOTAL_MACHINES = 21;
const QC_THU_TU_MAY = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];   // thứ tự hiển thị: Xưởng 1 trước, rồi Xưởng 2
function qcMaNoiBo(m) { return parseInt(String(m === null || m === undefined ? '' : m).replace(/\D/g, '')) || 0; }   // 12 | 'M12' -> 12
function qcSoMay(m) { let n = qcMaNoiBo(m); return n >= 11 ? n - 10 : n; }                                            // số máy gọi tại xưởng
function qcSoXuong(m) { return qcMaNoiBo(m) >= 11 ? 1 : 2; }
function qcTenMay(m) { let n = qcMaNoiBo(m); return n ? 'M' + qcSoMay(n) : String(m || ''); }                        // 'M2'
function qcTenMayDu(m) { let n = qcMaNoiBo(m); return n ? `M${qcSoMay(n)} (Xưởng ${qcSoXuong(n)})` : String(m || ''); }   // 'M2 (Xưởng 1)'
function qcTenMayGon(m) { let n = qcMaNoiBo(m); return n ? `X${qcSoXuong(n)}-M${qcSoMay(n)}` : String(m || ''); }     // 'X1-M2' (nhãn biểu đồ, số phiếu)
function qcOMay(m) { return `M${qcSoMay(m)}<div class="fw-normal opacity-75" style="font-size:9px; line-height:1.1;">Xưởng ${qcSoXuong(m)}</div>`; }   // ô "Máy" trong bảng
// Danh sách mã nội bộ theo thứ tự hiển thị; ws: 'ALL' | 'XUONG1' (mã 1-10 = Xưởng 2) | 'XUONG2' (mã 11-21 = Xưởng 1)
function qcDsMay(ws) {
    return QC_THU_TU_MAY.filter(m => m <= TOTAL_MACHINES && (ws === 'XUONG1' ? m <= 10 : ws === 'XUONG2' ? m >= 11 : true));
}
const QC_SLOTS_DAY = ["07:30", "09:30", "11:30", "13:30", "15:30", "17:30"];
const QC_SLOTS_NIGHT = ["19:30", "21:30", "23:30", "01:30", "03:30", "05:30"];

// WEBHOOK ZALO
const DEFAULT_ZALO_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbydBY0rfgX7I0t3yWQsTF3xEt4WlmIcc6HKS98ASEGddxLgKjQDBYivLFAyM5ViTSi05Q/exec";
let ZALO_WEBHOOK_URL = localStorage.getItem('qc_zalo_webhook_url') || DEFAULT_ZALO_WEBHOOK_URL;

// GOOGLE DRIVE
const GOOGLE_DRIVE_FOLDER_ID = "1m8rzMVgucC2DT9o_2lYGjBb5tuwrX8no";
const GOOGLE_DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1m8rzMVgucC2DT9o_2lYGjBb5tuwrX8no?usp=drive_link";
const MAX_IMAGE_BYTES = 100 * 1024; // Chuẩn dung lượng tối ưu ~100KB (chất lượng HD siêu nét)

// FIREBASE REALTIME
const firebaseConfig = {
    apiKey: "AIzaSyACU4mFuzc67084F517XzOam40mdqyPnvA",
    authDomain: "haithien.firebaseapp.com",
    databaseURL: "https://haithien-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "haithien",
    storageBucket: "haithien.firebasestorage.app",
    messagingSenderId: "696910657033",
    appId: "1:696910657033:web:40a221ac8b5421b3a66ad8"
};
