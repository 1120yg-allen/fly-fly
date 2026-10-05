'use strict';

/* ---------- 拍照辨識（在裝置上執行，照片不會上傳） ----------
 * 使用 Tesseract.js（開源 OCR），第一次使用時從 CDN 下載程式與中英文辨識資料（約 8 MB），
 * 之後瀏覽器會快取。
 */
const OCR = (() => {
  const VERSION = '7.0.0';
  const SCRIPT = `https://cdn.jsdelivr.net/npm/tesseract.js@${VERSION}/dist/tesseract.min.js`;
  const LANGS = ['eng', 'chi_tra'];
  let workerPromise = null;
  let progressFn = null;

  const STATUS_TEXT = {
    'loading tesseract core': '載入辨識程式',
    'initializing tesseract': '初始化',
    'loading language traineddata': '下載中英文辨識資料',
    'loading language traineddata (from cache)': '載入辨識資料',
    'initializing api': '初始化',
    'recognizing text': '辨識文字中',
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法下載辨識程式，請確認網路連線'));
      document.head.appendChild(s);
    });
  }

  function report(status, progress) {
    progressFn?.({ text: STATUS_TEXT[status] || status, progress: progress ?? 0 });
  }

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        report('loading tesseract core', 0);
        await loadScript(SCRIPT);
        const worker = await Tesseract.createWorker(LANGS, 1, {
          logger: (m) => report(m.status, m.progress),
        });
        // 保留欄位間的空白，讓「項目 結果 單位 參考值」維持在同一行
        await worker.setParameters({ preserve_interword_spaces: '1' });
        return worker;
      })().catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  async function loadImage(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 改用 <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  /** 放大到適合辨識的寬度、轉灰階並拉高對比（小數點才不會消失） */
  async function preprocess(file) {
    const img = await loadImage(file);
    const w0 = img.width, h0 = img.height;
    const targetW = Math.min(2600, Math.max(1800, w0));
    let scale = targetW / w0;
    if (h0 * scale > 6000) scale = 6000 / h0;
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * scale);
    c.height = Math.round(h0 * scale);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    img.close?.();

    const data = g.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
      px[i] = y;
      hist[y]++;
    }
    // 以最暗 1% 為黑、最亮 5% 為白拉伸對比
    const n = px.length / 4;
    let lo = 0, hi = 255, acc = 0;
    for (; lo < 254; lo++) { acc += hist[lo]; if (acc > n * 0.01) break; }
    acc = 0;
    for (; hi > lo + 1; hi--) { acc += hist[hi]; if (acc > n * 0.05) break; }
    const k = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(0, Math.min(255, (px[i] - lo) * k));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    g.putImageData(data, 0, 0);
    return c;
  }

  /** 辨識一張照片，回傳文字 */
  async function recognize(file, onProgress) {
    progressFn = onProgress;
    try {
      report('準備照片', 0);
      const canvas = await preprocess(file);
      const worker = await getWorker();
      const { data } = await worker.recognize(canvas);
      return data.text || '';
    } finally {
      progressFn = null;
    }
  }

  return { recognize };
})();
