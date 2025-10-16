// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Application state
const state = {
    pdfDoc: null,
    pdfBytes: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.5,
    isDrawing: false,
    signatureData: null,
    signatures: [], // Array of {x, y, width, height, data, page}
    canvasOffset: { x: 0, y: 0 }
};

// DOM elements
const uploadSection = document.getElementById('uploadSection');
const viewerSection = document.getElementById('viewerSection');
const uploadBox = document.getElementById('uploadBox');
const pdfInput = document.getElementById('pdfInput');
const browseBtn = document.getElementById('browseBtn');
const pdfCanvas = document.getElementById('pdfCanvas');
const canvasContainer = document.getElementById('canvasContainer');
const signatureMarkers = document.getElementById('signatureMarkers');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const currentPageSpan = document.getElementById('currentPage');
const totalPagesSpan = document.getElementById('totalPages');
const addSignatureBtn = document.getElementById('addSignatureBtn');
const downloadBtn = document.getElementById('downloadBtn');
const newDocBtn = document.getElementById('newDocBtn');

// Signature modal elements
const signatureModal = document.getElementById('signatureModal');
const signatureCanvas = document.getElementById('signatureCanvas');
const closeModalBtn = document.getElementById('closeModalBtn');
const clearSignatureBtn = document.getElementById('clearSignatureBtn');
const cancelSignatureBtn = document.getElementById('cancelSignatureBtn');
const saveSignatureBtn = document.getElementById('saveSignatureBtn');
const signatureColor = document.getElementById('signatureColor');
const signatureSize = document.getElementById('signatureSize');

let signatureCtx = null;

// Initialize signature canvas
function initSignatureCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = signatureCanvas.getBoundingClientRect();

    signatureCanvas.width = rect.width * dpr;
    signatureCanvas.height = rect.height * dpr;

    signatureCtx = signatureCanvas.getContext('2d');
    signatureCtx.scale(dpr, dpr);
    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';
}

// Event Listeners - Upload
browseBtn.addEventListener('click', () => pdfInput.click());
pdfInput.addEventListener('change', handleFileSelect);

// Drag and drop
uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
});

uploadBox.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
});

uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        loadPDF(file);
    }
});

// Handle file selection
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
        loadPDF(file);
    }
}

// Load PDF file
async function loadPDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();

        // Create a copy for PDF.js to use (this will be transferred to worker and detached)
        const uint8ArrayForPdfJs = new Uint8Array(arrayBuffer);

        // Create a completely independent copy for pdf-lib by copying the bytes
        // This prevents the ArrayBuffer from being detached
        const pdfBytesForPdfLib = new Uint8Array(arrayBuffer.byteLength);
        pdfBytesForPdfLib.set(new Uint8Array(arrayBuffer));
        state.pdfBytes = pdfBytesForPdfLib;

        const loadingTask = pdfjsLib.getDocument({ data: uint8ArrayForPdfJs });
        state.pdfDoc = await loadingTask.promise;
        state.totalPages = state.pdfDoc.numPages;
        state.currentPage = 1;
        state.signatures = [];

        // Switch to viewer
        uploadSection.style.display = 'none';
        viewerSection.style.display = 'block';

        // Update UI
        totalPagesSpan.textContent = state.totalPages;
        updatePageButtons();

        // Render first page
        await renderPage(state.currentPage);
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('נכשל בטעינת ה-PDF. אנא נסה שוב.');
    }
}

// Render PDF page
async function renderPage(pageNum) {
    try {
        const page = await state.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: state.scale });

        const context = pdfCanvas.getContext('2d');
        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        await page.render(renderContext).promise;

        // Update canvas offset for signature placement
        const rect = pdfCanvas.getBoundingClientRect();
        const containerRect = canvasContainer.getBoundingClientRect();
        state.canvasOffset.x = rect.left - containerRect.left + canvasContainer.scrollLeft;
        state.canvasOffset.y = rect.top - containerRect.top + canvasContainer.scrollTop;

        // Render signature markers for current page
        renderSignatureMarkers();

        currentPageSpan.textContent = pageNum;
    } catch (error) {
        console.error('Error rendering page:', error);
    }
}

// Update page navigation buttons
function updatePageButtons() {
    prevPageBtn.disabled = state.currentPage <= 1;
    nextPageBtn.disabled = state.currentPage >= state.totalPages;
}

// Page navigation
prevPageBtn.addEventListener('click', async () => {
    if (state.currentPage > 1) {
        state.currentPage--;
        await renderPage(state.currentPage);
        updatePageButtons();
    }
});

nextPageBtn.addEventListener('click', async () => {
    if (state.currentPage < state.totalPages) {
        state.currentPage++;
        await renderPage(state.currentPage);
        updatePageButtons();
    }
});

// Add signature button
addSignatureBtn.addEventListener('click', () => {
    openSignatureModal();
});

// Open signature modal
function openSignatureModal() {
    signatureModal.style.display = 'flex';
    initSignatureCanvas();
    clearSignature();
}

// Close signature modal
function closeSignatureModal() {
    signatureModal.style.display = 'none';
}

closeModalBtn.addEventListener('click', closeSignatureModal);
cancelSignatureBtn.addEventListener('click', closeSignatureModal);

// Signature drawing
let lastX = 0;
let lastY = 0;

signatureCanvas.addEventListener('mousedown', startDrawing);
signatureCanvas.addEventListener('mousemove', draw);
signatureCanvas.addEventListener('mouseup', stopDrawing);
signatureCanvas.addEventListener('mouseout', stopDrawing);

// Touch events for mobile
signatureCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    signatureCanvas.dispatchEvent(mouseEvent);
});

signatureCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    signatureCanvas.dispatchEvent(mouseEvent);
});

signatureCanvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    const mouseEvent = new MouseEvent('mouseup', {});
    signatureCanvas.dispatchEvent(mouseEvent);
});

function startDrawing(e) {
    state.isDrawing = true;
    const rect = signatureCanvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
}

function draw(e) {
    if (!state.isDrawing) return;

    const rect = signatureCanvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    signatureCtx.strokeStyle = signatureColor.value;
    signatureCtx.lineWidth = signatureSize.value;

    signatureCtx.beginPath();
    signatureCtx.moveTo(lastX, lastY);
    signatureCtx.lineTo(currentX, currentY);
    signatureCtx.stroke();

    lastX = currentX;
    lastY = currentY;
}

function stopDrawing() {
    state.isDrawing = false;
}

// Clear signature
clearSignatureBtn.addEventListener('click', clearSignature);

function clearSignature() {
    const rect = signatureCanvas.getBoundingClientRect();
    signatureCtx.clearRect(0, 0, rect.width, rect.height);
}

// Save signature
saveSignatureBtn.addEventListener('click', () => {
    const signatureDataUrl = signatureCanvas.toDataURL('image/png');

    // Check if signature is empty
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = signatureCanvas.width;
    tempCanvas.height = signatureCanvas.height;
    if (signatureDataUrl === tempCanvas.toDataURL('image/png')) {
        alert('אנא צייר חתימה תחילה!');
        return;
    }

    state.signatureData = signatureDataUrl;
    closeSignatureModal();

    // Enable click on canvas to place signature
    enableSignaturePlacement();
});

// Enable signature placement on PDF
function enableSignaturePlacement() {
    pdfCanvas.style.cursor = 'crosshair';

    const placementHandler = (e) => {
        const rect = pdfCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Add signature marker
        addSignatureMarker(x, y);

        // Remove handler after placing
        pdfCanvas.removeEventListener('click', placementHandler);
        pdfCanvas.style.cursor = 'default';
    };

    pdfCanvas.addEventListener('click', placementHandler);
}

// Add signature marker
function addSignatureMarker(x, y) {
    const marker = {
        x: x,
        y: y,
        width: 150,
        height: 50,
        data: state.signatureData,
        page: state.currentPage
    };

    state.signatures.push(marker);
    renderSignatureMarkers();
    downloadBtn.disabled = false;
}

// Render signature markers
function renderSignatureMarkers() {
    signatureMarkers.innerHTML = '';

    // Get current page signatures
    const pageSignatures = state.signatures.filter(sig => sig.page === state.currentPage);

    pageSignatures.forEach((sig, index) => {
        const markerDiv = document.createElement('div');
        markerDiv.className = 'signature-marker';
        markerDiv.style.left = `${state.canvasOffset.x + sig.x}px`;
        markerDiv.style.top = `${state.canvasOffset.y + sig.y}px`;
        markerDiv.style.width = `${sig.width}px`;
        markerDiv.style.height = `${sig.height}px`;

        const img = document.createElement('img');
        img.src = sig.data;
        markerDiv.appendChild(img);

        // Add remove button
        const removeBtn = document.createElement('div');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeSignature(sig);
        };
        markerDiv.appendChild(removeBtn);

        // Make draggable
        makeDraggable(markerDiv, sig);

        signatureMarkers.appendChild(markerDiv);
    });
}

// Make signature marker draggable
function makeDraggable(element, signature) {
    let isDragging = false;
    let startX, startY;

    element.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - element.offsetLeft;
        startY = e.clientY - element.offsetTop;
        element.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const rect = pdfCanvas.getBoundingClientRect();
        let newX = e.clientX - startX - state.canvasOffset.x;
        let newY = e.clientY - startY - state.canvasOffset.y;

        // Constrain to canvas bounds
        newX = Math.max(0, Math.min(newX, pdfCanvas.width - signature.width));
        newY = Math.max(0, Math.min(newY, pdfCanvas.height - signature.height));

        signature.x = newX;
        signature.y = newY;

        element.style.left = `${state.canvasOffset.x + newX}px`;
        element.style.top = `${state.canvasOffset.y + newY}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            element.style.cursor = 'move';
        }
    });
}

// Remove signature
function removeSignature(signature) {
    const index = state.signatures.indexOf(signature);
    if (index > -1) {
        state.signatures.splice(index, 1);
        renderSignatureMarkers();

        if (state.signatures.length === 0) {
            downloadBtn.disabled = true;
        }
    }
}

// Download PDF with signatures
downloadBtn.addEventListener('click', async () => {
    try {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<div class="loading"></div> מעבד...';

        // Load PDF with pdf-lib - use the buffer property
        const pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes.buffer);

        // Process each signature
        for (const sig of state.signatures) {
            const page = pdfDoc.getPage(sig.page - 1);
            const { width, height } = page.getSize();

            // Convert signature image to PDF format
            const signatureImage = await pdfDoc.embedPng(sig.data);

            // Calculate position (PDF coordinates start from bottom-left)
            const x = (sig.x / pdfCanvas.width) * width;
            const y = height - ((sig.y / pdfCanvas.height) * height) - ((sig.height / pdfCanvas.height) * height);
            const sigWidth = (sig.width / pdfCanvas.width) * width;
            const sigHeight = (sig.height / pdfCanvas.height) * height;

            // Draw signature on page
            page.drawImage(signatureImage, {
                x: x,
                y: y,
                width: sigWidth,
                height: sigHeight,
            });
        }

        // Save modified PDF
        const pdfBytes = await pdfDoc.save();

        // Download
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'signed-document.pdf';
        link.click();
        URL.revokeObjectURL(url);

        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            הורד PDF
        `;

        alert('ה-PDF הורד בהצלחה!');
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('נכשל ביצירת ה-PDF. אנא נסה שוב.');
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            הורד PDF
        `;
    }
});

// New document button
newDocBtn.addEventListener('click', () => {
    if (confirm('האם אתה בטוח שברצונך להתחיל מסמך חדש? כל השינויים שלא נשמרו יאבדו.')) {
        resetApplication();
    }
});

// Reset application
function resetApplication() {
    state.pdfDoc = null;
    state.pdfBytes = null;
    state.currentPage = 1;
    state.totalPages = 0;
    state.signatureData = null;
    state.signatures = [];

    viewerSection.style.display = 'none';
    uploadSection.style.display = 'flex';
    pdfInput.value = '';
    downloadBtn.disabled = true;
}

// Window resize handler
window.addEventListener('resize', () => {
    if (state.pdfDoc) {
        renderPage(state.currentPage);
    }
});
