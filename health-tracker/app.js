'use strict';

/* ---------- 指標定義 ---------- */
// aggregate: 'sum' 表示同一天的多筆紀錄會加總（飲水、步數、運動），其餘取最新一筆
const TYPES = {
  weight: {
    label: '體重', icon: '⚖️', unit: 'kg',
    fields: [
      { key: 'weight', label: '體重', unit: 'kg', min: 20, max: 300, step: 0.1, required: true },
      { key: 'bodyFat', label: '體脂率', unit: '%', min: 2, max: 70, step: 0.1 },
    ],
    series: [{ key: 'weight', label: '體重' }],
  },
  bp: {
    label: '血壓', icon: '🩺', unit: 'mmHg',
    fields: [
      { key: 'sys', label: '收縮壓', unit: 'mmHg', min: 50, max: 260, step: 1, required: true },
      { key: 'dia', label: '舒張壓', unit: 'mmHg', min: 30, max: 180, step: 1, required: true },
      { key: 'pulse', label: '脈搏', unit: 'bpm', min: 20, max: 250, step: 1 },
    ],
    series: [{ key: 'sys', label: '收縮壓' }, { key: 'dia', label: '舒張壓' }],
  },
  heart: {
    label: '心率', icon: '❤️', unit: 'bpm',
    fields: [{ key: 'bpm', label: '心率', unit: 'bpm', min: 20, max: 250, step: 1, required: true }],
    series: [{ key: 'bpm', label: '心率' }],
  },
  glucose: {
    label: '血糖', icon: '🩸', unit: 'mg/dL',
    fields: [
      { key: 'value', label: '血糖', unit: 'mg/dL', min: 20, max: 600, step: 1, required: true },
      { key: 'context', label: '量測時機', kind: 'select', options: [
        ['fasting', '空腹'], ['before', '餐前'], ['after', '餐後 2 小時'], ['random', '隨機'],
      ] },
    ],
    series: [{ key: 'value', label: '血糖' }],
  },
  temp: {
    label: '體溫', icon: '🌡️', unit: '°C',
    fields: [{ key: 'celsius', label: '體溫', unit: '°C', min: 33, max: 43, step: 0.1, required: true }],
    series: [{ key: 'celsius', label: '體溫' }],
  },
  sleep: {
    label: '睡眠', icon: '😴', unit: '小時',
    fields: [
      { key: 'hours', label: '睡眠時數', unit: '小時', min: 0, max: 24, step: 0.25, required: true },
      { key: 'quality', label: '睡眠品質', kind: 'select', options: [
        ['5', '★★★★★ 很好'], ['4', '★★★★ 好'], ['3', '★★★ 普通'], ['2', '★★ 差'], ['1', '★ 很差'],
      ] },
    ],
    series: [{ key: 'hours', label: '睡眠時數' }],
  },
  water: {
    label: '飲水', icon: '💧', unit: 'ml', aggregate: 'sum',
    fields: [{ key: 'ml', label: '飲水量', unit: 'ml', min: 1, max: 5000, step: 1, required: true, quick: [250, 350, 500] }],
    series: [{ key: 'ml', label: '飲水量' }],
  },
  steps: {
    label: '步數', icon: '👟', unit: '步', aggregate: 'sum',
    fields: [{ key: 'steps', label: '步數', unit: '步', min: 1, max: 100000, step: 1, required: true }],
    series: [{ key: 'steps', label: '步數' }],
  },
  exercise: {
    label: '運動', icon: '🏃', unit: '分鐘', aggregate: 'sum',
    fields: [
      { key: 'minutes', label: '運動時間', unit: '分鐘', min: 1, max: 1440, step: 1, required: true },
      { key: 'kind', label: '運動項目', kind: 'text', placeholder: '跑步、游泳、重訓…' },
    ],
    series: [{ key: 'minutes', label: '運動時間' }],
  },
  mood: {
    label: '心情', icon: '🙂', unit: '分',
    fields: [{ key: 'score', label: '心情', kind: 'select', required: true, options: [
      ['5', '😄 很好'], ['4', '🙂 不錯'], ['3', '😐 普通'], ['2', '🙁 不好'], ['1', '😞 很差'],
    ] }],
    series: [{ key: 'score', label: '心情' }],
  },
};

const GLUCOSE_CONTEXT = Object.fromEntries(TYPES.glucose.fields[1].options);

/* ---------- 健康判讀（僅供參考，非醫療建議） ---------- */
function classifyBP(sys, dia) {
  if (sys > 180 || dia > 120) return { level: 'warn', text: '危急，請立即就醫' };
  if (sys >= 140 || dia >= 90) return { level: 'warn', text: '高血壓第二期' };
  if (sys >= 130 || dia >= 80) return { level: 'warn', text: '高血壓第一期' };
  if (sys >= 120) return { level: 'warn', text: '血壓偏高' };
  if (sys < 90 || dia < 60) return { level: 'warn', text: '血壓偏低' };
  return { level: 'ok', text: '正常' };
}

function classifyGlucose(v, ctx) {
  if (v < 70) return { level: 'warn', text: '低血糖' };
  if (ctx === 'fasting' || ctx === 'before') {
    if (v >= 126) return { level: 'warn', text: '偏高' };
    if (v >= 100) return { level: 'warn', text: '略高' };
    return { level: 'ok', text: '正常' };
  }
  if (ctx === 'after') {
    if (v >= 200) return { level: 'warn', text: '偏高' };
    if (v >= 140) return { level: 'warn', text: '略高' };
    return { level: 'ok', text: '正常' };
  }
  if (v >= 200) return { level: 'warn', text: '偏高' };
  return null;
}

function classifyTemp(c) {
  if (c >= 38) return { level: 'warn', text: '發燒' };
  if (c >= 37.5) return { level: 'warn', text: '微燒' };
  if (c < 35) return { level: 'warn', text: '體溫過低' };
  return { level: 'ok', text: '正常' };
}

function classifyHeart(bpm) {
  if (bpm > 100) return { level: 'warn', text: '偏快' };
  if (bpm < 50) return { level: 'warn', text: '偏慢' };
  return { level: 'ok', text: '正常' };
}

function classifyBMI(bmi) {
  // 台灣衛福部國健署標準
  if (bmi < 18.5) return { level: 'warn', text: '過輕' };
  if (bmi < 24) return { level: 'ok', text: '正常' };
  if (bmi < 27) return { level: 'warn', text: '過重' };
  return { level: 'warn', text: '肥胖' };
}

function assess(entry) {
  const v = entry.values;
  switch (entry.type) {
    case 'bp': return classifyBP(v.sys, v.dia);
    case 'glucose': return classifyGlucose(v.value, v.context);
    case 'temp': return classifyTemp(v.celsius);
    case 'heart': return classifyHeart(v.bpm);
    case 'weight': {
      const bmi = calcBMI(v.weight);
      return bmi ? { ...classifyBMI(bmi), text: `BMI ${bmi.toFixed(1)} ${classifyBMI(bmi).text}` } : null;
    }
    default: return null;
  }
}

/* ---------- 儲存 ---------- */
const STORAGE_KEY = 'health-tracker:v1';
let state = { entries: [], profile: { height: null, goalWeight: null, waterGoal: 2000 } };

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.entries = Array.isArray(data.entries) ? data.entries.filter(isValidEntry) : [];
      state.profile = { ...state.profile, ...(data.profile || {}) };
    }
  } catch (e) {
    console.error(e);
    toast('讀取資料失敗');
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error(e);
    toast('儲存失敗：瀏覽器儲存空間不可用');
    return false;
  }
}

function isValidEntry(e) {
  return e && typeof e === 'object' && typeof e.id === 'string' && TYPES[e.type] &&
    typeof e.time === 'string' && !isNaN(new Date(e.time)) && e.values && typeof e.values === 'object';
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dayKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDay(key) {
  const today = dayKey(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (key === today) return '今天';
  if (key === dayKey(y)) return '昨天';
  const [yy, mm, dd] = key.split('-').map(Number);
  const wd = '日一二三四五六'[new Date(yy, mm - 1, dd).getDay()];
  return `${yy}/${mm}/${dd}（${wd}）`;
}
function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtNum(n) {
  if (n == null || n === '') return '';
  return Number.isInteger(n) ? n.toLocaleString('zh-TW') : Number(n.toFixed(2)).toLocaleString('zh-TW');
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function calcBMI(weight) {
  const h = Number(state.profile.height);
  if (!h || !weight) return null;
  return weight / ((h / 100) ** 2);
}

function describe(entry) {
  const t = TYPES[entry.type];
  const v = entry.values;
  switch (entry.type) {
    case 'bp': return `${v.sys}/${v.dia} mmHg` + (v.pulse ? ` · 脈搏 ${v.pulse}` : '');
    case 'weight': return `${fmtNum(v.weight)} kg` + (v.bodyFat ? ` · 體脂 ${fmtNum(v.bodyFat)}%` : '');
    case 'glucose': return `${v.value} mg/dL` + (v.context ? ` · ${GLUCOSE_CONTEXT[v.context]}` : '');
    case 'sleep': return `${fmtNum(v.hours)} 小時` + (v.quality ? ` · ${'★'.repeat(v.quality)}` : '');
    case 'exercise': return `${v.minutes} 分鐘` + (v.kind ? ` · ${v.kind}` : '');
    case 'mood': return t.fields[0].options.find(([k]) => Number(k) === v.score)?.[1] ?? String(v.score);
    default: {
      const f = t.fields[0];
      return `${fmtNum(v[f.key])} ${f.unit}`;
    }
  }
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function sortedEntries() {
  return [...state.entries].sort((a, b) => new Date(b.time) - new Date(a.time));
}

/* ---------- 導覽 ---------- */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

/* ---------- 總覽 ---------- */
function renderHome() {
  const wrap = $('#summary');
  wrap.innerHTML = '';
  const entries = sortedEntries();
  const today = dayKey(new Date());

  for (const [type, t] of Object.entries(TYPES)) {
    const btn = document.createElement('button');
    btn.className = 'stat';
    btn.type = 'button';
    let value = '', sub = '', status = null;

    if (t.aggregate === 'sum') {
      const key = t.fields[0].key;
      const total = entries
        .filter((e) => e.type === type && dayKey(new Date(e.time)) === today)
        .reduce((s, e) => s + (Number(e.values[key]) || 0), 0);
      value = total ? `${fmtNum(total)} <small>${t.unit}</small>` : '';
      sub = '今日累計';
      if (type === 'water' && state.profile.waterGoal) {
        const pct = Math.round((total / state.profile.waterGoal) * 100);
        sub = `今日 ${pct}% / 目標 ${fmtNum(Number(state.profile.waterGoal))} ml`;
      }
    } else {
      const latest = entries.find((e) => e.type === type);
      if (latest) {
        const d = new Date(latest.time);
        const dk = dayKey(d);
        value = escapeHTML(describe(latest)).replace(/ · .*/, '');
        sub = `${fmtDay(dk)} ${fmtTime(d)}`;
        status = assess(latest);
        if (type === 'weight' && state.profile.goalWeight) {
          const diff = latest.values.weight - Number(state.profile.goalWeight);
          sub += ` · 距目標 ${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg`;
        }
      }
    }

    btn.classList.toggle('empty', !value);
    if (status?.level === 'warn') btn.classList.add('warn');
    btn.innerHTML = `
      <div class="label">${t.icon} ${t.label}${status ? `<span class="badge ${status.level}">${escapeHTML(status.text)}</span>` : ''}</div>
      <div class="value">${value || '尚無紀錄'}</div>
      <div class="sub">${escapeHTML(sub)}</div>`;
    btn.addEventListener('click', () => {
      if (value) {
        $('#chart-metric').value = type;
        drawChart();
        $('.chart-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        startAdd(type);
      }
    });
    wrap.appendChild(btn);
  }
  drawChart();
}

/* ---------- 圖表 ---------- */
function chartData(type, days) {
  const t = TYPES[type];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const list = state.entries
    .filter((e) => e.type === type && new Date(e.time) >= start)
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  if (t.aggregate === 'sum') {
    const key = t.fields[0].key;
    const byDay = new Map();
    for (const e of list) {
      const d = new Date(e.time); d.setHours(12, 0, 0, 0);
      const k = d.getTime();
      byDay.set(k, (byDay.get(k) || 0) + (Number(e.values[key]) || 0));
    }
    return { start, series: [{ label: t.series[0].label, points: [...byDay].map(([x, y]) => ({ x, y })) }], bars: true };
  }
  return {
    start,
    series: t.series.map((s) => ({
      label: s.label,
      points: list.filter((e) => e.values[s.key] != null).map((e) => ({ x: new Date(e.time).getTime(), y: Number(e.values[s.key]) })),
    })),
    bars: false,
  };
}

function drawChart() {
  const canvas = $('#chart');
  const type = $('#chart-metric').value;
  const days = Number($('#chart-range').value);
  const t = TYPES[type];
  const { start, series, bars } = chartData(type, days);
  const all = series.flatMap((s) => s.points);

  const empty = all.length === 0;
  $('#chart-empty').classList.toggle('hidden', !empty);
  canvas.classList.toggle('hidden', empty);

  const statsEl = $('#chart-stats');
  if (empty) { statsEl.textContent = ''; return; }
  const ys0 = series[0].points.map((p) => p.y);
  const avg = ys0.reduce((a, b) => a + b, 0) / ys0.length;
  statsEl.textContent = `${series[0].label}：平均 ${fmtNum(avg)}、最低 ${fmtNum(Math.min(...ys0))}、最高 ${fmtNum(Math.max(...ys0))} ${t.unit}（${ys0.length} ${bars ? '天' : '筆'}）`;

  const css = getComputedStyle(document.documentElement);
  const colors = [css.getPropertyValue('--primary').trim(), css.getPropertyValue('--danger').trim()];
  const muted = css.getPropertyValue('--muted').trim();
  const border = css.getPropertyValue('--border').trim();

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = 220;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pad = { l: 44, r: 12, t: series.length > 1 ? 24 : 10, b: 26 };
  const x0 = start.getTime();
  const x1 = Date.now() + (bars ? 12 * 3600e3 : 0);
  let yMin = Math.min(...all.map((p) => p.y));
  let yMax = Math.max(...all.map((p) => p.y));
  if (bars) yMin = 0;
  if (type === 'weight' && state.profile.goalWeight) {
    yMin = Math.min(yMin, Number(state.profile.goalWeight));
    yMax = Math.max(yMax, Number(state.profile.goalWeight));
  }
  const span = yMax - yMin || Math.abs(yMax) * 0.1 || 1;
  if (!bars) { yMin -= span * 0.1; }
  yMax += span * 0.1;

  const X = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  // 格線與 Y 軸刻度
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = muted;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = yMin + ((yMax - yMin) * i) / 4;
    const y = Y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString(), pad.l - 6, y);
  }

  // X 軸日期
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const ticks = Math.min(days, Math.max(2, Math.floor((W - pad.l - pad.r) / 60)));
  for (let i = 0; i <= ticks; i++) {
    const x = x0 + ((x1 - x0) * i) / ticks;
    const d = new Date(x);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, X(x), H - pad.b + 6);
  }

  // 目標體重線
  if (type === 'weight' && state.profile.goalWeight) {
    const gy = Y(Number(state.profile.goalWeight));
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = muted;
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('目標', pad.l + 4, gy - 2);
  }

  // 資料
  series.forEach((s, i) => {
    const color = colors[i % colors.length];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (bars) {
      const bw = Math.max(3, Math.min(24, ((W - pad.l - pad.r) / days) * 0.7));
      for (const p of s.points) {
        ctx.fillRect(X(p.x) - bw / 2, Y(p.y), bw, Y(0) - Y(p.y));
      }
    } else {
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.points.forEach((p, j) => (j ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke();
      for (const p of s.points) {
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  });

  // 圖例
  if (series.length > 1) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let lx = pad.l;
    series.forEach((s, i) => {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(lx, 8, 10, 10);
      ctx.fillStyle = muted;
      ctx.fillText(s.label, lx + 14, 13);
      lx += ctx.measureText(s.label).width + 30;
    });
  }

  // 水量目標線
  if (type === 'water' && state.profile.waterGoal) {
    const gy = Y(Number(state.profile.waterGoal));
    if (gy > pad.t) {
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = muted;
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke();
      ctx.restore();
    }
  }
}

/* ---------- 新增 / 編輯 ---------- */
let editingId = null;

function renderFields(type, values = {}) {
  const t = TYPES[type];
  const wrap = $('#f-fields');
  wrap.innerHTML = '';
  const numeric = t.fields.filter((f) => !f.kind);
  const others = t.fields.filter((f) => f.kind);

  const makeField = (f) => {
    const label = document.createElement('label');
    label.textContent = f.unit ? `${f.label} (${f.unit})` : f.label;
    let input;
    if (f.kind === 'select') {
      input = document.createElement('select');
      if (!f.required) input.add(new Option('—', ''));
      for (const [val, text] of f.options) input.add(new Option(text, val));
      if (f.required && values[f.key] == null) input.value = f.options[Math.floor(f.options.length / 2)][0];
    } else if (f.kind === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 100;
      if (f.placeholder) input.placeholder = f.placeholder;
    } else {
      input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.min = f.min; input.max = f.max; input.step = f.step;
    }
    input.name = f.key;
    input.required = !!f.required;
    if (values[f.key] != null) input.value = values[f.key];
    label.appendChild(input);

    if (f.quick) {
      const q = document.createElement('div');
      q.className = 'form-actions wrap';
      for (const amount of f.quick) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn'; b.textContent = `${amount} ${f.unit}`;
        b.addEventListener('click', () => { input.value = amount; updateHint(); });
        q.appendChild(b);
      }
      label.appendChild(q);
    }
    return label;
  };

  if (numeric.length > 1) {
    const row = document.createElement('div');
    row.className = 'row';
    numeric.forEach((f) => row.appendChild(makeField(f)));
    wrap.appendChild(row);
  } else {
    numeric.forEach((f) => wrap.appendChild(makeField(f)));
  }
  others.forEach((f) => wrap.appendChild(makeField(f)));
  updateHint();
}

function readForm() {
  const type = $('#f-type').value;
  const values = {};
  for (const f of TYPES[type].fields) {
    const el = $('#f-fields').querySelector(`[name="${f.key}"]`);
    const raw = el.value.trim();
    if (raw === '') continue;
    if (f.kind === 'text') values[f.key] = raw;
    else if (f.kind === 'select') values[f.key] = /^\d+$/.test(raw) ? Number(raw) : raw;
    else values[f.key] = Number(raw);
  }
  return { type, values };
}

function updateHint() {
  const hint = $('#form-hint');
  const { type, values } = readForm();
  const t = TYPES[type];
  const complete = t.fields.every((f) => !f.required || values[f.key] != null);
  const status = complete ? assess({ type, values }) : null;
  hint.textContent = status ? `判讀：${status.text}（僅供參考，非醫療建議）` : '';
  hint.classList.toggle('warn', status?.level === 'warn');
}

function startAdd(type) {
  editingId = null;
  $('#form-title').textContent = '新增紀錄';
  $('#btn-cancel-edit').classList.add('hidden');
  $('#entry-form').reset();
  if (type) $('#f-type').value = type;
  $('#f-time').value = toLocalInput(new Date());
  renderFields($('#f-type').value);
  showView('add');
}

function startEdit(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  $('#form-title').textContent = '編輯紀錄';
  $('#btn-cancel-edit').classList.remove('hidden');
  $('#f-type').value = e.type;
  $('#f-time').value = e.time.slice(0, 16);
  $('#f-note').value = e.note || '';
  renderFields(e.type, e.values);
  showView('add');
}

function onSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;
  if (!form.reportValidity()) return;
  const { type, values } = readForm();
  const time = $('#f-time').value;
  const note = $('#f-note').value.trim();

  if (type === 'bp' && values.dia >= values.sys) {
    toast('舒張壓應低於收縮壓，請確認數值');
    return;
  }

  if (editingId) {
    const e = state.entries.find((x) => x.id === editingId);
    Object.assign(e, { type, time, values, note, updatedAt: new Date().toISOString() });
  } else {
    state.entries.push({ id: uid(), type, time, values, note, createdAt: new Date().toISOString() });
  }
  if (!save()) return;
  toast(editingId ? '已更新' : '已儲存');
  const wasEditing = !!editingId;
  editingId = null;
  if (wasEditing) {
    showView('history');
  } else {
    // 保留類型，方便連續輸入
    $('#f-note').value = '';
    $('#f-time').value = toLocalInput(new Date());
    renderFields(type);
    $('#chart-metric').value = type;
    showView('home');
  }
}

/* ---------- 歷史 ---------- */
function renderHistory() {
  const list = $('#history');
  const filter = $('#h-filter').value;
  const entries = sortedEntries().filter((e) => !filter || e.type === filter);
  list.innerHTML = '';
  $('#history-empty').classList.toggle('hidden', entries.length > 0);

  let lastDay = null;
  for (const e of entries) {
    const d = new Date(e.time);
    const dk = dayKey(d);
    if (dk !== lastDay) {
      const li = document.createElement('li');
      li.className = 'day';
      li.textContent = fmtDay(dk);
      list.appendChild(li);
      lastDay = dk;
    }
    const t = TYPES[e.type];
    const status = assess(e);
    const li = document.createElement('li');
    li.className = 'entry';
    li.innerHTML = `
      <div class="icon">${t.icon}</div>
      <div class="body">
        <div class="main">${t.label}　${escapeHTML(describe(e))}${status ? `<span class="badge ${status.level}">${escapeHTML(status.text)}</span>` : ''}</div>
        <div class="meta">${fmtTime(d)}${e.note ? ' · ' + escapeHTML(e.note) : ''}</div>
      </div>
      <div class="actions">
        <button data-act="edit" aria-label="編輯">✏️</button>
        <button data-act="del" aria-label="刪除">🗑️</button>
      </div>`;
    li.querySelector('[data-act="edit"]').addEventListener('click', () => startEdit(e.id));
    li.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (!confirm(`確定刪除這筆${t.label}紀錄？`)) return;
      state.entries = state.entries.filter((x) => x.id !== e.id);
      save();
      renderHistory();
      toast('已刪除');
    });
    list.appendChild(li);
  }
}

/* ---------- 設定 / 備份 ---------- */
function renderSettings() {
  $('#p-height').value = state.profile.height ?? '';
  $('#p-goal').value = state.profile.goalWeight ?? '';
  $('#p-water').value = state.profile.waterGoal ?? '';
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportJSON() {
  const data = { app: 'health-tracker', version: 1, exportedAt: new Date().toISOString(), ...state };
  download(`health-${dayKey(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function exportCSV() {
  const keys = [...new Set(Object.values(TYPES).flatMap((t) => t.fields.map((f) => f.key)))];
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['時間', '類型', '摘要', ...keys, '備註']];
  for (const e of sortedEntries()) {
    rows.push([e.time.replace('T', ' '), TYPES[e.type].label, describe(e), ...keys.map((k) => e.values[k]), e.note || '']);
  }
  // 加上 BOM 讓 Excel 正確顯示中文
  download(`health-${dayKey(new Date())}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = (Array.isArray(data.entries) ? data.entries : []).filter(isValidEntry);
      if (!incoming.length && !data.profile) throw new Error('empty');
      const ids = new Set(state.entries.map((e) => e.id));
      const added = incoming.filter((e) => !ids.has(e.id));
      state.entries.push(...added);
      if (data.profile && typeof data.profile === 'object') {
        const { height, goalWeight, waterGoal } = data.profile;
        state.profile = { ...state.profile, ...(height != null && { height }), ...(goalWeight != null && { goalWeight }), ...(waterGoal != null && { waterGoal }) };
      }
      save();
      renderSettings();
      toast(`已匯入 ${added.length} 筆紀錄`);
    } catch {
      toast('匯入失敗：檔案格式不正確');
    }
  };
  reader.readAsText(file);
}

/* ---------- 初始化 ---------- */
function init() {
  load();

  for (const [key, t] of Object.entries(TYPES)) {
    $('#f-type').add(new Option(`${t.icon} ${t.label}`, key));
    $('#chart-metric').add(new Option(`${t.icon} ${t.label}`, key));
    $('#h-filter').add(new Option(`${t.icon} ${t.label}`, key));
  }

  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.view === 'add' ? startAdd() : showView(b.dataset.view))));
  $('#btn-settings').addEventListener('click', () => showView('settings'));

  $('#f-type').addEventListener('change', (e) => renderFields(e.target.value));
  $('#f-fields').addEventListener('input', updateHint);
  $('#entry-form').addEventListener('submit', onSubmit);
  $('#btn-cancel-edit').addEventListener('click', () => { editingId = null; showView('history'); });

  $('#chart-metric').addEventListener('change', drawChart);
  $('#chart-range').addEventListener('change', drawChart);
  $('#h-filter').addEventListener('change', renderHistory);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if ($('#view-home').classList.contains('active')) drawChart(); }, 150);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawChart);

  $('#profile-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!ev.target.reportValidity()) return;
    const num = (sel) => ($(sel).value === '' ? null : Number($(sel).value));
    state.profile = { height: num('#p-height'), goalWeight: num('#p-goal'), waterGoal: num('#p-water') };
    if (save()) toast('個人資料已儲存');
  });
  $('#btn-export-json').addEventListener('click', exportJSON);
  $('#btn-export-csv').addEventListener('click', exportCSV);
  $('#import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-clear').addEventListener('click', () => {
    if (!confirm('確定清除所有紀錄與個人資料？此動作無法復原，建議先匯出備份。')) return;
    state = { entries: [], profile: { height: null, goalWeight: null, waterGoal: 2000 } };
    save();
    renderSettings();
    toast('已清除全部資料');
  });

  // 預設圖表顯示最常記錄的類型
  const counts = {};
  state.entries.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $('#chart-metric').value = top ? top[0] : 'weight';

  $('#f-type').value = 'weight';
  $('#f-time').value = toLocalInput(new Date());
  renderFields('weight');
  showView('home');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 註冊失敗', e));
  }
}

document.addEventListener('DOMContentLoaded', init);
