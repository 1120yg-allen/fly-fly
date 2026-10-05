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


/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const dayKey = dateKey;
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
function fmtAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  return new Date(ts).toLocaleString('zh-TW');
}

function calcBMI(weight) {
  const h = Number(currentProfile()?.height);
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const myEntries = () => mine('entries').filter((e) => TYPES[e.type]);
function sortedEntries() {
  return myEntries().sort((a, b) => new Date(b.time) - new Date(a.time));
}

/* ---------- 導覽 ---------- */
let currentView = 'home';

function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
  renderView();
}

function renderView() {
  renderProfileSwitch();
  if (currentView === 'add' && !editingId) {
    $('#form-title').textContent = `新增紀錄：${currentProfile().name}`;
    $('#btn-cancel-edit').classList.add('hidden');
  }
  if (currentView === 'home') renderHome();
  if (currentView === 'meds') renderMeds();
  if (currentView === 'history') renderHistory();
  if (currentView === 'settings') renderSettings();
}

/* ---------- 成員切換 ---------- */
function renderProfileSwitch() {
  const sel = $('#profile-switch');
  sel.innerHTML = '';
  for (const p of live('profiles')) sel.add(new Option(`${p.avatar || '🙂'} ${p.name}`, p.id));
  sel.add(new Option('＋ 新增成員…', '__new'));
  sel.value = local.currentProfileId;
}

function switchProfile(id) {
  local.currentProfileId = id;
  persistLocal();
  editingId = null;
  closeMedForm();
  pickDefaultChartMetric();
  renderView();
  toast(`已切換到 ${currentProfile().name}`);
}

/* ---------- 總覽 ---------- */
function renderHome() {
  renderDoseList($('#home-dose-list'), { compact: true });
  $('#home-meds').classList.toggle('hidden', !doseSlots(dayKey(new Date()), local.currentProfileId).length);

  const wrap = $('#summary');
  wrap.innerHTML = '';
  const entries = sortedEntries();
  const today = dayKey(new Date());
  const profile = currentProfile();

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
      if (type === 'water' && profile.waterGoal) {
        const pct = Math.round((total / profile.waterGoal) * 100);
        sub = `今日 ${pct}% / 目標 ${fmtNum(Number(profile.waterGoal))} ml`;
      }
    } else {
      const latest = entries.find((e) => e.type === type);
      if (latest) {
        const d = new Date(latest.time);
        value = escapeHTML(describe(latest)).replace(/ · .*/, '');
        sub = `${fmtDay(dayKey(d))} ${fmtTime(d)}`;
        status = assess(latest);
        if (type === 'weight' && profile.goalWeight) {
          const diff = latest.values.weight - Number(profile.goalWeight);
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
  const list = myEntries()
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
  const profile = currentProfile();
  const goal = type === 'weight' ? Number(profile.goalWeight) || null : type === 'water' ? Number(profile.waterGoal) || null : null;
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
  const DAY = 86400e3;
  const x1 = bars ? x0 + days * DAY : Date.now();
  let yMin = Math.min(...all.map((p) => p.y));
  let yMax = Math.max(...all.map((p) => p.y));
  if (bars) yMin = 0;
  if (goal) { yMin = Math.min(yMin, goal); yMax = Math.max(yMax, goal); }
  const span = yMax - yMin || Math.abs(yMax) * 0.1 || 1;
  if (!bars) yMin -= span * 0.1;
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
  const ticks = Math.min(days - 1, Math.max(2, Math.floor((W - pad.l - pad.r) / 60)));
  for (let i = 0; i <= ticks; i++) {
    const x = x0 + Math.round((i * (days - 1)) / ticks) * DAY + DAY / 2; // 標在每一天的中午
    const d = new Date(x);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, X(Math.min(x, x1)), H - pad.b + 6);
  }

  // 目標線（體重 / 飲水）
  if (goal) {
    const gy = Y(goal);
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
      for (const p of s.points) ctx.fillRect(X(p.x) - bw / 2, Y(p.y), bw, Y(0) - Y(p.y));
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
}

function pickDefaultChartMetric() {
  const counts = {};
  myEntries().forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $('#chart-metric').value = top ? top[0] : 'weight';
}

/* ---------- 新增 / 編輯健康紀錄 ---------- */
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
  $('#form-title').textContent = `新增紀錄：${currentProfile().name}`;
  $('#btn-cancel-edit').classList.add('hidden');
  $('#entry-form').reset();
  if (type) $('#f-type').value = type;
  $('#f-time').value = toLocalInput(new Date());
  renderFields($('#f-type').value);
  showView('add');
}

function startEdit(id) {
  const e = getById('entries', id);
  if (!e) return;
  editingId = id;
  $('#form-title').textContent = `編輯紀錄：${currentProfile().name}`;
  $('#btn-cancel-edit').classList.remove('hidden');
  $('#f-type').value = e.type;
  $('#f-time').value = e.time.slice(0, 16);
  $('#f-note').value = e.note || '';
  renderFields(e.type, e.values);
  showView('add');
}

function onSubmitEntry(ev) {
  ev.preventDefault();
  if (!ev.target.reportValidity()) return;
  const { type, values } = readForm();
  const time = $('#f-time').value;
  const note = $('#f-note').value.trim();

  if (type === 'bp' && values.dia >= values.sys) {
    toast('舒張壓應低於收縮壓，請確認數值');
    return;
  }

  const existing = editingId && getById('entries', editingId);
  const rec = existing
    ? { ...existing, type, time, values, note }
    : { id: uid(), profileId: local.currentProfileId, type, time, values, note, createdAt: new Date().toISOString() };
  if (!upsert('entries', rec)) return;
  toast(existing ? '已更新' : '已儲存');
  editingId = null;
  if (existing) {
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

/* ---------- 服藥 ---------- */
let editingMedId = null;

function renderDoseList(listEl, { compact = false } = {}) {
  const today = dayKey(new Date());
  const slots = doseSlots(today, local.currentProfileId);
  const now = Date.now();
  listEl.innerHTML = '';
  for (const s of slots) {
    const li = document.createElement('li');
    const due = slotDate(s.date, s.time).getTime() <= now;
    li.className = 'dose' + (s.log ? ' done' : due ? ' overdue' : '');
    const statusText = s.log
      ? (s.log.status === 'taken' ? `✓ 已服用 ${fmtTime(new Date(s.log.at))}` : '已略過')
      : due ? '尚未服用' : '';
    li.innerHTML = `
      <div class="time">${s.time}</div>
      <div class="body">
        <div class="name">${escapeHTML(s.med.name)}${s.med.dose ? `　<span class="muted">${escapeHTML(s.med.dose)}</span>` : ''}</div>
        <div class="meta">${escapeHTML([statusText, compact ? '' : s.med.note].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="actions"></div>`;
    const actions = li.querySelector('.actions');
    const addBtn = (text, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `btn small-btn ${cls}`; b.textContent = text;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    if (s.log) {
      addBtn('復原', 'ghost', () => { remove('doses', s.id); renderView(); });
    } else {
      addBtn('✓ 服用', 'primary', () => { logDose(s, 'taken'); toast(`已記錄：${s.med.name}`); renderView(); });
      if (!compact) addBtn('略過', '', () => { logDose(s, 'skipped'); renderView(); });
    }
    listEl.appendChild(li);
  }
  return slots.length;
}

function renderNotifyBanner() {
  const banner = $('#notify-banner');
  const text = $('#notify-text');
  const btn = $('#btn-notify');
  const hasMeds = mine('meds').length > 0;
  banner.classList.toggle('hidden', !hasMeds);
  if (!hasMeds) return;
  const perm = notificationsSupported() ? Notification.permission : 'unsupported';
  btn.classList.toggle('hidden', perm !== 'default');
  text.textContent = {
    granted: '🔔 通知已開啟：App 開著（或在背景）時會在服藥時間跳出提醒。若完全關閉 App，建議匯出到手機行事曆，由系統提醒。',
    default: '開啟通知後，到了服藥時間會跳出提醒。也可以匯出到手機行事曆，即使 App 關閉也會提醒。',
    denied: '通知已被封鎖，只會在 App 畫面中提醒。可到瀏覽器設定開啟通知，或匯出到手機行事曆。',
    unsupported: '此瀏覽器不支援通知，只會在 App 畫面中提醒。建議匯出到手機行事曆。',
  }[perm];
}

function renderMeds() {
  $('#meds-date').textContent = fmtDay(dayKey(new Date()));
  const count = renderDoseList($('#dose-list'));
  $('#dose-empty').classList.toggle('hidden', count > 0);
  renderNotifyBanner();

  const list = $('#med-list');
  const meds = mine('meds').sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  list.innerHTML = '';
  $('#med-empty').classList.toggle('hidden', meds.length > 0);
  for (const med of meds) {
    const { due, taken } = adherence(med);
    const days = med.days.length === 7 ? '每天' : '每週' + WEEKDAYS.filter(([d]) => med.days.includes(d)).map(([, l]) => l).join('、');
    const li = document.createElement('li');
    li.className = 'entry';
    li.innerHTML = `
      <div class="icon">💊</div>
      <div class="body">
        <div class="main">${escapeHTML(med.name)}${med.dose ? `　${escapeHTML(med.dose)}` : ''}${med.active === false ? '<span class="badge warn">已停用</span>' : ''}</div>
        <div class="meta">${days} ${med.times.join('、')}${med.note ? ' · ' + escapeHTML(med.note) : ''}</div>
        <div class="meta">${due ? `近 7 天服藥率 ${Math.round((taken / due) * 100)}%（${taken}/${due}）` : '近 7 天尚無排程'}</div>
      </div>
      <div class="actions">
        <button data-act="edit" aria-label="編輯">✏️</button>
        <button data-act="del" aria-label="刪除">🗑️</button>
      </div>`;
    li.querySelector('[data-act="edit"]').addEventListener('click', () => openMedForm(med));
    li.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (!confirm(`確定刪除「${med.name}」？`)) return;
      remove('meds', med.id);
      renderMeds();
      toast('已刪除');
    });
    list.appendChild(li);
  }
}

function addTimeInput(value = '08:00') {
  const row = document.createElement('div');
  row.className = 'time-row';
  row.innerHTML = `<input type="time" required value="${value}"><button type="button" class="btn small-btn ghost" aria-label="移除時間">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if ($('#m-times').children.length > 1) row.remove();
  });
  $('#m-times').appendChild(row);
}

function openMedForm(med) {
  editingMedId = med?.id || null;
  $('#med-form-title').textContent = med ? '編輯藥物' : `新增藥物：${currentProfile().name}`;
  $('#m-name').value = med?.name || '';
  $('#m-dose').value = med?.dose || '';
  $('#m-note').value = med?.note || '';
  $('#m-start').value = med?.startDate || dayKey(new Date());
  $('#m-active').checked = med ? med.active !== false : true;
  $('#m-times').innerHTML = '';
  (med?.times || ['08:00']).forEach((t) => addTimeInput(t));
  const days = med?.days || [0, 1, 2, 3, 4, 5, 6];
  $('#m-days').innerHTML = '';
  for (const [d, label] of WEEKDAYS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = label; b.dataset.day = d;
    b.setAttribute('aria-pressed', days.includes(d));
    b.addEventListener('click', () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'));
    $('#m-days').appendChild(b);
  }
  $('#med-form').classList.remove('hidden');
  $('#btn-add-med').classList.add('hidden');
  $('#med-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#m-name').focus({ preventScroll: true });
}

function closeMedForm() {
  editingMedId = null;
  $('#med-form').classList.add('hidden');
  $('#btn-add-med').classList.remove('hidden');
}

function onSubmitMed(ev) {
  ev.preventDefault();
  if (!ev.target.reportValidity()) return;
  const times = [...new Set([...$('#m-times').querySelectorAll('input')].map((i) => i.value).filter(Boolean))].sort();
  const days = [...$('#m-days').querySelectorAll('.chip')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => Number(b.dataset.day));
  if (!times.length) return toast('請至少設定一個服用時間');
  if (!days.length) return toast('請至少選擇一天');
  const existing = editingMedId && getById('meds', editingMedId);
  upsert('meds', {
    ...(existing || { id: uid(), profileId: local.currentProfileId, createdAt: new Date().toISOString() }),
    name: $('#m-name').value.trim(),
    dose: $('#m-dose').value.trim(),
    note: $('#m-note').value.trim(),
    startDate: $('#m-start').value || null,
    active: $('#m-active').checked,
    times, days,
  });
  toast(existing ? '已更新藥物' : '已新增藥物');
  closeMedForm();
  renderMeds();
  if (notificationsSupported() && Notification.permission === 'default') {
    requestNotificationPermission().then(renderNotifyBanner);
  }
}

function exportICS() {
  const meds = mine('meds').filter((m) => m.active !== false);
  if (!meds.length) return toast('沒有啟用中的藥物');
  const profile = currentProfile();
  const name = live('profiles').length > 1 ? profile.name : '';
  download(`服藥提醒${name ? '-' + name : ''}.ics`, buildICS(meds, name), 'text/calendar');
  toast('已匯出，用手機開啟檔案即可加入行事曆');
}

function onInAppReminder(slot, msg) {
  toast(`${msg.title}　${msg.body}`);
  if (currentView === 'home' || currentView === 'meds') renderView();
}

function takeFromNotification(id) {
  const slot = findSlot(id);
  if (!slot) return;
  if (!slot.log) logDose(slot, 'taken');
  toast(`已記錄服用：${slot.med.name}`);
  renderView();
}

/* ---------- 歷史 ---------- */
function renderHistory() {
  const list = $('#history');
  const filter = $('#h-filter').value;
  const items = [];
  if (filter !== 'med') {
    for (const e of myEntries()) if (!filter || e.type === filter) items.push({ kind: 'entry', at: new Date(e.time), e });
  }
  if (!filter || filter === 'med') {
    const meds = new Map(db.meds.map((m) => [m.id, m]));
    for (const d of mine('doses')) items.push({ kind: 'dose', at: new Date(d.status === 'taken' ? d.at : `${d.date}T${d.time}`), d, med: meds.get(d.medId) });
  }
  items.sort((a, b) => b.at - a.at);

  list.innerHTML = '';
  $('#history-empty').classList.toggle('hidden', items.length > 0);

  let lastDay = null;
  for (const item of items) {
    const dk = dayKey(item.at);
    if (dk !== lastDay) {
      const li = document.createElement('li');
      li.className = 'day';
      li.textContent = fmtDay(dk);
      list.appendChild(li);
      lastDay = dk;
    }
    const li = document.createElement('li');
    li.className = 'entry';
    if (item.kind === 'dose') {
      const { d, med } = item;
      const name = med && !med.deleted ? med.name : '（已刪除的藥物）';
      li.innerHTML = `
        <div class="icon">💊</div>
        <div class="body">
          <div class="main">${escapeHTML(name)}　${d.status === 'taken' ? '已服用' : '<span class="muted">略過</span>'}</div>
          <div class="meta">${fmtTime(item.at)} · 預定 ${d.time}</div>
        </div>
        <div class="actions"><button data-act="del" aria-label="刪除">🗑️</button></div>`;
      li.querySelector('[data-act="del"]').addEventListener('click', () => {
        if (!confirm('確定刪除這筆服藥紀錄？')) return;
        remove('doses', d.id);
        renderHistory();
      });
    } else {
      const { e } = item;
      const t = TYPES[e.type];
      const status = assess(e);
      li.innerHTML = `
        <div class="icon">${t.icon}</div>
        <div class="body">
          <div class="main">${t.label}　${escapeHTML(describe(e))}${status ? `<span class="badge ${status.level}">${escapeHTML(status.text)}</span>` : ''}</div>
          <div class="meta">${fmtTime(item.at)}${e.note ? ' · ' + escapeHTML(e.note) : ''}</div>
        </div>
        <div class="actions">
          <button data-act="edit" aria-label="編輯">✏️</button>
          <button data-act="del" aria-label="刪除">🗑️</button>
        </div>`;
      li.querySelector('[data-act="edit"]').addEventListener('click', () => startEdit(e.id));
      li.querySelector('[data-act="del"]').addEventListener('click', () => {
        if (!confirm(`確定刪除這筆${t.label}紀錄？`)) return;
        remove('entries', e.id);
        renderHistory();
        toast('已刪除');
      });
    }
    list.appendChild(li);
  }
}

/* ---------- 設定：成員 ---------- */
let editingProfileId = null;
let pickedAvatar = AVATARS[0];

function renderProfiles() {
  const list = $('#profile-list');
  list.innerHTML = '';
  const profiles = live('profiles');
  for (const p of profiles) {
    const count = live('entries').filter((e) => e.profileId === p.id).length;
    const medCount = live('meds').filter((m) => m.profileId === p.id).length;
    const li = document.createElement('li');
    li.className = 'entry' + (p.id === local.currentProfileId ? ' current' : '');
    li.innerHTML = `
      <div class="icon">${escapeHTML(p.avatar || '🙂')}</div>
      <div class="body">
        <div class="main">${escapeHTML(p.name)}${p.id === local.currentProfileId ? '<span class="badge ok">目前</span>' : ''}</div>
        <div class="meta">${[p.height && `身高 ${p.height} cm`, p.goalWeight && `目標 ${p.goalWeight} kg`, `${count} 筆紀錄`, medCount && `${medCount} 種藥物`].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="actions">
        <button data-act="edit" aria-label="編輯">✏️</button>
        <button data-act="del" aria-label="刪除">🗑️</button>
      </div>`;
    li.querySelector('.body').addEventListener('click', () => p.id !== local.currentProfileId && switchProfile(p.id));
    li.querySelector('[data-act="edit"]').addEventListener('click', () => openProfileForm(p));
    const del = li.querySelector('[data-act="del"]');
    del.disabled = profiles.length <= 1;
    del.title = profiles.length <= 1 ? '至少需要保留一位成員' : '';
    del.addEventListener('click', () => {
      if (!confirm(`確定刪除成員「${p.name}」以及他的所有紀錄與藥物？此動作無法復原。`)) return;
      removeProfile(p.id);
      closeProfileForm();
      renderView();
      toast('已刪除成員');
    });
    list.appendChild(li);
  }
}

function openProfileForm(p) {
  editingProfileId = p?.id || null;
  $('#profile-form-title').textContent = p ? '編輯成員' : '新增成員';
  $('#p-name').value = p?.name || '';
  $('#p-height').value = p?.height ?? '';
  $('#p-goal').value = p?.goalWeight ?? '';
  $('#p-water').value = p ? (p.waterGoal ?? '') : DEFAULT_PROFILE.waterGoal;
  pickedAvatar = p?.avatar || AVATARS[live('profiles').length % AVATARS.length];
  const wrap = $('#p-avatars');
  wrap.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = a;
    b.setAttribute('aria-pressed', a === pickedAvatar);
    b.addEventListener('click', () => {
      pickedAvatar = a;
      wrap.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
    });
    wrap.appendChild(b);
  }
  $('#profile-form').classList.remove('hidden');
  $('#profile-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#p-name').focus({ preventScroll: true });
}

function closeProfileForm() {
  editingProfileId = null;
  $('#profile-form').classList.add('hidden');
}

function onSubmitProfile(ev) {
  ev.preventDefault();
  if (!ev.target.reportValidity()) return;
  const num = (sel) => ($(sel).value === '' ? null : Number($(sel).value));
  const existing = editingProfileId && getById('profiles', editingProfileId);
  const { auto, ...base } = existing || { id: uid() };
  const rec = upsert('profiles', {
    ...base,
    name: $('#p-name').value.trim(), avatar: pickedAvatar,
    height: num('#p-height'), goalWeight: num('#p-goal'), waterGoal: num('#p-water'),
  });
  if (!rec) return;
  closeProfileForm();
  if (!existing) {
    switchProfile(rec.id);
  } else {
    renderView();
    toast('已儲存');
  }
}

/* ---------- 設定：雲端同步 ---------- */
const SYNC_TEXT = { off: '未啟用', idle: '已同步', syncing: '同步中…', error: '同步失敗', offline: '離線（恢復連線後會自動同步）' };

function renderSync() {
  const connected = Sync.enabled;
  const mode = connected || $('#sync-form').dataset.open === '1' ? 'cloud' : 'local';
  document.querySelectorAll('[name="storage-mode"]').forEach((r) => (r.checked = r.value === mode));
  $('#sync-form').classList.toggle('hidden', connected || mode !== 'cloud');
  $('#sync-connected').classList.toggle('hidden', !connected);
  if (!$('#s-server').value && /^https?:$/.test(location.protocol)) $('#s-server').value = location.origin;
  if (connected) {
    $('#s-account-label').textContent = local.sync.account;
    $('#s-server-label').textContent = local.sync.server;
  }
  renderSyncStatus();
}

function renderSyncStatus() {
  const st = Sync.status;
  const btn = $('#btn-sync');
  btn.classList.toggle('hidden', !Sync.enabled);
  btn.className = `icon-btn sync-indicator ${st.state}${Sync.enabled ? '' : ' hidden'}`;
  btn.textContent = st.state === 'error' || st.state === 'offline' ? '⚠︎' : '☁︎';
  btn.title = `雲端同步：${SYNC_TEXT[st.state]}${st.message ? '（' + st.message + '）' : ''}`;
  const label = $('#s-status');
  if (label) {
    label.textContent = SYNC_TEXT[st.state] + (st.state === 'idle' && st.lastSyncAt ? `（${fmtAgo(st.lastSyncAt)}）` : '');
  }
  $('#sync-error').textContent = st.state === 'error' ? st.message : '';
}

async function onConnectSync(ev) {
  ev.preventDefault();
  if (!ev.target.reportValidity()) return;
  const btn = $('#btn-connect');
  btn.disabled = true;
  btn.textContent = '連線中…';
  $('#sync-error').textContent = '';
  try {
    await Sync.connect($('#s-server').value, $('#s-account').value, $('#s-password').value);
    $('#s-password').value = '';
    $('#sync-form').dataset.open = '';
    toast('已啟用雲端同步');
    renderView();
  } catch (e) {
    $('#sync-error').textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '連線並同步';
  }
}

/* ---------- 設定：備份 ---------- */
function renderSettings() {
  renderProfiles();
  renderSync();
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
  const data = { app: 'health-tracker', exportedAt: new Date().toISOString(), ...db };
  download(`health-${dayKey(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function exportCSV() {
  const keys = [...new Set(Object.values(TYPES).flatMap((t) => t.fields.map((f) => f.key)))];
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const names = new Map(live('profiles').map((p) => [p.id, p.name]));
  const rows = [['成員', '時間', '類型', '摘要', ...keys, '備註']];
  const entries = live('entries').filter((e) => TYPES[e.type] && names.has(e.profileId)).sort((a, b) => new Date(b.time) - new Date(a.time));
  for (const e of entries) {
    rows.push([names.get(e.profileId), e.time.replace('T', ' '), TYPES[e.type].label, describe(e), ...keys.map((k) => e.values[k]), e.note || '']);
  }
  const meds = new Map(db.meds.map((m) => [m.id, m]));
  for (const d of live('doses').filter((x) => names.has(x.profileId))) {
    rows.push([names.get(d.profileId), `${d.date} ${d.time}`, '服藥', `${meds.get(d.medId)?.name || ''} ${d.status === 'taken' ? '已服用' : '略過'}`, ...keys.map(() => ''), '']);
  }
  // 加上 BOM 讓 Excel 正確顯示中文
  download(`health-${dayKey(new Date())}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      let incoming;
      if (Array.isArray(data.profiles)) {
        incoming = sanitize(data);
      } else if (Array.isArray(data.entries)) {
        // 舊版單人備份：匯入到目前的成員
        const { entries } = migrateLegacy(data, local.currentProfileId);
        incoming = sanitize({ entries });
      } else {
        throw new Error('format');
      }
      const before = new Set(COLLECTIONS.flatMap((c) => db[c].map((r) => r.id)));
      const added = COLLECTIONS.reduce((n, c) => n + incoming[c].filter((r) => !before.has(r.id) && !r.deleted).length, 0);
      db = mergeData(db, incoming);
      ensureProfile();
      persist();
      renderView();
      toast(`已匯入 ${added} 筆新資料`);
    } catch {
      toast('匯入失敗：檔案格式不正確');
    }
  };
  reader.readAsText(file);
}

function clearAll() {
  const msg = Sync.enabled
    ? '確定清除所有成員、紀錄與藥物？雲端與其他同步裝置上的資料也會一起刪除，此動作無法復原。'
    : '確定清除所有成員、紀錄與藥物？此動作無法復原，建議先匯出備份。';
  if (!confirm(msg)) return;
  for (const c of COLLECTIONS) db[c] = db[c].map((r) => (r.deleted ? r : tombstone(c, r)));
  ensureProfile();
  persist();
  renderView();
  toast('已清除全部資料');
}

/* ---------- 初始化 ---------- */
function init() {
  loadAll();

  for (const [key, t] of Object.entries(TYPES)) {
    $('#f-type').add(new Option(`${t.icon} ${t.label}`, key));
    $('#chart-metric').add(new Option(`${t.icon} ${t.label}`, key));
    $('#h-filter').add(new Option(`${t.icon} ${t.label}`, key));
  }
  $('#h-filter').add(new Option('💊 服藥', 'med'));

  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.view === 'add' ? startAdd() : showView(b.dataset.view))));
  $('#btn-settings').addEventListener('click', () => showView('settings'));
  $('#btn-sync').addEventListener('click', () => showView('settings'));
  $('#profile-switch').addEventListener('change', (e) => {
    if (e.target.value === '__new') {
      e.target.value = local.currentProfileId;
      showView('settings');
      openProfileForm(null);
    } else {
      switchProfile(e.target.value);
    }
  });

  // 健康紀錄
  $('#f-type').addEventListener('change', (e) => renderFields(e.target.value));
  $('#f-fields').addEventListener('input', updateHint);
  $('#entry-form').addEventListener('submit', onSubmitEntry);
  $('#btn-cancel-edit').addEventListener('click', () => { editingId = null; showView('history'); });
  $('#chart-metric').addEventListener('change', drawChart);
  $('#chart-range').addEventListener('change', drawChart);
  $('#h-filter').addEventListener('change', renderHistory);

  // 服藥
  $('#btn-add-med').addEventListener('click', () => openMedForm(null));
  $('#btn-cancel-med').addEventListener('click', closeMedForm);
  $('#btn-add-time').addEventListener('click', () => addTimeInput('20:00'));
  $('#med-form').addEventListener('submit', onSubmitMed);
  $('#btn-notify').addEventListener('click', () => requestNotificationPermission().then(renderNotifyBanner));
  $('#btn-ics').addEventListener('click', exportICS);

  // 成員
  $('#btn-add-profile').addEventListener('click', () => openProfileForm(null));
  $('#btn-cancel-profile').addEventListener('click', closeProfileForm);
  $('#profile-form').addEventListener('submit', onSubmitProfile);

  // 同步
  document.querySelectorAll('[name="storage-mode"]').forEach((r) => r.addEventListener('change', () => {
    if (r.value === 'local' && Sync.enabled) {
      if (!confirm('確定停止雲端同步？資料仍會保留在這台裝置上。')) return renderSync();
      Sync.disconnect();
      toast('已停止同步');
    }
    $('#sync-form').dataset.open = r.value === 'cloud' ? '1' : '';
    renderSync();
  }));
  $('#sync-form').addEventListener('submit', onConnectSync);
  $('#btn-sync-now').addEventListener('click', () =>
    Sync.syncNow().then(() => { renderView(); toast('同步完成'); }).catch(() => {}));
  $('#btn-sync-off').addEventListener('click', () => {
    if (!confirm('確定停止雲端同步？資料仍會保留在這台裝置上。')) return;
    Sync.disconnect();
    renderSync();
    toast('已停止同步');
  });
  Sync.onStatus(renderSyncStatus);
  Sync.onRemoteChange = () => { renderView(); toast('已從雲端更新資料'); };
  onDataChange(() => Sync.schedule());

  // 備份
  $('#btn-export-json').addEventListener('click', exportJSON);
  $('#btn-export-csv').addEventListener('click', exportCSV);
  $('#import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-clear').addEventListener('click', clearAll);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentView === 'home') drawChart(); }, 150);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawChart);

  pickDefaultChartMetric();
  $('#f-type').value = 'weight';
  $('#f-time').value = toLocalInput(new Date());
  renderFields('weight');

  // 從通知點「已服用」開啟 App 時
  const params = new URLSearchParams(location.search);
  const initialView = location.hash === '#meds' ? 'meds' : 'home';
  showView(initialView);
  if (params.get('take')) {
    takeFromNotification(params.get('take'));
    history.replaceState(null, '', location.pathname + location.hash);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 註冊失敗', e));
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'take-dose') takeFromNotification(e.data.doseId);
      if (e.data?.type === 'open-meds') showView('meds');
    });
  }

  // 服藥提醒：每 30 秒檢查一次；回到 App 時立即檢查並同步
  checkReminders(onInAppReminder);
  setInterval(() => checkReminders(onInAppReminder), 30e3);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    checkReminders(onInAppReminder);
    if (currentView === 'home' || currentView === 'meds') renderView();
    Sync.schedule(0);
  });
  window.addEventListener('online', () => Sync.schedule(0));

  if (Sync.enabled) Sync.schedule(0);
  renderSyncStatus();
}

document.addEventListener('DOMContentLoaded', init);
