/**
 * QC System - Global State
 * Xưởng Ép Nhựa Hải Tân
 */

// BỘ LỌC PHÂN XƯỞNG ('ALL', 'XUONG1', 'XUONG2') & BỘ LỌC CA ('ALL', 'NGAY', 'DEM')
let tab1WorkshopFilter = 'ALL';
let tab2WorkshopFilter = 'ALL';
let tab1ShiftFilter = 'ALL';
let tab2ShiftFilter = 'ALL';
let tab2SlotFilter = 'ALL'; // 'ALL' hoặc '07:30', '09:30', '11:30', '13:30', '15:30', '17:30', '19:30', '21:30', '23:30', '01:30', '03:30', '05:30'

// Bộ lọc Tab 3
let tab3WorkshopFilter = 'ALL';     // 'ALL', 'XUONG1', 'XUONG2'
let tab3ShiftFilter = 'ALL';        // 'ALL', 'NGAY', 'DEM'

// Trạng thái Firebase
let db = null;
let isConnected = false;
let isRealtimeBound = false;
let isAutoLoggingIn = false;
let currentUser = null;
let isEditMode = false;

// Instance Modal Bootstrap
let authModalInstance = null;
let hmiModalInstance = null;
let moldCheckModalInstance = null;

// Khóa kích hoạt modal
let activeHmiKey = null;
let activeMoldCheckKey = null;
let activeMoldId = null;

// Kho dữ liệu hệ thống
let prodDataMap = {};
let moldCatalog = [];
let hmiMoldPresetStore = {};
let moldResinStore = JSON.parse(localStorage.getItem('qc_mold_resin_store_v1') || '{}');
let tab1Store = {};
let tab2Store = {};
let tab3ActionNotesStore = {};
// Bản nháp của các ô đã thay đổi, giữ riêng để metadata ảnh/realtime không ghi đè.
let tabInputDrafts = { 1: {}, 2: {} };

// Listener Firebase theo ngày
let currentTab1DateListener = null;
let currentTab2DateListener = null;

// Timer Debounce Render
let renderTab1Timer = null;
let renderTab2Timer = null;
let renderTab3Timer = null;

// Instance Biểu đồ Chart.js
let chartTab2CategoriesInst = null;
let chartTab2ReasonsInst = null;
let chartTab2MachinesInst = null;
let chartTab2TimeSlotsInst = null;
