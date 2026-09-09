// ==========================================================================
// SkyFilter PRO v5.0 - Bulletproof UID & Password Isolation Engine
// Fixes: label row detection, empty-col collapse, password detection,
//        dedup hardening, source-file tracking, skip-count logging
// ==========================================================================

const STORAGE_KEY_HISTORY = 'skyfilter_uid_history_db';
const IDB_NAME = 'SkyFilterDB';
const IDB_STORE = 'recorded_uids';
const IDB_VERSION = 1;

let idbDatabase = null;
let processingLock = false; // Prevent concurrent processing runs

const state = {
    pendingFiles: [],
    rawUploadedFiles: [],
    records: [],
    activeUidSet: new Set(),
    historicalUidSet: new Set(),
    loadedFileSignatures: new Set(),
    pastedDeadUids: new Set(),

    totalRawRowsUploaded: 0,
    totalSkippedJunkRows: 0,
    duplicateUidsRemoved: 0,
    deletedDeadCount: 0,

    loadedFiles: [],
    currentTab: 'all',
    searchQuery: '',
    currentPage: 1,
    rowsPerPage: 50,
    isStep1Completed: false,
    isStep2Completed: false
};

// DOM References
const elements = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    fileChipsContainer: document.getElementById('file-chips-container'),
    fileChipsList: document.getElementById('file-chips-list'),
    loadedFilesCount: document.getElementById('loaded-files-count'),
    btnStartFilter: document.getElementById('btn-start-filter'),
    uploadProgressContainer: document.getElementById('upload-progress-container'),
    progressText: document.getElementById('progress-text'),
    progressPercent: document.getElementById('progress-percent'),
    progressFill: document.getElementById('progress-fill'),
    step1Downloads: document.getElementById('step1-downloads'),
    dlCount1000: document.getElementById('dl-count-1000'),
    dlCount61: document.getElementById('dl-count-61'),
    dlCountOthers: document.getElementById('dl-count-others'),
    dlCountAll: document.getElementById('dl-count-all'),

    deadFileInput: document.getElementById('dead-file-input'),
    deadFileName: document.getElementById('dead-file-name'),
    deadUidsInput: document.getElementById('dead-uids-input'),
    deadPastedCount: document.getElementById('dead-pasted-count'),
    matchedStatus: document.getElementById('matched-status'),
    btnStartPurge: document.getElementById('btn-start-purge'),
    step2Downloads: document.getElementById('step2-downloads'),

    dbHistoryCount: document.getElementById('db-history-count'),
    btnClearHistory: document.getElementById('btn-clear-history'),
    btnClearHistoryStep1: document.getElementById('btn-clear-history-step1'),
    btnExportDb: document.getElementById('btn-export-db'),
    importDbInput: document.getElementById('import-db-input'),
    btnImportDb: document.getElementById('btn-import-db'),
    toggleHistoryFilter: document.getElementById('toggle-history-filter'),

    statTotal: document.getElementById('stat-total'),
    statUnique: document.getElementById('stat-unique'),
    statDup: document.getElementById('stat-dup'),
    stat1000: document.getElementById('stat-1000'),
    stat61: document.getElementById('stat-61'),
    statDead: document.getElementById('stat-dead'),

    badgeAll: document.getElementById('badge-all'),
    badge1000: document.getElementById('badge-1000'),
    badge61: document.getElementById('badge-61'),
    badgeOthers: document.getElementById('badge-others'),

    tableBody: document.getElementById('table-body'),
    searchInput: document.getElementById('search-input'),
    rowsPerPage: document.getElementById('rows-per-page'),
    pageStart: document.getElementById('page-start'),
    pageEnd: document.getElementById('page-end'),
    totalEntries: document.getElementById('total-entries'),
    currentPageNum: document.getElementById('current-page-num'),
    btnPrevPage: document.getElementById('btn-prev-page'),
    btnNextPage: document.getElementById('btn-next-page'),

    confirmModal: document.getElementById('confirm-modal'),
    modalDeadCount: document.getElementById('modal-dead-count'),
    btnCancelDelete: document.getElementById('btn-cancel-delete'),
    btnConfirmDelete: document.getElementById('btn-confirm-delete'),
    btnClearAll: document.getElementById('btn-clear-all'),

    liveLogsList: document.getElementById('live-logs-list'),
    btnClearLogs: document.getElementById('btn-clear-logs'),

    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message')
};

// ==========================================================================
// LOGGER
// ==========================================================================
function logMessage(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [${type.toUpperCase()}] ${msg}`);

    if (!elements.liveLogsList) return;

    const li = document.createElement('li');
    li.className = `log-item log-${type}`;

    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'warning') icon = 'fa-triangle-exclamation';
    if (type === 'error') icon = 'fa-circle-xmark';
    if (type === 'process') icon = 'fa-spinner fa-spin';

    li.innerHTML = `<span class="log-time">[${time}]</span> <i class="fa-solid ${icon}"></i> <span>${msg}</span>`;
    elements.liveLogsList.prepend(li);

    while (elements.liveLogsList.children.length > 150) {
        elements.liveLogsList.removeChild(elements.liveLogsList.lastChild);
    }
}

// ==========================================================================
// INDEXEDDB ENGINE - PERSISTENT RECORDED UID DATABASE
// ==========================================================================
function initIndexedDB() {
    return new Promise((resolve) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'uid' });
            }
        };
        req.onsuccess = (e) => {
            idbDatabase = e.target.result;
            resolve(idbDatabase);
        };
        req.onerror = () => resolve(null);
    });
}

async function loadHistoricalDatabase() {
    try {
        await initIndexedDB();

        if (idbDatabase) {
            const tx = idbDatabase.transaction(IDB_STORE, 'readonly');
            const store = tx.objectStore(IDB_STORE);
            const req = store.getAllKeys();

            await new Promise((resolve) => {
                req.onsuccess = () => {
                    const keys = req.result || [];
                    keys.forEach(k => state.historicalUidSet.add(String(k)));
                    resolve();
                };
                req.onerror = () => resolve();
            });
        }

        // Migrate from localStorage
        try {
            const stored = localStorage.getItem(STORAGE_KEY_HISTORY);
            if (stored) {
                const arr = JSON.parse(stored);
                if (Array.isArray(arr) && arr.length > 0) {
                    const toPersist = [];
                    arr.forEach(u => {
                        const strU = String(u).trim();
                        if (strU && !state.historicalUidSet.has(strU)) {
                            state.historicalUidSet.add(strU);
                            toPersist.push(strU);
                        }
                    });
                    if (toPersist.length > 0) await saveNewRecordedUids(toPersist);
                }
            }
        } catch (err) {}

        updateHistoryCountUI();
        logMessage(`Loaded ${state.historicalUidSet.size.toLocaleString()} recorded UIDs into database memory. Auto-Deduplication ACTIVE!`, 'success');
    } catch (e) {
        console.error('Error loading history DB:', e);
    }
}

async function saveNewRecordedUids(newUids) {
    if (!newUids || newUids.length === 0) return;

    if (idbDatabase) {
        try {
            const chunkSize = 2000;
            for (let i = 0; i < newUids.length; i += chunkSize) {
                const chunk = newUids.slice(i, i + chunkSize);
                const tx = idbDatabase.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                chunk.forEach(uid => store.put({ uid: String(uid), addedAt: Date.now() }));
                await new Promise(res => {
                    tx.oncomplete = () => res();
                    tx.onerror = () => res();
                });
            }
        } catch (e) {
            console.error('Failed writing to IndexedDB:', e);
        }
    }

    try {
        if (state.historicalUidSet.size <= 200000) {
            localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(Array.from(state.historicalUidSet)));
        }
    } catch (e) {}

    updateHistoryCountUI();
}

function updateHistoryCountUI() {
    if (elements.dbHistoryCount) {
        elements.dbHistoryCount.textContent = state.historicalUidSet.size.toLocaleString();
    }
}

async function wipeAllHistoryDatabase() {
    const oldCount = state.historicalUidSet.size;
    state.historicalUidSet.clear();

    if (idbDatabase) {
        try {
            const tx = idbDatabase.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).clear();
            await new Promise(r => { tx.oncomplete = () => r(); tx.onerror = () => r(); });
        } catch (e) {}
    }

    try { localStorage.removeItem(STORAGE_KEY_HISTORY); } catch (e) {}

    updateHistoryCountUI();
    logMessage(`WIPED HISTORY: Cleared all ${oldCount.toLocaleString()} saved UIDs from database.`, 'warning');
    showToast(`Wiped ${oldCount.toLocaleString()} UIDs from history database!`);

    if (state.rawUploadedFiles.length > 0) {
        logMessage(`Re-filtering ${state.rawUploadedFiles.length} file(s) with clean memory...`, 'process');
        reprocessCurrentFiles();
    }
}

function exportRecordedUidsDB() {
    const total = state.historicalUidSet.size;
    if (total === 0) {
        showToast('Recorded UID Database is currently empty.', 'warning');
        return;
    }
    const uids = Array.from(state.historicalUidSet);
    const content = uids.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SkyFilter_Recorded_UIDs_${new Date().toISOString().slice(0,10)}_${total}pcs.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logMessage(`Exported backup of ${total.toLocaleString()} recorded UIDs.`, 'success');
    showToast(`Exported ${total.toLocaleString()} UIDs successfully!`);
}

async function importUidsIntoDB(file) {
    try {
        logMessage(`Importing past UIDs from '${file.name}' into Database...`, 'process');
        const text = await readFileAsTextOrExcel(file);
        const uids = extractUidsFromText(text);

        let addedCount = 0;
        const toPersist = [];
        uids.forEach(uid => {
            if (!state.historicalUidSet.has(uid)) {
                state.historicalUidSet.add(uid);
                toPersist.push(uid);
                addedCount++;
            }
        });

        if (toPersist.length > 0) await saveNewRecordedUids(toPersist);

        logMessage(`Import Done: Added ${addedCount.toLocaleString()} new UIDs. Total DB: ${state.historicalUidSet.size.toLocaleString()} UIDs.`, 'success');
        showToast(`Imported ${addedCount.toLocaleString()} new UIDs into Database!`);
    } catch (e) {
        logMessage(`Failed to import UIDs from ${file.name}: ${e}`, 'error');
        showToast(`Failed to import: ${e.message || e}`, 'error');
    }
}

window.reprocessCurrentFiles = function() {
    if (state.rawUploadedFiles.length === 0) {
        showToast('No files uploaded to re-filter.', 'info');
        return;
    }

    state.records = [];
    state.activeUidSet.clear();
    state.loadedFileSignatures.clear();
    state.totalRawRowsUploaded = 0;
    state.totalSkippedJunkRows = 0;
    state.duplicateUidsRemoved = 0;
    state.deletedDeadCount = 0;
    state.loadedFiles = [];

    state.pendingFiles = [...state.rawUploadedFiles];
    processStep1Filtering();
};

// ==========================================================================
// EVENT LISTENERS
// ==========================================================================
function initEvents() {
    elements.dropzone.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
            elements.fileInput.click();
        }
    });

    elements.dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.dropzone.classList.add('dragover');
    });
    elements.dropzone.addEventListener('dragleave', () => {
        elements.dropzone.classList.remove('dragover');
    });
    elements.dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            logMessage(`Detected drop of ${e.dataTransfer.files.length} file(s).`, 'info');
            handleNewFiles(Array.from(e.dataTransfer.files));
        }
    });

    elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            logMessage(`Selected ${e.target.files.length} file(s) via file browser.`, 'info');
            handleNewFiles(Array.from(e.target.files));
            elements.fileInput.value = '';
        }
    });

    elements.btnStartFilter.addEventListener('click', () => {
        if (state.pendingFiles.length === 0) return;
        processStep1Filtering();
    });

    elements.deadFileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            elements.deadFileName.textContent = file.name;
            logMessage(`Loading Dead UIDs from file: ${file.name}...`, 'process');
            await readDeadUidFile(file);
            elements.deadFileInput.value = '';
        }
    });

    elements.deadUidsInput.addEventListener('input', () => {
        updateDeadMatchingState();
    });

    elements.btnStartPurge.addEventListener('click', () => {
        const matched = state.records.filter(r => state.pastedDeadUids.has(r.uid)).length;
        if (matched === 0) {
            logMessage('Purge clicked, but no matching Dead UIDs found in current sheets.', 'warning');
            showToast('No matching dead UIDs found in filtered sheets to delete.', 'info');
            return;
        }
        elements.modalDeadCount.textContent = matched.toLocaleString();
        elements.confirmModal.classList.remove('hidden');
    });

    elements.btnCancelDelete.addEventListener('click', () => {
        elements.confirmModal.classList.add('hidden');
    });

    elements.btnConfirmDelete.addEventListener('click', () => {
        executeDeadUidDeletion();
        elements.confirmModal.classList.add('hidden');
    });

    if (elements.btnClearHistory) {
        elements.btnClearHistory.addEventListener('click', () => {
            if (confirm(`Wipe all ${state.historicalUidSet.size.toLocaleString()} recorded UIDs from history database?`)) {
                wipeAllHistoryDatabase();
            }
        });
    }

    if (elements.btnClearHistoryStep1) {
        elements.btnClearHistoryStep1.addEventListener('click', () => {
            if (confirm(`Wipe all ${state.historicalUidSet.size.toLocaleString()} recorded UIDs from history database?`)) {
                wipeAllHistoryDatabase();
            }
        });
    }

    if (elements.btnExportDb) {
        elements.btnExportDb.addEventListener('click', () => exportRecordedUidsDB());
    }

    if (elements.importDbInput) {
        elements.importDbInput.addEventListener('change', async (e) => {
            if (e.target.files && e.target.files.length > 0) {
                await importUidsIntoDB(e.target.files[0]);
                elements.importDbInput.value = '';
            }
        });
    }

    if (elements.btnClearLogs) {
        elements.btnClearLogs.addEventListener('click', () => {
            elements.liveLogsList.innerHTML = '';
            logMessage('Logs console cleared.', 'info');
        });
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentTab = btn.dataset.tab;
            state.currentPage = 1;
            renderTable();
        });
    });

    elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim().toLowerCase();
        state.currentPage = 1;
        renderTable();
    });

    elements.rowsPerPage.addEventListener('change', (e) => {
        state.rowsPerPage = parseInt(e.target.value, 10);
        state.currentPage = 1;
        renderTable();
    });

    elements.btnPrevPage.addEventListener('click', () => {
        if (state.currentPage > 1) { state.currentPage--; renderTable(); }
    });
    elements.btnNextPage.addEventListener('click', () => {
        state.currentPage++;
        renderTable();
    });

    elements.btnClearAll.addEventListener('click', () => {
        if (confirm('Reset current session files, preview table, and dead lists? (Saved History DB is kept safe)')) {
            state.pendingFiles = [];
            state.rawUploadedFiles = [];
            state.records = [];
            state.activeUidSet.clear();
            state.loadedFileSignatures.clear();
            state.pastedDeadUids.clear();
            state.totalRawRowsUploaded = 0;
            state.totalSkippedJunkRows = 0;
            state.duplicateUidsRemoved = 0;
            state.deletedDeadCount = 0;
            state.loadedFiles = [];
            state.isStep1Completed = false;
            state.isStep2Completed = false;

            elements.deadUidsInput.value = '';
            elements.deadFileName.textContent = 'No file selected';
            elements.fileChipsList.innerHTML = '';
            elements.fileChipsContainer.classList.add('hidden');
            elements.step1Downloads.classList.add('hidden');
            elements.step2Downloads.classList.add('hidden');
            elements.btnStartFilter.disabled = true;
            elements.btnStartPurge.disabled = true;

            updateStatsAndCounts();
            updateDeadMatchingState();
            renderTable();
            logMessage('Session reset: Active session tables cleared. (Database memory intact)', 'warning');
            showToast('Session reset.');
        }
    });
}

// Queue Files
function handleNewFiles(files) {
    let countAdded = 0;
    files.forEach(file => {
        const fileSig = file.name + '_' + file.size;
        if (state.loadedFileSignatures.has(fileSig)) {
            logMessage(`Skipped duplicate file: ${file.name}`, 'warning');
        } else {
            state.pendingFiles.push(file);
            state.rawUploadedFiles.push(file);
            state.loadedFileSignatures.add(fileSig);
            countAdded++;
            logMessage(`Queued file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'info');
        }
    });

    if (state.pendingFiles.length > 0) {
        elements.fileChipsContainer.classList.remove('hidden');
        elements.loadedFilesCount.textContent = state.rawUploadedFiles.length;
        elements.btnStartFilter.disabled = false;

        elements.fileChipsList.innerHTML = state.rawUploadedFiles.map((f, i) => `
            <div class="file-chip">
                <i class="fa-solid fa-file-excel"></i>
                <span>${escapeHtml(f.name)}</span>
                <span class="chip-count">${(f.size / 1024).toFixed(1)} KB</span>
                <i class="fa-solid fa-xmark chip-remove" onclick="removeUploadedFile(${i})"></i>
            </div>
        `).join('');

        processStep1Filtering();
    }
}

window.removeUploadedFile = function(index) {
    const f = state.rawUploadedFiles[index];
    if (f) {
        state.loadedFileSignatures.delete(f.name + '_' + f.size);
        state.rawUploadedFiles.splice(index, 1);
        state.records = state.records.filter(r => r.sourceFile !== f.name);
        logMessage(`Removed file ${f.name}.`, 'info');

        elements.loadedFilesCount.textContent = state.rawUploadedFiles.length;
        elements.fileChipsList.innerHTML = state.rawUploadedFiles.map((item, i) => `
            <div class="file-chip">
                <i class="fa-solid fa-file-excel"></i>
                <span>${escapeHtml(item.name)}</span>
                <span class="chip-count">${(item.size / 1024).toFixed(1)} KB</span>
                <i class="fa-solid fa-xmark chip-remove" onclick="removeUploadedFile(${i})"></i>
            </div>
        `).join('');

        updateStep1DownloadsUI();
        updateDeadMatchingState();
        updateStatsAndCounts();
        renderTable();
    }
    if (state.rawUploadedFiles.length === 0) {
        elements.fileChipsContainer.classList.add('hidden');
        elements.btnStartFilter.disabled = true;
    }
};

// ==========================================================================
// STEP 1 - FILTERING & AUTOMATIC DEDUPLICATION
// ==========================================================================
async function processStep1Filtering() {
    if (processingLock) {
        logMessage('Processing already in progress. Please wait...', 'warning');
        return;
    }

    const files = [...state.pendingFiles];
    if (files.length === 0) return;

    processingLock = true;
    elements.btnStartFilter.disabled = true;
    elements.uploadProgressContainer.classList.remove('hidden');
    elements.progressFill.style.width = '0%';
    elements.progressPercent.textContent = '0%';
    elements.progressText.textContent = `Starting filter on ${files.length} file(s)...`;
    logMessage(`Starting Step 1 filtering on ${files.length} file(s)...`, 'process');

    let newUniqueAdded = 0;
    let newDuplicatesRemoved = 0;
    let totalJunkSkipped = 0;

    const filterAgainstHistory = elements.toggleHistoryFilter ? elements.toggleHistoryFilter.checked : true;
    const newUidsToPersist = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        elements.progressText.textContent = `Reading (${i + 1}/${files.length}): ${file.name}`;
        const pct = Math.round(((i + 1) / files.length) * 100);
        elements.progressFill.style.width = `${pct}%`;
        elements.progressPercent.textContent = `${pct}%`;

        try {
            const result = await parseAnyFile(file);
            const rawRows = result.records;
            const junkSkipped = result.junkSkipped;

            state.totalRawRowsUploaded += rawRows.length;
            state.totalSkippedJunkRows += junkSkipped;
            totalJunkSkipped += junkSkipped;

            logMessage(`Parsed '${file.name}': ${rawRows.length.toLocaleString()} data rows found, ${junkSkipped.toLocaleString()} label/junk rows skipped.`, 'info');

            let fileUniqueCount = 0;
            let fileDupCount = 0;

            rawRows.forEach(record => {
                const uid = record.uid;
                if (!uid) return;

                // DEDUPLICATION: check session + history BEFORE adding
                const isDupInSession = state.activeUidSet.has(uid);
                const isDupInHistory = filterAgainstHistory && state.historicalUidSet.has(uid);

                if (isDupInSession || isDupInHistory) {
                    newDuplicatesRemoved++;
                    fileDupCount++;
                    state.duplicateUidsRemoved++;
                } else {
                    // Only add AFTER confirming uniqueness
                    state.activeUidSet.add(uid);
                    state.historicalUidSet.add(uid); // Add to RAM set first
                    newUidsToPersist.push(uid);
                    state.records.push(record);
                    fileUniqueCount++;
                    newUniqueAdded++;
                }
            });

            logMessage(`File '${file.name}': Added ${fileUniqueCount.toLocaleString()} unique rows. (${fileDupCount.toLocaleString()} duplicate UIDs removed).`, 'success');

            state.loadedFiles.push({
                name: file.name,
                count: fileUniqueCount,
                rawCount: rawRows.length,
                junkSkipped: junkSkipped,
                size: (file.size / 1024).toFixed(1) + ' KB'
            });

        } catch (err) {
            console.error('Error reading file:', file.name, err);
            logMessage(`ERROR parsing ${file.name}: ${err.message || err}`, 'error');
            showToast(`Failed to parse ${file.name}`, 'error');
        }

        await new Promise(res => setTimeout(res, 5));
    }

    // Persist all newly seen unique UIDs into IndexedDB (batch write)
    if (newUidsToPersist.length > 0) {
        await saveNewRecordedUids(newUidsToPersist);
    }

    setTimeout(() => {
        elements.uploadProgressContainer.classList.add('hidden');
    }, 400);

    state.isStep1Completed = true;
    state.pendingFiles = [];
    processingLock = false;
    elements.btnStartFilter.disabled = true;

    updateStep1DownloadsUI();
    updateDeadMatchingState();
    updateStatsAndCounts();
    renderTable();

    const c1000 = state.records.filter(r => r.series === '1000xxx' && !r.isDead).length;
    const c61 = state.records.filter(r => r.series === '61xxx' && !r.isDead).length;
    logMessage(`✅ Step 1 Complete: ${newUniqueAdded.toLocaleString()} unique accounts (1000xxx: ${c1000.toLocaleString()} | 61xxx: ${c61.toLocaleString()}). Duplicates Blocked: ${newDuplicatesRemoved.toLocaleString()}. Junk Rows Skipped: ${totalJunkSkipped.toLocaleString()}`, 'success');

    let msg = `Step 1 Done! Filtered ${newUniqueAdded.toLocaleString()} unique accounts.`;
    if (newDuplicatesRemoved > 0) msg += ` (${newDuplicatesRemoved.toLocaleString()} duplicates removed)`;
    showToast(msg);
}

function updateStep1DownloadsUI() {
    elements.step1Downloads.classList.remove('hidden');
    const c1000 = state.records.filter(r => r.series === '1000xxx' && !r.isDead).length;
    const c61 = state.records.filter(r => r.series === '61xxx' && !r.isDead).length;
    const cOthers = state.records.filter(r => r.series === 'Others' && !r.isDead).length;
    const cAll = state.records.filter(r => !r.isDead).length;

    elements.dlCount1000.textContent = c1000.toLocaleString();
    elements.dlCount61.textContent = c61.toLocaleString();
    elements.dlCountOthers.textContent = cOthers.toLocaleString();
    elements.dlCountAll.textContent = cAll.toLocaleString();
}

// Read Dead UID File
async function readDeadUidFile(file) {
    try {
        const text = await readFileAsTextOrExcel(file);
        const existing = elements.deadUidsInput.value.trim();
        elements.deadUidsInput.value = existing ? `${existing}\n${text}` : text;
        const matched = updateDeadMatchingState();
        logMessage(`Loaded Dead UIDs from ${file.name}. Found ${matched.toLocaleString()} matching lines in current sheets.`, 'warning');
        showToast(`Loaded dead UIDs from ${file.name}!`);
    } catch (e) {
        logMessage(`Failed to read dead UID file ${file.name}: ${e}`, 'error');
        showToast(`Failed to read dead UID file ${file.name}`, 'error');
    }
}

function readFileAsTextOrExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array', raw: true });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
                    const lines = [];
                    rows.forEach(r => {
                        r.forEach(cell => {
                            if (cell) lines.push(String(cell).trim());
                        });
                    });
                    resolve(lines.join('\n'));
                } catch (err) { reject(err); }
            };
            reader.readAsArrayBuffer(file);
        } else {
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (err) => reject(err);
            reader.readAsText(file);
        }
    });
}

// ==========================================================================
// FIX 1: LABEL / JUNK ROW DETECTOR
// Identifies non-data rows like date headers, section labels, etc.
// ==========================================================================
function isLabelOrJunkRow(nonEmptyCells) {
    if (!nonEmptyCells || nonEmptyCells.length === 0) return true;

    const first = nonEmptyCells[0].trim();

    // Empty first cell with only 1 total non-empty cell that has no UID
    if (nonEmptyCells.length === 1 && !isUid(first.replace(/\s+/g, ''))) {
        // Date patterns: DD-MM-YY, DD-MM-YYYY, MM/DD/YYYY, YYYY-MM-DD
        if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(first)) return true;

        // Date + text: "11-05-26 ID BY Ridoy Vai"
        if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\s/.test(first)) return true;

        // Pure date rows
        if (/^\d{4}-\d{2}-\d{2}$/.test(first)) return true;
    }

    // Multi-cell rows: first cell looks like a date
    if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(first)) {
        // And the remaining cells look like name/label text (not UIDs or cookies)
        const allNonUid = nonEmptyCells.every(c => !isUid(c.replace(/\s+/g, '')) && !hasCookieMarkers(c));
        if (allNonUid) return true;
    }

    // Label phrases commonly found in these Excel sheets
    const labelPhrasePatterns = [
        /\bID\s+BY\b/i,
        /\bLink\s+Click\b/i,
        /\bBoosts?\b/i,
        /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i,
        /^(?:January|February|March|April|May|June|July|August|September|October|November|December)$/i,
        /^Total\s*:/i,
        /^Date\s*:/i,
        /^Name\s*:/i,
        /^S\.?N\.?\s*$/i,
    ];

    const fullText = nonEmptyCells.join(' ');
    for (const pattern of labelPhrasePatterns) {
        if (pattern.test(fullText)) return true;
    }

    // Single cell that is just a word/label (not UID, not cookie, not a password-like string)
    if (nonEmptyCells.length <= 2) {
        const hasUid = nonEmptyCells.some(c => isUid(c.replace(/\s+/g, '')));
        const hasCookie = nonEmptyCells.some(c => hasCookieMarkers(c));
        if (!hasUid && !hasCookie) {
            // If the first cell is a long descriptive text without any numbers that could be UID
            if (first.length > 5 && !/\d{7,}/.test(first) && /[a-zA-Z]{3,}/.test(first)) {
                // Contains spaces or separators — looks like a label
                if (first.includes(' ') && !/[@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(first.replace(/[\s\-]/g, ''))) {
                    return true;
                }
            }
        }
    }

    return false;
}

// ==========================================================================
// FIX 2: EMPTY COLUMN COLLAPSE
// Strips all empty cells from a row; returns only non-empty values
// ==========================================================================
function collapseNonEmptyCells(row) {
    return row
        .map(cell => (cell !== null && cell !== undefined ? String(cell).trim() : ''))
        .filter(c => c !== '');
}

// ==========================================================================
// UNIVERSAL FILE PARSER WITH HEADER MAPPING & ADVANCED ISOLATION
// ==========================================================================
function parseAnyFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', raw: true });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Use raw:true so numeric UIDs are not converted to scientific notation by XLSX
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true });
                if (!rows || rows.length === 0) {
                    resolve({ records: [], junkSkipped: 0 });
                    return;
                }

                // 1. Find header row (first row that has header-like content)
                let headerMap = { hasHeaders: false };
                let startIndex = 0;

                for (let i = 0; i < Math.min(5, rows.length); i++) {
                    const candidate = detectHeaderMapping(rows[i]);
                    if (candidate.hasHeaders) {
                        headerMap = candidate;
                        startIndex = i + 1;
                        break;
                    }
                }

                const parsedRecords = [];
                let junkSkipped = 0;

                for (let r = startIndex; r < rows.length; r++) {
                    const row = rows[r];
                    if (!row || row.length === 0) { junkSkipped++; continue; }

                    // FIX 2: Collapse non-empty cells
                    const nonEmptyCells = collapseNonEmptyCells(row);
                    if (nonEmptyCells.length === 0) { junkSkipped++; continue; }

                    // FIX 1: Skip label/junk rows
                    if (isLabelOrJunkRow(nonEmptyCells)) {
                        junkSkipped++;
                        continue;
                    }

                    const record = headerMap.hasHeaders
                        ? extractRecordFromHeaderMappedRow(row.map(c => c !== null && c !== undefined ? String(c).trim() : ''), headerMap, file.name)
                        : extractRecordFromUniversalRow(nonEmptyCells, file.name);

                    if (record && record.uid) {
                        parsedRecords.push(record);
                    } else {
                        junkSkipped++;
                    }
                }

                resolve({ records: parsedRecords, junkSkipped });
            } catch (error) {
                parseTextFileFallback(file).then(resolve).catch(reject);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
}

function parseTextFileFallback(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                const lines = content.split(/\r\n|\n|\r/);
                const parsedRecords = [];
                let junkSkipped = 0;

                lines.forEach((line) => {
                    line = line.trim();
                    if (!line) { junkSkipped++; return; }

                    let parts = [line];
                    if (line.includes('\t')) {
                        parts = line.split('\t');
                    } else if (line.includes('|')) {
                        parts = line.split('|');
                    }

                    const nonEmptyCells = parts.map(p => p.trim()).filter(p => p !== '');
                    if (isLabelOrJunkRow(nonEmptyCells)) { junkSkipped++; return; }

                    const record = extractRecordFromUniversalRow(nonEmptyCells, file.name);
                    if (record && record.uid) {
                        parsedRecords.push(record);
                    } else {
                        junkSkipped++;
                    }
                });

                resolve({ records: parsedRecords, junkSkipped });
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsText(file);
    });
}

// Header Row Detector
function detectHeaderMapping(firstRow) {
    if (!firstRow || !Array.isArray(firstRow)) return { hasHeaders: false };

    let uidCol = -1;
    let passCol = -1;
    let cookieCol = -1;

    for (let c = 0; c < firstRow.length; c++) {
        const h = String(firstRow[c] || '').trim().toLowerCase();
        if (/^(uid|account\s*id|user\s*id|profile|id|fb.?id)$/i.test(h)) {
            uidCol = c;
        } else if (/^(pass|password|pwd|psw|passcode|passwd)$/i.test(h)) {
            passCol = c;
        } else if (/^(cookies|cookie|session|c_user|cookie_data|ck)$/i.test(h)) {
            cookieCol = c;
        }
    }

    const hasHeaders = (uidCol !== -1 && (cookieCol !== -1 || passCol !== -1));
    return { hasHeaders, uidCol, passCol, cookieCol };
}

// Extraction for Header-Mapped Sheets
function extractRecordFromHeaderMappedRow(row, headerMap, sourceFileName) {
    let cookies = headerMap.cookieCol !== -1 ? (row[headerMap.cookieCol] || '') : '';
    let rawUid = headerMap.uidCol !== -1 ? (row[headerMap.uidCol] || '') : '';
    let pass = headerMap.passCol !== -1 ? (row[headerMap.passCol] || '') : '';

    // Scan all columns for cookies if not already found
    if (!hasCookieMarkers(cookies)) {
        for (let i = 0; i < row.length; i++) {
            if (hasCookieMarkers(row[i])) {
                cookies = row[i];
                break;
            }
        }
    }

    // Prefer c_user from cookies as UID (most accurate — avoids Excel float rounding)
    let cUserUid = '';
    if (cookies) {
        const match = cookies.match(/c_user=(\d{10,18})/i);
        if (match) cUserUid = match[1];
    }

    let uid = cUserUid || cleanScientificNotation(rawUid);
    if (!uid) {
        for (let i = 0; i < row.length; i++) {
            if (isUid(row[i])) {
                uid = cleanScientificNotation(row[i]);
                break;
            }
        }
    }

    // FIX 3: Sanitize Password — must not be UID, must not be cookie, must not be a number-looking UID
    pass = sanitizePassword(pass.trim(), uid, cUserUid, cookies);

    return buildRecord(uid, pass, cookies, sourceFileName);
}

// ==========================================================================
// FIX 3: UNIVERSAL EXTRACTION WITH IMPROVED PASSWORD DETECTION
// Handles: tab-separated, pipe-separated, multi-column, single-cell combos
// ==========================================================================
function extractRecordFromUniversalRow(cells, sourceFileName) {
    if (!cells || cells.length === 0) return null;

    // Skip literal header words
    const firstCell = cells[0].toLowerCase();
    if ((firstCell === 'uid' || firstCell === 'id' || firstCell === 'user' || firstCell === 'account') && cells.length <= 5) {
        if (cells.some(c => /^(pass|password|cookie|cookies)$/i.test(c.toLowerCase()))) {
            return null;
        }
    }

    // ---- SINGLE-CELL COMBO PARSING (e.g. UID|PASS|COOKIES or UID:PASS:cookies) ----
    if (cells.length === 1) {
        const c_str = cells[0];

        // Has cookie markers — parse combo
        if (hasCookieMarkers(c_str)) {
            if (c_str.includes('|')) {
                const parts = c_str.split('|').map(p => p.trim()).filter(p => p);
                let cookieIdx = -1;
                for (let i = 0; i < parts.length; i++) {
                    if (hasCookieMarkers(parts[i])) { cookieIdx = i; break; }
                }
                if (cookieIdx > 0) {
                    const cookies = parts[cookieIdx];
                    const cUserMatch = cookies.match(/c_user=(\d{10,18})/i);
                    const uid = cUserMatch ? cUserMatch[1] : cleanScientificNotation(parts[0]);
                    const rawPass = cookieIdx >= 2 ? parts[1] : '';
                    const pass = sanitizePassword(rawPass, uid, cUserMatch ? cUserMatch[1] : '', cookies);
                    return buildRecord(uid, pass, cookies, sourceFileName);
                }
            } else if (c_str.includes(':')) {
                const cookieStart = c_str.search(/(datr=|sb=|c_user=|xs=|fr=)/i);
                if (cookieStart !== -1) {
                    const prefix = c_str.substring(0, cookieStart).replace(/[:|\\t]+$/, '');
                    const cookies = c_str.substring(cookieStart);
                    const parts = prefix.split(':').map(p => p.trim()).filter(p => p);
                    const cUserMatch = cookies.match(/c_user=(\d{10,18})/i);
                    const uid = cUserMatch ? cUserMatch[1] : (parts.length > 0 ? cleanScientificNotation(parts[0]) : '');
                    const rawPass = parts.length >= 2 ? parts[1] : '';
                    const pass = sanitizePassword(rawPass, uid, cUserMatch ? cUserMatch[1] : '', cookies);
                    return buildRecord(uid, pass, cookies, sourceFileName);
                }
            }
        }

        // No cookie — try as standalone UID or UID:PASS
        if (c_str.includes(':')) {
            const parts = c_str.split(':').map(p => p.trim()).filter(p => p);
            if (parts.length >= 2 && isUid(cleanScientificNotation(parts[0]))) {
                const uid = cleanScientificNotation(parts[0]);
                const pass = sanitizePassword(parts[1], uid, '', '');
                return buildRecord(uid, pass, '', sourceFileName);
            }
        }

        // Just a raw UID
        const cleaned = cleanScientificNotation(c_str);
        if (isUid(cleaned)) {
            return buildRecord(cleaned, '', '', sourceFileName);
        }

        return null;
    }

    // ---- MULTI-COLUMN ROW PARSING ----

    // Step A: Find cookies column
    let cookieIdx = -1;
    let cookies = '';
    for (let i = 0; i < cells.length; i++) {
        if (hasCookieMarkers(cells[i])) {
            cookies = cells[i];
            cookieIdx = i;
            break;
        }
    }

    // Step B: Extract c_user from cookies (most reliable UID source)
    let cUserUid = '';
    if (cookies) {
        const match = cookies.match(/c_user=(\d{10,18})/i);
        if (match) cUserUid = match[1];
    }

    // Step C: Find UID columns (skip cookie col)
    let uid = '';
    const uidIndices = new Set();
    for (let i = 0; i < cells.length; i++) {
        if (i === cookieIdx) continue;
        const c_clean = cleanScientificNotation(cells[i].replace(/\s+/g, ''));
        if (isUid(c_clean)) {
            uidIndices.add(i);
            if (!uid) {
                uid = cUserUid || c_clean;
            }
        }
    }
    if (!uid && cUserUid) uid = cUserUid;
    if (!uid) return null;

    // Step D: FIX 3 CORE — Smart Password Extraction
    // PASSWORD PRIORITY:
    //   1. Column index 1 (column B) — most common in user's format
    //   2. First non-UID, non-cookie, non-junk short string
    let pass = '';

    // Priority 1: Check index 1 (column B) — if not a UID, not a cookie, not a number
    if (cells.length > 1 && cookieIdx !== 1 && !uidIndices.has(1)) {
        const colB = cells[1];
        const colBClean = colB.replace(/\s+/g, '');
        if (colB && isValidPassword(colB, colBClean, uid, cUserUid, cookies)) {
            pass = colB;
        }
    }

    // Priority 2: Scan remaining columns for password
    if (!pass) {
        for (let i = 0; i < cells.length; i++) {
            if (i === cookieIdx || uidIndices.has(i)) continue;
            if (i === 1 && pass === '') {
                // Already checked above and rejected
            }
            const val = cells[i];
            const valClean = val.replace(/\s+/g, '');
            if (val && isValidPassword(val, valClean, uid, cUserUid, cookies)) {
                pass = val;
                break;
            }
        }
    }

    return buildRecord(uid, pass, cookies, sourceFileName);
}

// ==========================================================================
// FIX 3 HELPER: isValidPassword — Strict validation to identify real passwords
// ==========================================================================
function isValidPassword(val, valClean, uid, cUserUid, cookies) {
    if (!val || val.length === 0) return false;
    const valLow = val.toLowerCase().trim();

    // Skip header words
    if (['uid', 'pass', 'password', 'cookies', 'cookie', 'series', 'active', 'dead', 'status', '2fa', 'id'].includes(valLow)) return false;

    // Skip if same as UID
    if (valClean === uid || valClean === cUserUid) return false;
    if (val.trim() === uid) return false;

    // Skip if looks like a cookie string
    if (hasCookieMarkers(val)) return false;

    // Skip if pure scientific notation representing UID
    if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(valClean)) return false;

    // Skip if looks like another FB UID (10+ digits)
    if (/^\d{10,}$/.test(valClean)) return false;

    // Skip small serial row numbers (1 to 4 digits only)
    if (/^\d{1,4}$/.test(valClean)) return false;

    // Skip date-like values
    if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(val.trim())) return false;

    // Skip label phrases
    if (/\bID\s+BY\b/i.test(val)) return false;

    // Must be reasonable password length (3 to 100 chars after trim)
    const trimmed = val.trim();
    if (trimmed.length < 3 || trimmed.length > 100) return false;

    return true;
}

// Sanitize a candidate password string (used in header-mapped extraction)
function sanitizePassword(pass, uid, cUserUid, cookies) {
    if (!pass) return '';
    const passClean = pass.replace(/\s+/g, '');
    if (isValidPassword(pass, passClean, uid, cUserUid, cookies)) return pass.trim();
    return '';
}

function buildRecord(uid, pass, cookies, sourceFileName) {
    let series = 'Others';
    if (uid && uid.startsWith('1000')) {
        series = '1000xxx';
    } else if (uid && uid.startsWith('61')) {
        series = '61xxx';
    }

    return {
        id: 'rec_' + Math.random().toString(36).substr(2, 9),
        uid: uid,
        pass: pass,
        cookies: cookies,
        series: series,
        isDead: state.pastedDeadUids.has(uid),
        sourceFile: sourceFileName
    };
}

function hasCookieMarkers(str) {
    if (!str || typeof str !== 'string' || str.length < 15) return false;
    const lower = str.toLowerCase();
    const markers = ['datr=', 'c_user=', 'xs=', 'sb=', 'fr=', 'm_pixel', 'locale='];
    let count = 0;
    for (const m of markers) {
        if (lower.includes(m)) count++;
    }
    return count >= 1 && (str.length > 35 || lower.includes('c_user=') || lower.includes('datr='));
}

function isUid(text) {
    if (!text) return false;
    const clean = String(text).trim().replace(/\s+/g, '');
    if (/^\d{10,18}$/.test(clean)) return true;
    if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(clean)) return true;
    return false;
}

// Convert scientific notation e.g. 1.00019E+14 / 6.16E+13
function cleanScientificNotation(val) {
    if (!val) return '';
    val = String(val).trim();

    if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(val)) {
        try {
            const num = Number(val);
            if (isNaN(num)) return val;
            return BigInt(Math.round(num)).toString();
        } catch (e) {
            return val;
        }
    }
    return val;
}

function extractUidsFromText(text) {
    if (!text) return [];
    const lines = text.split(/[\r\n,;|\s]+/);
    const uids = new Set();

    for (let item of lines) {
        item = item.trim();
        if (!item) continue;

        const cUserMatch = item.match(/c_user=(\d+)/i);
        if (cUserMatch) { uids.add(cUserMatch[1]); continue; }

        const cleanItem = cleanScientificNotation(item);
        if (/^\d{10,18}$/.test(cleanItem)) { uids.add(cleanItem); continue; }

        const digitMatch = item.match(/\b\d{10,18}\b/);
        if (digitMatch) uids.add(digitMatch[0]);
    }
    return Array.from(uids);
}

function updateDeadMatchingState(forceRerender = false) {
    const rawText = elements.deadUidsInput.value;
    const uids = extractUidsFromText(rawText);
    state.pastedDeadUids = new Set(uids);

    elements.deadPastedCount.innerHTML = `<i class="fa-solid fa-list-check"></i> ${uids.length.toLocaleString()} Dead UIDs loaded`;

    let matchedCount = 0;
    state.records.forEach(r => {
        if (state.pastedDeadUids.has(r.uid)) {
            r.isDead = true;
            matchedCount++;
        } else {
            r.isDead = false;
        }
    });

    elements.matchedStatus.textContent = `${matchedCount.toLocaleString()} Found in Sheets`;
    elements.btnStartPurge.disabled = matchedCount === 0;

    updateStatsAndCounts();
    if (forceRerender) renderTable();
    return matchedCount;
}

function executeDeadUidDeletion() {
    const deadRows = state.records.filter(r => r.isDead || state.pastedDeadUids.has(r.uid));
    const deadCount = deadRows.length;

    if (deadCount === 0) {
        showToast('No dead lines found to delete.', 'info');
        return;
    }

    deadRows.forEach(r => state.activeUidSet.delete(r.uid));
    state.records = state.records.filter(r => !r.isDead && !state.pastedDeadUids.has(r.uid));
    state.deletedDeadCount += deadCount;

    elements.deadUidsInput.value = '';
    state.pastedDeadUids.clear();
    elements.deadFileName.textContent = 'No file selected';
    elements.deadPastedCount.innerHTML = `<i class="fa-solid fa-list-check"></i> 0 Dead UIDs loaded`;
    elements.matchedStatus.textContent = `0 Found in Sheets`;
    elements.btnStartPurge.disabled = true;

    state.isStep2Completed = true;
    elements.step2Downloads.classList.remove('hidden');

    updateStep1DownloadsUI();
    updateStatsAndCounts();
    renderTable();

    logMessage(`Step 2 Purge Executed: Deleted ${deadCount.toLocaleString()} Dead Lines (UID + PASS + COOKIES) permanently.`, 'error');
    showToast(`Step 2 Done! Purged ${deadCount.toLocaleString()} dead rows.`);
}

function updateStatsAndCounts() {
    const total = state.totalRawRowsUploaded;
    const unique = state.records.length;
    const total1000 = state.records.filter(r => r.series === '1000xxx' && !r.isDead).length;
    const total61 = state.records.filter(r => r.series === '61xxx' && !r.isDead).length;
    const currentDeadMatched = state.records.filter(r => r.isDead).length;

    elements.statTotal.textContent = total.toLocaleString();
    elements.statUnique.textContent = unique.toLocaleString();
    elements.statDup.textContent = state.duplicateUidsRemoved.toLocaleString();
    elements.stat1000.textContent = total1000.toLocaleString();
    elements.stat61.textContent = total61.toLocaleString();
    elements.statDead.textContent = (state.deletedDeadCount + currentDeadMatched).toLocaleString();

    elements.badgeAll.textContent = unique.toLocaleString();
    elements.badge1000.textContent = total1000.toLocaleString();
    elements.badge61.textContent = total61.toLocaleString();
    elements.badgeOthers.textContent = state.records.filter(r => r.series === 'Others' && !r.isDead).length.toLocaleString();
}

function renderTable() {
    let filtered = state.records;

    if (state.currentTab === '1000') {
        filtered = filtered.filter(r => r.series === '1000xxx');
    } else if (state.currentTab === '61') {
        filtered = filtered.filter(r => r.series === '61xxx');
    } else if (state.currentTab === 'others') {
        filtered = filtered.filter(r => r.series === 'Others');
    }

    if (state.searchQuery) {
        const q = state.searchQuery;
        filtered = filtered.filter(r =>
            r.uid.toLowerCase().includes(q) ||
            (r.pass && r.pass.toLowerCase().includes(q)) ||
            (r.cookies && r.cookies.toLowerCase().includes(q)) ||
            r.sourceFile.toLowerCase().includes(q)
        );
    }

    const totalFiltered = filtered.length;
    elements.totalEntries.textContent = totalFiltered.toLocaleString();

    if (totalFiltered === 0) {
        elements.tableBody.innerHTML = `
            <tr class="empty-row">
                <td colspan="8">
                    <div class="empty-state-box">
                        <div class="empty-icon"><i class="fa-solid fa-file-excel"></i></div>
                        <h3>${state.records.length === 0 ? 'Ready for Processing' : 'No Records Match Query'}</h3>
                        <p>${state.records.length === 0 ? 'Drop your Excel files in Step 1 to auto-filter and preview.' : 'Try adjusting your search query or tab filter.'}</p>
                    </div>
                </td>
            </tr>
        `;
        elements.pageStart.textContent = '0';
        elements.pageEnd.textContent = '0';
        elements.btnPrevPage.disabled = true;
        elements.btnNextPage.disabled = true;
        return;
    }

    const totalPages = Math.ceil(totalFiltered / state.rowsPerPage);
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIndex = (state.currentPage - 1) * state.rowsPerPage;
    const endIndex = Math.min(startIndex + state.rowsPerPage, totalFiltered);
    const paginatedItems = filtered.slice(startIndex, endIndex);

    elements.pageStart.textContent = (startIndex + 1).toLocaleString();
    elements.pageEnd.textContent = endIndex.toLocaleString();
    elements.currentPageNum.textContent = state.currentPage;
    elements.btnPrevPage.disabled = state.currentPage <= 1;
    elements.btnNextPage.disabled = state.currentPage >= totalPages;

    elements.tableBody.innerHTML = paginatedItems.map((record, idx) => {
        const rowNum = startIndex + idx + 1;
        const isDead = record.isDead;
        const seriesClass = record.series === '1000xxx' ? 'badge-1000' : (record.series === '61xxx' ? 'badge-61' : 'badge-other');
        const srcName = record.sourceFile.length > 20 ? record.sourceFile.substring(0, 18) + '…' : record.sourceFile;

        return `
            <tr class="${isDead ? 'row-dead' : ''}" id="${record.id}">
                <td>${rowNum}</td>
                <td>
                    <div class="uid-cell">
                        <span>${escapeHtml(record.uid)}</span>
                        <button class="btn-icon-copy" onclick="copyText('${record.uid}')" title="Copy UID">
                            <i class="fa-regular fa-copy"></i>
                        </button>
                    </div>
                </td>
                <td>
                    <div class="pass-cell">
                        ${record.pass
                            ? `<span class="pass-value">${escapeHtml(record.pass)}</span>
                               <button class="btn-icon-copy btn-copy-pass" onclick="copyText('${escapeHtml(record.pass).replace(/'/g, "\\'")}')" title="Copy Password">
                                   <i class="fa-regular fa-copy"></i>
                               </button>`
                            : '<span style="color:#38bdf8; opacity: 0.45; font-size:0.8em;">[No Pass]</span>'
                        }
                    </div>
                </td>
                <td>
                    <div class="cookie-cell" title="${escapeHtml(record.cookies)}">
                        ${record.cookies
                            ? escapeHtml(record.cookies)
                            : '<span style="color:#38bdf8; opacity: 0.4; font-size:0.8em;">—</span>'
                        }
                    </div>
                </td>
                <td>
                    <span class="badge-series ${seriesClass}">${record.series}</span>
                </td>
                <td>
                    <span class="badge-status ${isDead ? 'dead' : 'active'}">
                        ${isDead ? '<i class="fa-solid fa-skull"></i> DEAD' : '<i class="fa-solid fa-check"></i> ACTIVE'}
                    </span>
                </td>
                <td>
                    <span class="src-file-label" title="${escapeHtml(record.sourceFile)}">${escapeHtml(srcName)}</span>
                </td>
                <td>
                    <button class="btn-icon-delete" onclick="deleteSingleRecord('${record.id}')" title="Delete line">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

window.deleteSingleRecord = function(id) {
    const idx = state.records.findIndex(r => r.id === id);
    if (idx !== -1) {
        const rec = state.records[idx];
        state.activeUidSet.delete(rec.uid);
        state.records.splice(idx, 1);
        updateStep1DownloadsUI();
        updateStatsAndCounts();
        updateDeadMatchingState();
        renderTable();
        logMessage(`Manually deleted UID: ${rec.uid}`, 'info');
        showToast('Line removed.');
    }
};

window.exportToExcel = function(type) {
    let dataToExport = [];
    let filename = '';
    const dateStr = new Date().toISOString().slice(0, 10);

    if (type === '1000') {
        dataToExport = state.records.filter(r => r.series === '1000xxx' && !r.isDead);
        filename = `1000_Series_${dateStr}.xlsx`;
    } else if (type === '61') {
        dataToExport = state.records.filter(r => r.series === '61xxx' && !r.isDead);
        filename = `61_Series_${dateStr}.xlsx`;
    } else if (type === 'others') {
        dataToExport = state.records.filter(r => r.series === 'Others' && !r.isDead);
        filename = `Other_Series_${dateStr}.xlsx`;
    } else {
        dataToExport = state.records.filter(r => !r.isDead);
        filename = `Clean_Merged_Dataset_${dateStr}.xlsx`;
    }

    if (dataToExport.length === 0) {
        showToast('No active clean records available to export.', 'warning');
        return;
    }

    // FIX 5: Include source file column in export
    const headers = ['UID', 'PASS', 'COOKIES', 'SERIES', 'SOURCE_FILE'];
    const rows = [headers];

    dataToExport.forEach(r => {
        rows.push([r.uid, r.pass, r.cookies, r.series, r.sourceFile]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    // Force UID column to text format to prevent scientific notation in Excel
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let R = 1; R <= range.e.r; ++R) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: 0 });
        if (worksheet[cellAddress]) {
            worksheet[cellAddress].t = 's';
            worksheet[cellAddress].z = '@';
        }
    }

    worksheet['!cols'] = [
        { wch: 22 },  // UID
        { wch: 20 },  // PASS
        { wch: 60 },  // COOKIES
        { wch: 12 },  // SERIES
        { wch: 28 },  // SOURCE_FILE
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Filtered Data');

    XLSX.writeFile(workbook, filename);
    logMessage(`Exported '${filename}' with ${dataToExport.length.toLocaleString()} clean rows.`, 'success');
    showToast(`Downloaded ${filename} successfully!`);
};

window.copyText = function(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied: ' + text.substring(0, 40) + (text.length > 40 ? '...' : ''));
    }).catch(() => {
        showToast('Failed to copy');
    });
};

function showToast(message, type = 'success') {
    elements.toastMessage.textContent = message;
    elements.toast.classList.remove('hidden');

    const icon = elements.toast.querySelector('.toast-icon');
    if (type === 'warning' || type === 'error') {
        icon.className = 'toast-icon fa-solid fa-triangle-exclamation';
        elements.toast.style.borderColor = '#ef4444';
    } else {
        icon.className = 'toast-icon fa-solid fa-circle-check';
        elements.toast.style.borderColor = '#38bdf8';
    }

    setTimeout(() => {
        elements.toast.classList.add('hidden');
    }, 3500);
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Bootstrap App
document.addEventListener('DOMContentLoaded', async () => {
    logMessage('SkyFilter PRO Engine v5.0 Initializing — Bulletproof Isolation Active...', 'process');
    // FIX 4: Await DB load BEFORE any processing can start
    await loadHistoricalDatabase();
    initEvents();
    logMessage('Engine ready. Upload Excel files to begin.', 'success');
});
