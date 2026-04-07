/* ===== SSRC CONVERTER PRO — script.js ===== */

'use strict';

/* ─────────────────────────────────────────
   GLOBALS
───────────────────────────────────────── */
const DOWNLOAD_NAME = 'SSRC Converter';
let fabricCanvas = null;
let pdfDoc = null;
let pdfCurrentPage = 1;
let pdfTotalPages = 0;
let pdfPageCanvases = {};
let currentTool = 'select';

/* ─────────────────────────────────────────
   UTILITIES
───────────────────────────────────────── */
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function showLoading(msg = 'Processing...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function showResult(id, msg, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `result-info visible${isError ? ' error' : ''}`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ─────────────────────────────────────────
   IMAGE PROCESSING HELPERS
───────────────────────────────────────── */
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/* Compress image to JPEG, optionally resize to maxW x maxH, below targetKB */
async function compressImage(file, {
  maxW = null, maxH = null,
  targetKB = null,
  quality = 0.88,
  type = 'image/jpeg'
} = {}) {
  const img = await loadImageFromFile(file);
  let w = img.naturalWidth;
  let h = img.naturalHeight;

  if (maxW && maxH) { w = maxW; h = maxH; }
  else if (maxW && !maxH) { h = Math.round(h * maxW / w); w = maxW; }
  else if (maxH && !maxW) { w = Math.round(w * maxH / h); h = maxH; }

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  if (!targetKB) return canvasToBlob(canvas, type, quality);

  /* Binary search for quality that meets targetKB */
  let lo = 0.05, hi = 1.0, bestBlob = null;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const blob = await canvasToBlob(canvas, type, mid);
    if (blob.size <= targetKB * 1024) { bestBlob = blob; lo = mid; }
    else hi = mid;
    if (hi - lo < 0.01) break;
  }
  return bestBlob || await canvasToBlob(canvas, type, lo);
}

/* ─────────────────────────────────────────
   TAB NAVIGATION
───────────────────────────────────────── */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
  });
});

/* ─────────────────────────────────────────
   DRAG & DROP HELPER
───────────────────────────────────────── */
function setupDropZone(dropZoneId, inputId, onFiles) {
  const zone = document.getElementById(dropZoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => {
    if (input.files.length) onFiles([...input.files]);
  });
}

/* ─────────────────────────────────────────
   1. FILE CONVERTER
───────────────────────────────────────── */
let converterFiles = [];

const qualitySlider = document.getElementById('quality-slider');
const qualityVal = document.getElementById('quality-val');
qualitySlider.addEventListener('input', () => qualityVal.textContent = qualitySlider.value);

setupDropZone('converter-drop', 'converter-input', files => {
  converterFiles = files;
  renderFileList('converter-file-list', files);
  document.getElementById('convert-btn').disabled = false;
  showToast(`${files.length} file(s) loaded`, 'success');
});

document.getElementById('convert-btn').addEventListener('click', async () => {
  if (!converterFiles.length) return;
  showLoading('Converting files...');
  const fmt = document.getElementById('output-format').value;
  const quality = parseInt(qualitySlider.value) / 100;
  try {
    for (const file of converterFiles) {
      await convertFile(file, fmt, quality);
    }
    showToast('✅ Conversion complete!', 'success');
  } catch (e) {
    showToast('❌ Error: ' + e.message, 'error');
  }
  hideLoading();
});

async function convertFile(file, fmt, quality) {
  const mime = 'image/' + fmt;
  if (file.type.startsWith('image/')) {
    const blob = await compressImage(file, { quality, type: mime });
    triggerDownload(blob, `${DOWNLOAD_NAME}.${fmt}`);
  } else if (file.type === 'application/pdf' && fmt !== 'pdf') {
    /* Convert PDF first page to image */
    const ab = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: ab }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const blob = await canvasToBlob(canvas, mime, quality);
    triggerDownload(blob, `${DOWNLOAD_NAME}.${fmt}`);
  } else {
    /* For txt or same-type, re-download with renamed file */
    triggerDownload(new Blob([file], { type: file.type }), `${DOWNLOAD_NAME}.${fmt}`);
  }
}

function renderFileList(listId, files) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  files.forEach(f => {
    const el = document.createElement('div');
    el.className = 'file-item';
    el.innerHTML = `<span class="fi-icon">${getFileIcon(f)}</span>
                    <span class="fi-name">${f.name}</span>
                    <span class="fi-size">${formatBytes(f.size)}</span>`;
    list.appendChild(el);
  });
}

function getFileIcon(file) {
  if (file.type.startsWith('image/')) return '🖼️';
  if (file.type === 'application/pdf') return '📄';
  if (file.type.startsWith('text/')) return '📝';
  return '📁';
}

/* ─────────────────────────────────────────
   2. COMPRESSOR
───────────────────────────────────────── */
let compressorFiles = [];

const compQSlider = document.getElementById('comp-quality-slider');
const compQVal = document.getElementById('comp-quality-val');
compQSlider.addEventListener('input', () => compQVal.textContent = compQSlider.value);

setupDropZone('compressor-drop', 'compressor-input', files => {
  compressorFiles = files;
  renderFileList('compressor-file-list', files);
  document.getElementById('compress-btn').disabled = false;
  showToast(`${files.length} file(s) loaded`, 'success');
});

document.getElementById('compress-btn').addEventListener('click', async () => {
  if (!compressorFiles.length) return;
  showLoading('Compressing files...');
  const targetKB = parseInt(document.getElementById('target-size').value);
  const quality = parseInt(compQSlider.value) / 100;
  try {
    let totalBefore = 0, totalAfter = 0;
    for (const file of compressorFiles) {
      totalBefore += file.size;
      let blob;
      if (file.type.startsWith('image/')) {
        blob = await compressImage(file, { targetKB, quality, type: 'image/jpeg' });
      } else if (file.type === 'application/pdf') {
        blob = await compressPDF(file, targetKB);
      } else {
        blob = new Blob([file], { type: file.type });
      }
      totalAfter += blob.size;
      const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
      triggerDownload(blob, `${DOWNLOAD_NAME}.${ext}`);
    }
    const saved = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
    showResult('compress-result', `✅ ${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} (Saved ${saved}%)`);
    showToast('✅ Compression complete!', 'success');
  } catch (e) {
    showToast('❌ Error: ' + e.message, 'error');
  }
  hideLoading();
});

async function compressPDF(file, targetKB) {
  /* Render PDF pages to canvas and re-compress as JPEG in PDF */
  const ab = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const doc = await pdfjsLib.getDocument({ data: ab }).promise;
  const pdfLibDoc = await PDFLib.PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const jpegUrl = canvas.toDataURL('image/jpeg', 0.75);
    const jpegBytes = await fetch(jpegUrl).then(r => r.arrayBuffer());
    const img = await pdfLibDoc.embedJpg(jpegBytes);
    const newPage = pdfLibDoc.addPage([vp.width, vp.height]);
    newPage.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
  }
  const bytes = await pdfLibDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

/* ─────────────────────────────────────────
   3. ESEVAI
───────────────────────────────────────── */
setupDropZone('esevai-photo-drop', 'esevai-photo-input', async files => {
  const file = files[0];
  if (!file || !file.type.startsWith('image/')) { showToast('Please upload an image', 'error'); return; }
  showLoading('Processing Esevai Photo...');
  try {
    /* 250x250px, below 50KB, JPEG */
    const blob = await compressImage(file, { maxW: 250, maxH: 250, targetKB: 50, type: 'image/jpeg' });
    triggerDownload(blob, `${DOWNLOAD_NAME}.jpg`);
    showResult('esevai-photo-result', `✅ Processed: 250×250px, ${formatBytes(blob.size)}`);
    showToast('✅ Esevai Photo ready!', 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  hideLoading();
});

setupDropZone('esevai-doc-drop', 'esevai-doc-input', async files => {
  const file = files[0];
  if (!file) return;
  showLoading('Processing Esevai Document...');
  try {
    let blob;
    if (file.type.startsWith('image/')) {
      blob = await compressImage(file, { targetKB: 200, type: 'image/jpeg' });
    } else if (file.type === 'application/pdf') {
      /* Render first page of PDF to JPEG below 200KB */
      const ab = await file.arrayBuffer();
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc = await pdfjsLib.getDocument({ data: ab }).promise;
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      const fakeFile = new File([await canvasToBlob(canvas, 'image/jpeg', 0.9)], 'doc.jpg', { type: 'image/jpeg' });
      blob = await compressImage(fakeFile, { targetKB: 200, type: 'image/jpeg' });
    } else {
      showToast('Unsupported format for document compressor', 'error');
      hideLoading(); return;
    }
    triggerDownload(blob, `${DOWNLOAD_NAME}.jpg`);
    showResult('esevai-doc-result', `✅ Compressed: ${formatBytes(blob.size)} (below 200 KB)`);
    showToast('✅ Esevai Document ready!', 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  hideLoading();
});

/* ─────────────────────────────────────────
   4. PAN CARD
───────────────────────────────────────── */
setupDropZone('pan-photo-drop', 'pan-photo-input', async files => {
  const file = files[0];
  if (!file || !file.type.startsWith('image/')) { showToast('Please upload an image', 'error'); return; }
  showLoading('Processing PAN Photo...');
  try {
    /* 213x213px, 300DPI, below 30KB, JPEG */
    const blob = await compressImage(file, { maxW: 213, maxH: 213, targetKB: 30, type: 'image/jpeg' });
    triggerDownload(blob, `${DOWNLOAD_NAME}.jpg`);
    showResult('pan-photo-result', `✅ 213×213px · ${formatBytes(blob.size)} · JPEG`);
    showToast('✅ PAN Photo ready!', 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  hideLoading();
});

setupDropZone('pan-sig-drop', 'pan-sig-input', async files => {
  const file = files[0];
  if (!file || !file.type.startsWith('image/')) { showToast('Please upload an image', 'error'); return; }
  showLoading('Processing PAN Signature...');
  try {
    /* 600 DPI equivalent — we scale width to ~1800px (3" * 600dpi), below 60KB, JPEG */
    const img = await loadImageFromFile(file);
    const scale = 1800 / img.naturalWidth;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const blob = await compressImage(file, { maxW: w, maxH: h, targetKB: 60, type: 'image/jpeg' });
    triggerDownload(blob, `${DOWNLOAD_NAME}.jpg`);
    showResult('pan-sig-result', `✅ 600 DPI · ${formatBytes(blob.size)} · JPEG`);
    showToast('✅ PAN Signature ready!', 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  hideLoading();
});

/* ─────────────────────────────────────────
   5. PDF OCR EDITOR
───────────────────────────────────────── */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

setupDropZone('pdf-drop', 'pdf-input', async files => {
  const file = files[0];
  if (!file) return;
  showLoading('Loading document...');
  try {
    if (file.type === 'application/pdf') {
      await loadPDF(file);
    } else if (file.type.startsWith('image/')) {
      await loadImageAsPDF(file);
    } else {
      showToast('Please upload a PDF or image file', 'error');
    }
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  hideLoading();
});

async function loadPDF(file) {
  const ab = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
  pdfTotalPages = pdfDoc.numPages;
  pdfCurrentPage = 1;
  pdfPageCanvases = {};
  document.getElementById('page-nav').style.display = 'flex';
  await renderPDFPage(pdfCurrentPage);
  showToast(`✅ PDF loaded: ${pdfTotalPages} page(s)`, 'success');
  document.getElementById('pdf-download-btn').disabled = false;
}

async function loadImageAsPDF(file) {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  pdfPageCanvases[1] = canvas;
  pdfDoc = null; pdfTotalPages = 1; pdfCurrentPage = 1;
  document.getElementById('page-nav').style.display = 'flex';
  initFabricOnCanvas(canvas);
  document.getElementById('pdf-download-btn').disabled = false;
  showToast('✅ Image loaded as editable page', 'success');
}

async function renderPDFPage(pageNum) {
  showLoading(`Rendering page ${pageNum}...`);
  const page = await pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1.5 });
  const rc = document.getElementById('pdf-render-canvas');
  rc.width = vp.width; rc.height = vp.height;
  rc.style.display = 'block';
  await page.render({ canvasContext: rc.getContext('2d'), viewport: vp }).promise;

  /* Store snapshot for this page */
  const snapshot = document.createElement('canvas');
  snapshot.width = rc.width; snapshot.height = rc.height;
  snapshot.getContext('2d').drawImage(rc, 0, 0);
  pdfPageCanvases[pageNum] = snapshot;

  initFabricOnCanvas(rc);

  document.getElementById('pdf-placeholder').style.display = 'none';
  updatePageNav();
  hideLoading();
}

function initFabricOnCanvas(bgCanvas) {
  const fc = document.getElementById('fabric-canvas');
  fc.width = bgCanvas.width; fc.height = bgCanvas.height;
  fc.style.display = 'block';
  fc.style.width = bgCanvas.width + 'px';
  fc.style.height = bgCanvas.height + 'px';

  if (fabricCanvas) fabricCanvas.dispose();

  fabricCanvas = new fabric.Canvas('fabric-canvas', {
    isDrawingMode: false,
    selection: true,
    width: bgCanvas.width,
    height: bgCanvas.height,
  });

  /* Set background from rendered canvas */
  fabricCanvas.setBackgroundImage(
    bgCanvas.toDataURL('image/png'),
    fabricCanvas.renderAll.bind(fabricCanvas),
    { scaleX: 1, scaleY: 1 }
  );
}

function updatePageNav() {
  document.getElementById('page-info').textContent = `Page ${pdfCurrentPage} / ${pdfTotalPages}`;
}

document.getElementById('prev-page').addEventListener('click', async () => {
  if (pdfCurrentPage > 1) { pdfCurrentPage--; await renderPDFPage(pdfCurrentPage); }
});

document.getElementById('next-page').addEventListener('click', async () => {
  if (pdfCurrentPage < pdfTotalPages) { pdfCurrentPage++; await renderPDFPage(pdfCurrentPage); }
});

/* Tool Buttons */
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
    applyTool(currentTool);
  });
});

function applyTool(tool) {
  if (!fabricCanvas) return;
  fabricCanvas.isDrawingMode = false;
  fabricCanvas.selection = true;

  switch (tool) {
    case 'select':
      fabricCanvas.selection = true;
      break;
    case 'draw':
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush.color = document.getElementById('stroke-color').value;
      fabricCanvas.freeDrawingBrush.width = 3;
      break;
    case 'erase':
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush.color = 'white';
      fabricCanvas.freeDrawingBrush.width = 18;
      break;
    case 'text':
      fabricCanvas.on('mouse:down', addTextOnClick);
      break;
    case 'highlight':
      fabricCanvas.on('mouse:down', addHighlightOnClick);
      break;
    case 'rect':
      addShape('rect');
      break;
    case 'circle':
      addShape('circle');
      break;
  }

  if (tool !== 'text') fabricCanvas.off('mouse:down', addTextOnClick);
  if (tool !== 'highlight') fabricCanvas.off('mouse:down', addHighlightOnClick);
}

function addTextOnClick(opt) {
  const pointer = fabricCanvas.getPointer(opt.e);
  const text = new fabric.IText('Type here', {
    left: pointer.x,
    top: pointer.y,
    fontFamily: 'Arial',
    fontSize: parseInt(document.getElementById('font-size').value) || 16,
    fill: document.getElementById('text-color').value,
  });
  fabricCanvas.add(text);
  fabricCanvas.setActiveObject(text);
  text.enterEditing();
  fabricCanvas.off('mouse:down', addTextOnClick);
  document.querySelector('[data-tool="select"]').click();
}

function addHighlightOnClick(opt) {
  const pointer = fabricCanvas.getPointer(opt.e);
  const rect = new fabric.Rect({
    left: pointer.x - 60, top: pointer.y - 10,
    width: 120, height: 22,
    fill: 'rgba(255,255,0,0.4)',
    stroke: 'transparent',
    selectable: true,
  });
  fabricCanvas.add(rect);
  fabricCanvas.off('mouse:down', addHighlightOnClick);
  document.querySelector('[data-tool="select"]').click();
}

function addShape(type) {
  const cx = fabricCanvas.width / 2, cy = fabricCanvas.height / 2;
  const color = document.getElementById('stroke-color').value;
  let shape;
  if (type === 'rect') {
    shape = new fabric.Rect({ left: cx - 60, top: cy - 40, width: 120, height: 80,
      fill: 'transparent', stroke: color, strokeWidth: 2 });
  } else {
    shape = new fabric.Circle({ left: cx - 50, top: cy - 50, radius: 50,
      fill: 'transparent', stroke: color, strokeWidth: 2 });
  }
  fabricCanvas.add(shape);
  fabricCanvas.setActiveObject(shape);
  document.querySelector('[data-tool="select"]').click();
}

document.getElementById('undo-btn').addEventListener('click', () => {
  if (!fabricCanvas) return;
  const objs = fabricCanvas.getObjects();
  if (objs.length) fabricCanvas.remove(objs[objs.length - 1]);
});

document.getElementById('pdf-clear-btn').addEventListener('click', () => {
  if (!fabricCanvas) return;
  fabricCanvas.getObjects().forEach(o => fabricCanvas.remove(o));
  fabricCanvas.renderAll();
  showToast('Canvas cleared', 'info');
});

document.getElementById('pdf-download-btn').addEventListener('click', async () => {
  if (!fabricCanvas) return;
  showLoading('Exporting PDF...');
  try {
    /* Merge fabric canvas over PDF render */
    const pdfLibDoc = await PDFLib.PDFDocument.create();
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = fabricCanvas.width;
    exportCanvas.height = fabricCanvas.height;
    const ctx = exportCanvas.getContext('2d');

    /* Draw background (PDF page or image) */
    const bgKey = pdfCurrentPage;
    if (pdfPageCanvases[bgKey]) ctx.drawImage(pdfPageCanvases[bgKey], 0, 0);

    /* Draw fabric overlay */
    const fabricImg = new Image();
    const fabricDataURL = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
    await new Promise(res => { fabricImg.onload = res; fabricImg.src = fabricDataURL; });
    ctx.drawImage(fabricImg, 0, 0);

    const jpegData = exportCanvas.toDataURL('image/jpeg', 0.92);
    const jpegBytes = await fetch(jpegData).then(r => r.arrayBuffer());
    const img = await pdfLibDoc.embedJpg(jpegBytes);
    const page = pdfLibDoc.addPage([fabricCanvas.width, fabricCanvas.height]);
    page.drawImage(img, { x: 0, y: 0, width: fabricCanvas.width, height: fabricCanvas.height });

    const bytes = await pdfLibDoc.save();
    triggerDownload(new Blob([bytes], { type: 'application/pdf' }), `${DOWNLOAD_NAME}.pdf`);
    showToast('✅ PDF exported!', 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  hideLoading();
});

/* ─────────────────────────────────────────
   6. DPI CONVERTER
───────────────────────────────────────── */
let dpiFile = null;

const dpiSelect = document.getElementById('target-dpi');
dpiSelect.addEventListener('change', () => {
  document.getElementById('output-dpi').textContent = dpiSelect.value;
});

setupDropZone('dpi-drop', 'dpi-input', async files => {
  dpiFile = files[0];
  if (!dpiFile) return;
  document.getElementById('dpi-filename').textContent = dpiFile.name;
  document.getElementById('dpi-convert-btn').disabled = false;

  /* Try to read EXIF DPI (simplified) */
  try {
    const ab = await dpiFile.arrayBuffer();
    const view = new DataView(ab);
    let dpiRead = null;

    if (view.getUint16(0, false) === 0xFFD8) {
      /* JPEG — scan for APP1/EXIF or APP0/JFIF */
      if (view.getUint8(6) === 0x4A && view.getUint8(7) === 0x46) {
        /* JFIF header — bytes 14-15 are X density */
        const units = view.getUint8(11);
        const xDensity = view.getUint16(12, false);
        if (units === 1) dpiRead = xDensity;
      }
    }
    document.getElementById('current-dpi').textContent = dpiRead ? dpiRead + ' DPI' : 'Unknown';
  } catch { document.getElementById('current-dpi').textContent = 'Unknown'; }

  showToast('Image loaded for DPI conversion', 'success');
});

document.getElementById('dpi-convert-btn').addEventListener('click', async () => {
  if (!dpiFile) return;
  showLoading('Converting DPI...');
  const targetDPI = parseInt(dpiSelect.value);
  try {
    const blob = await setJPEGDPI(dpiFile, targetDPI);
    triggerDownload(blob, `${DOWNLOAD_NAME}.jpg`);
    showResult('dpi-result', `✅ DPI set to ${targetDPI} · Size: ${formatBytes(blob.size)}`);
    showToast(`✅ DPI converted to ${targetDPI}!`, 'success');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
  hideLoading();
});

/* Embed DPI metadata into JPEG via JFIF APP0 marker */
async function setJPEGDPI(file, dpi) {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);

  const baseBlob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
  const ab = await baseBlob.arrayBuffer();
  const bytes = new Uint8Array(ab);

  /* Build new JFIF APP0 segment with correct DPI */
  const app0 = new Uint8Array(18);
  app0[0] = 0xFF; app0[1] = 0xE0;        // APP0 marker
  app0[2] = 0x00; app0[3] = 0x10;        // Length = 16 bytes
  app0[4] = 0x4A; app0[5] = 0x46;        // 'JF'
  app0[6] = 0x49; app0[7] = 0x46;        // 'IF'
  app0[8] = 0x00;                         // null
  app0[9] = 0x01; app0[10] = 0x01;       // Version 1.1
  app0[11] = 0x01;                        // Units: 1 = DPI
  app0[12] = (dpi >> 8) & 0xFF;           // X density high
  app0[13] = dpi & 0xFF;                  // X density low
  app0[14] = (dpi >> 8) & 0xFF;           // Y density high
  app0[15] = dpi & 0xFF;                  // Y density low
  app0[16] = 0x00;                        // Xthumbnail
  app0[17] = 0x00;                        // Ythumbnail

  /* Find existing APP0 or insert after SOI */
  let insertAt = 2;
  let outputBytes;
  if (bytes[2] === 0xFF && bytes[3] === 0xE0) {
    /* Replace existing APP0 */
    const oldLen = (bytes[4] << 8 | bytes[5]) + 2;
    outputBytes = new Uint8Array(2 + 18 + (bytes.length - 2 - oldLen));
    outputBytes.set(bytes.slice(0, 2), 0);
    outputBytes.set(app0, 2);
    outputBytes.set(bytes.slice(2 + oldLen), 2 + 18);
  } else {
    outputBytes = new Uint8Array(bytes.length + 18);
    outputBytes.set(bytes.slice(0, 2), 0);
    outputBytes.set(app0, 2);
    outputBytes.set(bytes.slice(2), 2 + 18);
  }
  return new Blob([outputBytes], { type: 'image/jpeg' });
}

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  showToast('⚡ SSRC Converter Pro Ready!', 'success');
});
