pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const paintCanvas = document.getElementById('paintCanvas');
const pCtx = paintCanvas.getContext('2d');
const gridCanvas = document.getElementById('gridCanvas');
const gCtx = gridCanvas.getContext('2d');
const pdfCanvas = document.getElementById('pdfCanvas');
const pdfCtx = pdfCanvas.getContext('2d');
const overlayCanvas = document.getElementById('overlayCanvas');
const oCtx = overlayCanvas.getContext('2d');

let currentGrid = 'none';
let currentThemeBg = '#12161f';
let currentTool = 'pen';
let currentColor = '#ffffff';
let currentSize = 4;
let currentOpacity = 1.0;
let isDrawing = false;
let startX = 0, startY = 0;

let laserPoints = [];
let history = [];
let redoList = [];
const MAX_HISTORY = 20;

let currentPdf = null;
let currentPdfPage = 1;
let totalPdfPages = 0;
const pageIndicator = document.getElementById('pageIndicator');

function resizeCanvases() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = paintCanvas.width;
  tempCanvas.height = paintCanvas.height;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.drawImage(paintCanvas, 0, 0);

  [paintCanvas, gridCanvas, pdfCanvas, overlayCanvas].forEach(c => {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
  });

  pCtx.drawImage(tempCanvas, 0, 0);
  drawGrid();
  if (currentPdf) renderPdfPage(currentPdfPage);
}
window.addEventListener('resize', resizeCanvases);

[paintCanvas, gridCanvas, pdfCanvas, overlayCanvas].forEach(c => {
  c.width = window.innerWidth;
  c.height = window.innerHeight;
});

function drawGrid() {
  gCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  if (currentGrid === 'none') return;

  const isLight = currentThemeBg === '#ffffff';
  gCtx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
  gCtx.lineWidth = 1;

  if (currentGrid === 'ruled' || currentGrid === 'wide-ruled') {
    const space = currentGrid === 'wide-ruled' ? 56 : 42;
    for (let y = space; y < gridCanvas.height; y += space) {
      gCtx.beginPath();
      gCtx.moveTo(0, y);
      gCtx.lineTo(gridCanvas.width, y);
      gCtx.stroke();
    }
  } else if (currentGrid === 'two-lines') {
    for (let y = 50; y < gridCanvas.height; y += 70) {
      gCtx.beginPath();
      gCtx.moveTo(0, y);
      gCtx.lineTo(gridCanvas.width, y);
      gCtx.moveTo(0, y + 24);
      gCtx.lineTo(gridCanvas.width, y + 24);
      gCtx.stroke();
    }
  } else if (currentGrid === 'graph') {
    const step = 38;
    for (let x = 0; x < gridCanvas.width; x += step) {
      gCtx.beginPath();
      gCtx.moveTo(x, 0);
      gCtx.lineTo(x, gridCanvas.height);
      gCtx.stroke();
    }
    for (let y = 0; y < gridCanvas.height; y += step) {
      gCtx.beginPath();
      gCtx.moveTo(0, y);
      gCtx.lineTo(gridCanvas.width, y);
      gCtx.stroke();
    }
  }
}

function saveState() {
  if (history.length >= MAX_HISTORY) history.shift();
  history.push(pCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height));
  redoList = [];
}
saveState();

function getCoords(e) {
  if (e.touches && e.touches[0]) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function drawArrow(targetCtx, fromX, fromY, toX, toY, color, size) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLength = Math.max(18, size * 3.5);

  targetCtx.beginPath();
  targetCtx.moveTo(fromX, fromY);
  targetCtx.lineTo(toX, toY);
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = size;
  targetCtx.lineCap = 'round';
  targetCtx.stroke();

  targetCtx.beginPath();
  targetCtx.moveTo(toX, toY);
  targetCtx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
  targetCtx.lineTo(toX - (headLength * 0.7) * Math.cos(angle), toY - (headLength * 0.7) * Math.sin(angle));
  targetCtx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
  targetCtx.closePath();
  targetCtx.fillStyle = color;
  targetCtx.fill();
}

function startDraw(e) {
  isDrawing = true;
  const { x, y } = getCoords(e);
  startX = x;
  startY = y;

  if (['pen', 'highlighter', 'eraser'].includes(currentTool)) {
    pCtx.beginPath();
    pCtx.moveTo(x, y);

    if (currentTool === 'eraser') {
      pCtx.globalCompositeOperation = 'destination-out';
      pCtx.lineWidth = currentSize * 4;
    } else {
      pCtx.globalCompositeOperation = 'source-over';
      pCtx.strokeStyle = currentTool === 'highlighter' ? currentColor + '55' : currentColor;
      pCtx.globalAlpha = currentTool === 'highlighter' ? 0.4 : currentOpacity;
      pCtx.lineWidth = currentTool === 'highlighter' ? currentSize * 3 : currentSize;
    }
    pCtx.lineCap = 'round';
    pCtx.lineJoin = 'round';
  } else if (currentTool === 'laser') {
    laserPoints.push({ x, y, time: Date.now() });
  }
}

function draw(e) {
  if (!isDrawing) return;
  const { x, y } = getCoords(e);

  if (['pen', 'highlighter', 'eraser'].includes(currentTool)) {
    pCtx.lineTo(x, y);
    pCtx.stroke();
  } else if (currentTool === 'laser') {
    laserPoints.push({ x, y, time: Date.now() });
  } else {
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (currentTool === 'arrow') {
      drawArrow(oCtx, startX, startY, x, y, currentColor, currentSize);
    } else {
      oCtx.strokeStyle = currentColor;
      oCtx.lineWidth = currentSize;
      oCtx.lineCap = 'round';
      if (currentTool === 'line') {
        oCtx.beginPath();
        oCtx.moveTo(startX, startY);
        oCtx.lineTo(x, y);
        oCtx.stroke();
      } else if (currentTool === 'rect') {
        oCtx.strokeRect(startX, startY, x - startX, y - startY);
      } else if (currentTool === 'circle') {
        oCtx.beginPath();
        oCtx.arc(startX, startY, Math.hypot(x - startX, y - startY), 0, Math.PI * 2);
        oCtx.stroke();
      }
    }
  }
}

function stopDraw(e) {
  if (!isDrawing) return;
  isDrawing = false;
  const { x, y } = getCoords(e);

  if (['pen', 'highlighter', 'eraser'].includes(currentTool)) {
    pCtx.closePath();
    pCtx.globalAlpha = 1.0;
    saveState();
  } else if (['line', 'arrow', 'rect', 'circle'].includes(currentTool)) {
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    pCtx.globalCompositeOperation = 'source-over';
    pCtx.globalAlpha = currentOpacity;
    if (currentTool === 'arrow') {
      drawArrow(pCtx, startX, startY, x, y, currentColor, currentSize);
    } else {
      pCtx.strokeStyle = currentColor;
      pCtx.lineWidth = currentSize;
      pCtx.lineCap = 'round';
      if (currentTool === 'line') {
        pCtx.beginPath();
        pCtx.moveTo(startX, startY);
        pCtx.lineTo(x, y);
        pCtx.stroke();
      } else if (currentTool === 'rect') {
        pCtx.strokeRect(startX, startY, x - startX, y - startY);
      } else if (currentTool === 'circle') {
        pCtx.beginPath();
        pCtx.arc(startX, startY, Math.hypot(x - startX, y - startY), 0, Math.PI * 2);
        pCtx.stroke();
      }
    }
    pCtx.globalAlpha = 1.0;
    saveState();
  }
}

function renderLaser() {
  if (laserPoints.length > 0) {
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const now = Date.now();
    laserPoints = laserPoints.filter(p => now - p.time < 1200);

    for (let i = 1; i < laserPoints.length; i++) {
      const alpha = 1 - (now - laserPoints[i].time) / 1200;
      oCtx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
      oCtx.lineWidth = 6;
      oCtx.lineCap = 'round';
      oCtx.beginPath();
      oCtx.moveTo(laserPoints[i - 1].x, laserPoints[i - 1].y);
      oCtx.lineTo(laserPoints[i].x, laserPoints[i].y);
      oCtx.stroke();
    }
  }
  requestAnimationFrame(renderLaser);
}
renderLaser();

paintCanvas.addEventListener('mousedown', startDraw);
paintCanvas.addEventListener('mousemove', draw);
window.addEventListener('mouseup', stopDraw);

paintCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
paintCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); draw(e); }, { passive: false });
window.addEventListener('touchend', (e) => { stopDraw(e); });

// أزرار الأدوات
document.querySelectorAll('[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.getAttribute('data-tool');
  });
});

// أزرار الألوان
document.querySelectorAll('[data-color]').forEach(dot => {
  dot.addEventListener('click', () => {
    document.querySelectorAll('[data-color]').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    currentColor = dot.getAttribute('data-color');
    if (currentTool === 'eraser') {
      document.querySelector('[data-tool="pen"]').click();
    }
  });
});

// تغيير لون خلفية السبورة
document.querySelectorAll('[data-bg]').forEach(dot => {
  dot.addEventListener('click', () => {
    document.querySelectorAll('[data-bg]').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    currentThemeBg = dot.getAttribute('data-bg');
    document.body.style.backgroundColor = currentThemeBg;
    drawGrid();
  });
});

// التحكم في نوع التسطير
document.querySelectorAll('[data-grid]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-grid]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGrid = btn.getAttribute('data-grid');
    drawGrid();
  });
});

// منزلقات السُمك والشفافية
document.getElementById('brushSize').oninput = (e) => {
  currentSize = parseInt(e.target.value);
  document.getElementById('sizeVal').innerText = currentSize + 'px';
};
document.getElementById('brushOpacity').oninput = (e) => {
  currentOpacity = parseInt(e.target.value) / 100;
  document.getElementById('opacityVal').innerText = e.target.value + '%';
};

// التراجع والإعادة
document.getElementById('undoBtn').onclick = () => {
  if (history.length > 1) {
    redoList.push(history.pop());
    pCtx.putImageData(history[history.length - 1], 0, 0);
  }
};
document.getElementById('redoBtn').onclick = () => {
  if (redoList.length > 0) {
    const nextState = redoList.pop();
    history.push(nextState);
    pCtx.putImageData(nextState, 0, 0);
  }
};

document.getElementById('clearBoardBtn').onclick = () => {
  if (confirm('مسح كامل محتوى السبورة؟')) {
    pCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    saveState();
  }
};

// ملء الشاشة
document.getElementById('fullScreenBtn').onclick = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
};

// رفع وعرض الـ PDF
const pdfInput = document.getElementById('pdfInput');
document.getElementById('uploadPdfBtn').onclick = () => pdfInput.click();

pdfInput.onchange = function(e) {
  const file = e.target.files[0];
  if (file && file.type === 'application/pdf') {
    const fileReader = new FileReader();
    fileReader.onload = function() {
      const typedarray = new Uint8Array(this.result);
      pdfjsLib.getDocument(typedarray).promise.then(pdf => {
        currentPdf = pdf;
        totalPdfPages = pdf.numPages;
        currentPdfPage = 1;
        renderPdfPage(currentPdfPage);
      });
    };
    fileReader.readAsArrayBuffer(file);
  }
};

function renderPdfPage(pageNumber) {
  if (!currentPdf) return;
  currentPdf.getPage(pageNumber).then(page => {
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min((pdfCanvas.width * 0.85) / viewport.width, (pdfCanvas.height * 0.9) / viewport.height);
    const scaledViewport = page.getViewport({ scale: scale });

    pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    const x = (pdfCanvas.width - scaledViewport.width) / 2;
    const y = (pdfCanvas.height - scaledViewport.height) / 2;

    page.render({
      canvasContext: pdfCtx,
      viewport: scaledViewport,
      transform: [1, 0, 0, 1, x, y]
    });
    pageIndicator.innerText = `صفحة PDF: ${pageNumber} / ${totalPdfPages}`;
  });
}

document.getElementById('prevPageBtn').onclick = () => {
  if (currentPdf && currentPdfPage > 1) {
    currentPdfPage--;
    renderPdfPage(currentPdfPage);
  }
};
document.getElementById('nextPageBtn').onclick = () => {
  if (currentPdf && currentPdfPage < totalPdfPages) {
    currentPdfPage++;
    renderPdfPage(currentPdfPage);
  }
};

// استدعاء صفحات القرآن الكريم
document.getElementById('loadQuranModalBtn').onclick = () => {
  const pageVal = prompt('أدخل رقم صفحة المصحف الشريف (1 إلى 604):', '1');
  const num = parseInt(pageVal);
  if (num >= 1 && num <= 604) {
    const formatted = String(num).padStart(3, '0');
    const quranUrl = `https://raw.githubusercontent.com/Quran-Mobile/Quran-Images/master/pages_1024/page_${formatted}.png`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      const scale = Math.min((pdfCanvas.width * 0.7) / img.width, (pdfCanvas.height * 0.95) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      pdfCtx.drawImage(img, (pdfCanvas.width - w) / 2, (pdfCanvas.height - h) / 2, w, h);
      pageIndicator.innerText = `مصحف: صفحة ${num}`;
    };
    img.src = quranUrl;
  }
};

// إدراج الصور
const imageInput = document.getElementById('imageInput');
document.getElementById('uploadImgBtn').onclick = () => imageInput.click();

function placeImage(src) {
  const img = new Image();
  img.onload = () => {
    const maxWidth = paintCanvas.width * 0.7;
    const scale = Math.min(1, maxWidth / img.width);
    const w = img.width * scale;
    const h = img.height * scale;
    pCtx.drawImage(img, (paintCanvas.width - w) / 2, (paintCanvas.height - h) / 2, w, h);
    saveState();
  };
  img.src = src;
}

imageInput.onchange = (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => placeImage(ev.target.result);
    reader.readAsDataURL(file);
  }
};

// تصدير الصور
function exportImage(format) {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = paintCanvas.width;
  exportCanvas.height = paintCanvas.height;
  const eCtx = exportCanvas.getContext('2d');

  eCtx.fillStyle = currentThemeBg;
  eCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  eCtx.drawImage(gridCanvas, 0, 0);
  eCtx.drawImage(pdfCanvas, 0, 0);
  eCtx.drawImage(paintCanvas, 0, 0);

  const link = document.createElement('a');
  link.download = `سبورة-${Date.now()}.${format}`;
  link.href = exportCanvas.toDataURL(`image/${format === 'png' ? 'png' : 'jpeg'}`);
  link.click();
}

document.getElementById('downloadPngBtn').onclick = () => exportImage('png');
document.getElementById('downloadJpgBtn').onclick = () => exportImage('jpeg');
document.getElementById('quickSaveBtn').onclick = () => exportImage('png');
