/**
 * QC System - Configuration & Constants
 * Xưởng Ép Nhựa Hải Tân
 */

// CẤU HÌNH TỔNG QUAN: 21 MÁY (XƯỞNG 2: M1-M10, XƯỞNG 1: M11-M21 – mã nội bộ XUONG1 = M1-M10, XUONG2 = M11-M21)
const TOTAL_MACHINES = 21;
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
