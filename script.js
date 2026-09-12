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
let currentThemeBg = '#121820';
let currentTool = 'pen';
let currentColor = '#ffffff';
let currentSize = 4;
let isDrawing = false;
let startX = 0, startY = 0;

let laserPoints = [];
let history = [];
const MAX_HISTORY = 15;

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

  const isLightBg = currentThemeBg === '#f8fafc';
  gCtx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
  gCtx.lineWidth = 1;

  if (currentGrid === 'ruled') {
    const lineSpacing = 44;
    for (let y = lineSpacing; y < gridCanvas.height; y += lineSpacing) {
      gCtx.beginPath();
      gCtx.moveTo(0, y);
      gCtx.lineTo(gridCanvas.width, y);
      gCtx.stroke();
    }
  } else if (currentGrid === 'graph') {
    const step = 40;
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
  targetCtx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6)
  );
  targetCtx.lineTo(
    toX - (headLength * 0.7) * Math.cos(angle),
    toY - (headLength * 0.7) * Math.sin(angle)
  );
  targetCtx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6)
  );
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
    } else if (currentTool === 'highlighter') {
      pCtx.globalCompositeOperation = 'source-over';
      pCtx.strokeStyle = currentColor + '55';
      pCtx.lineWidth = currentSize * 3;
    } else {
      pCtx.globalCompositeOperation = 'source-over';
      pCtx.strokeStyle = currentColor;
      pCtx.lineWidth = currentSize;
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
        const radius = Math.hypot(x - startX, y - startY);
        oCtx.beginPath();
        oCtx.arc(startX, startY, radius, 0, Math.PI * 2);
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
    saveState();
  } else if (['line', 'arrow', 'rect', 'circle'].includes(currentTool)) {
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    pCtx.globalCompositeOperation = 'source-over';

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
        const radius = Math.hypot(x - startX, y - startY);
        pCtx.beginPath();
        pCtx.arc(startX, startY, radius, 0, Math.PI * 2);
        pCtx.stroke();
      }
    }
    saveState();
  }
}

function renderLaser() {
  if (laserPoints.length > 0) {
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const now = Date.now();
    laserPoints = laserPoints.filter(p => now - p.time < 1200);

    for (let i = 1; i < laserPoints.length; i++) {
      const age = now - laserPoints[i].time;
      const alpha = 1 - age / 1200;
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

const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
toolBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    toolBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.getAttribute('data-tool');
  });
});

const colorDots = document.querySelectorAll('.color-dot');
colorDots.forEach(dot => {
  dot.addEventListener('click', () => {
    colorDots.forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    currentColor = dot.getAttribute('data-color');
    if (currentTool === 'eraser') {
      document.querySelector('[data-tool="pen"]').click();
    }
  });
});

document.getElementById('brushSize').oninput = (e) => {
  currentSize = parseInt(e.target.value);
};

document.getElementById('undoBtn').onclick = () => {
  if (history.length > 1) {
    history.pop();
    pCtx.putImageData(history[history.length - 1], 0, 0);
  }
};

document.getElementById('clearBtn').onclick = () => {
  if (confirm('هل تريد مسح كل ما كتبته على الصفحة الحالية؟')) {
    pCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    saveState();
  }
};

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

    const renderContext = {
      canvasContext: pdfCtx,
      viewport: scaledViewport,
      transform: [1, 0, 0, 1, x, y]
    };

    page.render(renderContext);
    pageIndicator.innerText = `صفحة PDF: ${pageNumber} / ${totalPdfPages}`;
  });
}

document.getElementById('prevPdfPage').onclick = () => {
  if (currentPdf && currentPdfPage > 1) {
    currentPdfPage--;
    pCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    saveState();
    renderPdfPage(currentPdfPage);
  }
};

document.getElementById('nextPdfPage').onclick = () => {
  if (currentPdf && currentPdfPage < totalPdfPages) {
    currentPdfPage++;
    pCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    saveState();
    renderPdfPage(currentPdfPage);
  }
};

document.getElementById('loadQuranBtn').onclick = () => {
  const pageVal = parseInt(document.getElementById('quranPageNum').value);
  if (pageVal >= 1 && pageVal <= 604) {
    const formatted = String(pageVal).padStart(3, '0');
    const quranUrl = `https://raw.githubusercontent.com/Quran-Mobile/Quran-Images/master/pages_1024/page_${formatted}.png`;
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      const scale = Math.min((pdfCanvas.width * 0.7) / img.width, (pdfCanvas.height * 0.95) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (pdfCanvas.width - w) / 2;
      const y = (pdfCanvas.height - h) / 2;

      pdfCtx.drawImage(img, x, y, w, h);
      pageIndicator.innerText = `مصحف: صفحة ${pageVal}`;
    };
    img.src = quranUrl;
  } else {
    alert('يرجى إدخال رقم صفحة صحيح بين 1 و 604');
  }
};

const uploadBtn = document.getElementById('uploadImageBtn');
const imageInput = document.getElementById('imageInput');

uploadBtn.onclick = () => imageInput.click();

function placeImage(src) {
  const img = new Image();
  img.onload = () => {
    const maxWidth = paintCanvas.width * 0.7;
    const scale = Math.min(1, maxWidth / img.width);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (paintCanvas.width - w) / 2;
    const y = (paintCanvas.height - h) / 2;

    pCtx.globalCompositeOperation = 'source-over';
    pCtx.drawImage(img, x, y, w, h);
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

window.addEventListener('paste', (e) => {
  const items = (e.clipboardData || window.clipboardData).items;
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (ev) => placeImage(ev.target.result);
      reader.readAsDataURL(blob);
    }
  }
});

const themeBtns = document.querySelectorAll('.theme-btn');
themeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    themeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentThemeBg = btn.getAttribute('data-bg');
    document.body.style.backgroundColor = currentThemeBg;

    if (currentThemeBg === '#f8fafc' && currentColor === '#ffffff') {
      currentColor = '#111111';
      colorDots[0].style.background = '#111111';
      colorDots[0].setAttribute('data-color', '#111111');
    } else if (currentThemeBg !== '#f8fafc' && currentColor === '#111111') {
      currentColor = '#ffffff';
      colorDots[0].style.background = '#ffffff';
      colorDots[0].setAttribute('data-color', '#ffffff');
    }
    drawGrid();
  });
});

const gridBtns = document.querySelectorAll('.grid-options button');
gridBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    gridBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGrid = btn.getAttribute('data-grid');
    drawGrid();
  });
});

document.getElementById('fullScreenBtn').onclick = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
};

document.getElementById('downloadBtn').onclick = () => {
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
  link.download = `شرح-السبورة-${new Date().toLocaleDateString('ar-EG')}.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
};
