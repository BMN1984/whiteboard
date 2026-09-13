// تسجيل الـ Service Worker لضمان وصول التحديثات للهواتف
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

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
  } else if (currentGrid === 'four-lines') {
    for (let y = 50; y < gridCanvas.height; y += 90) {
      for (let i = 0; i < 4; i++) {
        gCtx.beginPath();
        gCtx.moveTo(0, y + i * 16);
        gCtx.lineTo(gridCanvas.width, y + i * 16);
        gCtx.stroke();
      }
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
      const pen = document.querySelector('[data-tool="pen"]');
      if (pen) pen.click();
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

// التسطير
document.querySelectorAll('[data-grid]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-grid]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGrid = btn.getAttribute('data-grid');
    drawGrid();
  });
});

// سُمك الفرشاة
const brushSizeEl = document.getElementById('brushSize');
if (brushSizeEl) {
  brushSizeEl.oninput = (e) => {
    currentSize = parseInt(e.target.value);
    const val = document.getElementById('sizeVal');
    if (val) val.innerText = currentSize + 'px';
  };
}
const brushOpacityEl = document.getElementById('brushOpacity');
if (brushOpacityEl) {
  brushOpacityEl.oninput = (e) => {
    currentOpacity = parseInt(e.target.value) / 100;
    const val = document.getElementById('opacityVal');
    if (val) val.innerText = e.target.value + '%';
  };
}

// تراجع وإعادة ومسح
const undoBtn = document.getElementById('undoBtn');
if (undoBtn) {
  undoBtn.onclick = () => {
    if (history.length > 1) {
      redoList.push(history.pop());
      pCtx.putImageData(history[history.length - 1], 0, 0);
    }
  };
}
const redoBtn = document.getElementById('redoBtn');
if (redoBtn) {
  redoBtn.onclick = () => {
    if (redoList.length > 0) {
      const nextState = redoList.pop();
      history.push(nextState);
      pCtx.putImageData(nextState, 0, 0);
    }
  };
}
const clearBoardBtn = document.getElementById('clearBoardBtn');
if (clearBoardBtn) {
  clearBoardBtn.onclick = () => {
    if (confirm('مسح كامل محتوى السبورة؟')) {
      pCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
      saveState();
    }
  };
}

// تكبير وملء الشاشة
const fullScreenBtn = document.getElementById('fullScreenBtn');
if (fullScreenBtn) {
  fullScreenBtn.onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  };
}

// تشغيل الـ PDF
const pdfInput = document.getElementById('pdfInput');
const uploadPdfBtn = document.getElementById('uploadPdfBtn');
if (uploadPdfBtn && pdfInput) uploadPdfBtn.onclick = () => pdfInput.click();
if (pdfInput) {
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
}

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
    if (pageIndicator) pageIndicator.innerText = `صفحة PDF: ${pageNumber} / ${totalPdfPages}`;
  });
}

const prevPageBtn = document.getElementById('prevPageBtn');
if (prevPageBtn) prevPageBtn.onclick = () => { if (currentPdf && currentPdfPage > 1) { currentPdfPage--; renderPdfPage(currentPdfPage); } };
const nextPageBtn = document.getElementById('nextPageBtn');
if (nextPageBtn) nextPageBtn.onclick = () => { if (currentPdf && currentPdfPage < totalPdfPages) { currentPdfPage++; renderPdfPage(currentPdfPage); } };

// ==========================================
// قسم المصحف التفاعلي المتكامل (صوت + لمس + فهرس)
// ==========================================
const surahNames = [
  "الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام","الأعراف","الأنفال","التوبة","يونس",
  "هود","يوسف","الرعد","إبراهيم","الحجر","النحل","الإسراء","الكهف","مريم","طه",
  "الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء","النمل","القصص","العنكبوت","الروم",
  "لقمان","السجدة","الأحزاب","سبأ","فاطر","يس","الصافات","ص","الزمر","غافر",
  "فصلت","الشورى","الزخرف","الدخان","الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق",
  "الذاريات","الطور","النجم","القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة",
  "الصف","الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة","المعارج",
  "نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ","النازعات","عبس",
  "التكوير","الانفطار","المطففين","الانشقاق","البروج","الطارق","الأعلى","الغاشية","الفجر","البلد",
  "الشمس","الليل","الضحى","الشرح","التين","العلق","القدر","البينة","الزلزلة","العاديات",
  "القارعة","التكاثر","العصر","الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر",
  "المسد","الإخلاص","الفلق","الناس"
];

const surahSelect = document.getElementById('surahSelect');
if (surahSelect) {
  surahNames.forEach((name, index) => {
    const opt = document.createElement('option');
    opt.value = index + 1;
    opt.innerText = `${index + 1}. سورة ${name}`;
    surahSelect.appendChild(opt);
  });
}

// نافذة المصحف
const quranModal = document.getElementById('quranModal');
const loadQuranBtn = document.getElementById('loadQuranModalBtn') || document.getElementById('openQuranBtn');
const closeQuranBtn = document.getElementById('closeQuranModalBtn');
const cancelQuranBtn = document.getElementById('cancelQuranModalBtn');
const tabByPage = document.getElementById('tabByPage');
const tabBySurah = document.getElementById('tabBySurah');
const pageSection = document.getElementById('pageSection');
const surahSection = document.getElementById('surahSection');
let currentQuranMode = 'surah';

if (loadQuranBtn && quranModal) loadQuranBtn.onclick = () => quranModal.classList.add('active');
if (closeQuranBtn && quranModal) closeQuranBtn.onclick = () => quranModal.classList.remove('active');
if (cancelQuranBtn && quranModal) cancelQuranBtn.onclick = () => quranModal.classList.remove('active');

if (tabByPage && tabBySurah) {
  tabByPage.onclick = () => {
    currentQuranMode = 'page';
    tabByPage.classList.add('active');
    tabBySurah.classList.remove('active');
    if (pageSection) pageSection.style.display = 'block';
    if (surahSection) surahSection.style.display = 'none';
  };
  tabBySurah.onclick = () => {
    currentQuranMode = 'surah';
    tabBySurah.classList.add('active');
    tabByPage.classList.remove('active');
    if (pageSection) pageSection.style.display = 'none';
    if (surahSection) surahSection.style.display = 'flex';
  };
}

// عناصر الصندوق التفاعلي
const quranContainer = document.getElementById('quranTextContainer');
const quranTextContent = document.getElementById('quranTextContent');
const sidebarAyahList = document.getElementById('sidebarAyahList');
const surahBadgeTitle = document.getElementById('surahBadgeTitle');
const btnPlayAudio = document.getElementById('btnPlayAudio');
const audioStatus = document.getElementById('audioStatus');
const reciterSelect = document.getElementById('reciterSelect');

let activeAyahsData = [];
let currentAudioIndex = 0;
let isPlaying = false;
let audioPlayer = new Audio();

// دالة الانتقال للآية بالنقر أو اللمس
window.jumpToAyah = function(index) {
  if (index < 0 || index >= activeAyahsData.length) return;
  currentAudioIndex = index;
  const ayah = activeAyahsData[index];

  // تظليل النص الرئيسي
  document.querySelectorAll('.ayah-span').forEach(el => el.classList.remove('active-highlight'));
  const span = document.getElementById(`ayah-main-${ayah.numberInSurah}`);
  if (span) {
    span.classList.add('active-highlight');
    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // تظليل الفهرس الجانبي
  document.querySelectorAll('.sidebar-ayah-item').forEach(el => el.classList.remove('active-nav-ayah'));
  const side = document.getElementById(`sidebar-item-${ayah.numberInSurah}`);
  if (side) {
    side.classList.add('active-nav-ayah');
    side.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  playAyahAudio(index);
};

function playAyahAudio(index) {
  if (index >= activeAyahsData.length) {
    stopQuranAudio();
    if (audioStatus) audioStatus.innerText = "✓ اكتملت تلاوة الآيات بنجاح";
    return;
  }

  const ayah = activeAyahsData[index];
  const sNum = surahSelect ? surahSelect.value : 1;
  const sPad = String(sNum).padStart(3, '0');
  const vPad = String(ayah.numberInSurah).padStart(3, '0');
  const reciter = reciterSelect ? reciterSelect.value : 'Husary_64kbps';
  const url = `https://everyayah.com/data/${reciter}/${sPad}${vPad}.mp3`;

  audioPlayer.src = url;
  if (audioStatus) audioStatus.innerText = `▶ تلاوة آية (${ayah.numberInSurah}) — [${index + 1}/${activeAyahsData.length}]`;

  audioPlayer.play().catch(() => {});
  isPlaying = true;
  if (btnPlayAudio) {
    btnPlayAudio.innerText = "⏸️ إيقاف مؤقت";
    btnPlayAudio.style.background = "#dc2626";
  }

  audioPlayer.onended = () => {
    window.jumpToAyah(index + 1);
  };
}

function stopQuranAudio() {
  isPlaying = false;
  audioPlayer.pause();
  if (btnPlayAudio) {
    btnPlayAudio.innerText = "▶️ تشغيل التلاوة";
    btnPlayAudio.style.background = "#0284c7";
  }
}

if (btnPlayAudio) {
  btnPlayAudio.onclick = () => {
    if (activeAyahsData.length === 0) return;
    if (isPlaying) stopQuranAudio();
    else window.jumpToAyah(currentAudioIndex);
  };
}

// تنفيذ زر إدراج الآيات
const submitQuranBtn = document.getElementById('submitQuranBtn');
if (submitQuranBtn) {
  submitQuranBtn.onclick = () => {
    if (currentQuranMode === 'page') {
      const pageNum = parseInt(document.getElementById('quranPageInput').value);
      if (pageNum >= 1 && pageNum <= 604) {
        const formatted = String(pageNum).padStart(3, '0');
        const quranUrl = `https://raw.githubusercontent.com/Quran-Mobile/Quran-Images/master/pages_1024/page_${formatted}.png`;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
          const scale = Math.min((pdfCanvas.width * 0.72) / img.width, (pdfCanvas.height * 0.95) / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          pdfCtx.drawImage(img, (pdfCanvas.width - w) / 2, (pdfCanvas.height - h) / 2, w, h);
          if (pageIndicator) pageIndicator.innerText = `مصحف: صفحة ${pageNum}`;
          quranModal.classList.remove('active');
        };
        img.src = quranUrl;
      }
    } else {
      const surahNum = surahSelect ? surahSelect.value : 1;
      const fromVerse = parseInt(document.getElementById('verseFrom').value) || 1;
      const toVerse = parseInt(document.getElementById('verseTo').value) || fromVerse;

      fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/quran-uthmani`)
        .then(res => res.json())
        .then(data => {
          const ayahs = data.data.ayahs.filter(a => a.numberInSurah >= fromVerse && a.numberInSurah <= toVerse);
          if (ayahs.length === 0) return alert('يرجى التحقق من أرقام الآيات');

          activeAyahsData = ayahs;
          currentAudioIndex = 0;

          if (surahBadgeTitle) surahBadgeTitle.innerText = `سورة ${data.data.name} (${fromVerse} - ${toVerse})`;

          // 1. توليد النص في الساحة الرئيسية وربط النقر واللمس
          if (quranTextContent) {
            quranTextContent.innerHTML = '';
            ayahs.forEach((a, idx) => {
              const span = document.createElement('span');
              span.className = 'ayah-span';
              span.id = `ayah-main-${a.numberInSurah}`;
              span.innerHTML = `${a.text} <span style="color:#f59e0b; font-size:0.85em; pointer-events:none;">﴿${a.numberInSurah}﴾</span> `;
              
              span.addEventListener('click', (e) => { e.stopPropagation(); window.jumpToAyah(idx); });
              span.addEventListener('touchend', (e) => { e.stopPropagation(); window.jumpToAyah(idx); });

              quranTextContent.appendChild(span);
            });
          }

          // 2. توليد عناصر الفهرس الجانبي السريع
          if (sidebarAyahList) {
            sidebarAyahList.innerHTML = '';
            ayahs.forEach((a, idx) => {
              const item = document.createElement('div');
              item.className = 'sidebar-ayah-item';
              item.id = `sidebar-item-${a.numberInSurah}`;
              item.innerHTML = `
                <span class="sidebar-num-badge">${a.numberInSurah}</span>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none;">${a.text}</span>
              `;

              item.addEventListener('click', (e) => { e.stopPropagation(); window.jumpToAyah(idx); });
              item.addEventListener('touchend', (e) => { e.stopPropagation(); window.jumpToAyah(idx); });

              sidebarAyahList.appendChild(item);
            });
          }

          if (quranContainer) quranContainer.style.display = 'flex';
          quranModal.classList.remove('active');
          if (audioStatus) audioStatus.innerText = `جاهز — انقر أو المس أي آية باليد للانتقال إليها مباشرة`;
        })
        .catch(() => alert('تعذر جلب الآيات، يرجى التحقق من الاتصال بالإنترنت.'));
    }
  };
}

// تحريك صندوق المصحف
const dragHeader = document.getElementById('dragHeader');
const closeCardBtn = document.getElementById('closeQuranCardBtn');
let isDraggingBox = false, boxOffX = 0, boxOffY = 0;

if (dragHeader && quranContainer) {
  dragHeader.onmousedown = (e) => {
    isDraggingBox = true;
    const rect = quranContainer.getBoundingClientRect();
    boxOffX = e.clientX - rect.left;
    boxOffY = e.clientY - rect.top;
  };
  window.addEventListener('mousemove', (e) => {
    if (isDraggingBox) {
      quranContainer.style.left = (e.clientX - boxOffX) + 'px';
      quranContainer.style.top = (e.clientY - boxOffY) + 'px';
    }
  });
  window.addEventListener('mouseup', () => { isDraggingBox = false; });
}
if (closeCardBtn && quranContainer) {
  closeCardBtn.onclick = () => {
    quranContainer.style.display = 'none';
    stopQuranAudio();
  };
}
