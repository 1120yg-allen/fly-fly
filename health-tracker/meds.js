'use strict';

/* ---------- 服藥：排程、提醒、行事曆匯出 ---------- */
const WEEKDAYS = [[1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [0, '日']];
const REMIND_WINDOW_MS = 2 * 3600e3; // 超過預定時間 2 小時就不再跳通知

const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const doseId = (medId, date, time) => `${medId}@${date}T${time}`;
const slotDate = (date, time) => new Date(`${date}T${time}`);

/** 某位成員（或全部成員）在某一天的服藥時段 */
function doseSlots(date, profileId) {
  const day = slotDate(date, '00:00').getDay();
  const logs = new Map(live('doses').map((d) => [d.id, d]));
  const slots = [];
  for (const med of live('meds')) {
    if (profileId && med.profileId !== profileId) continue;
    if (med.active === false || !med.days.includes(day)) continue;
    if (med.startDate && date < med.startDate) continue;
    for (const time of med.times) {
      const id = doseId(med.id, date, time);
      slots.push({ id, med, date, time, log: logs.get(id) || null });
    }
  }
  return slots.sort((a, b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name));
}

function logDose(slot, status) {
  return upsert('doses', {
    id: slot.id, profileId: slot.med.profileId, medId: slot.med.id,
    date: slot.date, time: slot.time, status, at: Date.now(),
  });
}

function findSlot(id) {
  const m = /^(.+)@(\d{4}-\d\d-\d\d)T(\d\d:\d\d)$/.exec(id || '');
  if (!m) return null;
  return doseSlots(m[2]).find((s) => s.id === id) || null;
}

/** 近 N 天（不含尚未到的時段）的服藥率 */
function adherence(med, days = 7) {
  let due = 0, taken = 0;
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    for (const s of doseSlots(dateKey(d), med.profileId)) {
      if (s.med.id !== med.id || slotDate(s.date, s.time) > now) continue;
      due++;
      if (s.log?.status === 'taken') taken++;
    }
  }
  return { due, taken };
}

/* ---------- 提醒 ---------- */
function notificationsSupported() {
  return 'Notification' in window;
}

async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
}

async function showReminder(slot) {
  const profile = getById('profiles', slot.med.profileId);
  const title = `💊 ${live('profiles').length > 1 && profile ? profile.name + '：' : ''}該吃藥了`;
  const body = `${slot.time} ${slot.med.name}${slot.med.dose ? '　' + slot.med.dose : ''}`;
  if (notificationsSupported() && Notification.permission === 'granted') {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    const options = { body, tag: slot.id, icon: 'icon.svg', badge: 'icon.svg', requireInteraction: true, data: { doseId: slot.id } };
    if (reg) {
      await reg.showNotification(title, { ...options, actions: [{ action: 'take', title: '✓ 已服用' }] });
    } else {
      new Notification(title, options);
    }
  }
  return { title, body };
}

/** 每 30 秒檢查一次；每個時段只提醒一次（記在這台裝置上） */
function checkReminders(onInAppReminder) {
  const now = Date.now();
  const today = dateKey(new Date());
  // 只保留今天與昨天的已通知紀錄
  const y = new Date(); y.setDate(y.getDate() - 1);
  const keep = [today, dateKey(y)];
  local.notified = Object.fromEntries(Object.entries(local.notified || {}).filter(([id]) => keep.some((k) => id.includes(`@${k}T`))));

  const due = [y, new Date()].flatMap((d) => doseSlots(dateKey(d))).filter((s) => {
    const t = slotDate(s.date, s.time).getTime();
    return !s.log && t <= now && now - t < REMIND_WINDOW_MS && !local.notified[s.id];
  });
  for (const slot of due) {
    local.notified[slot.id] = now;
    showReminder(slot).then((msg) => onInAppReminder?.(slot, msg)).catch((e) => console.warn(e));
  }
  if (due.length) persistLocal();
}

/* ---------- 匯出到手機行事曆（.ics） ----------
 * 網頁在背景被關掉後無法自行跳通知；匯入行事曆後由手機系統負責提醒，最可靠。
 */
function buildICS(meds, profileName) {
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const byday = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' };
  const start = dateKey(new Date()).replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//health-tracker//meds//ZH', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc('服藥提醒' + (profileName ? ' - ' + profileName : ''))}`];
  for (const med of meds) {
    if (med.active === false || !med.days.length) continue;
    const rule = med.days.length === 7 ? 'FREQ=DAILY' : `FREQ=WEEKLY;BYDAY=${med.days.map((d) => byday[d]).join(',')}`;
    const from = med.startDate && med.startDate.replace(/-/g, '') > start ? med.startDate.replace(/-/g, '') : start;
    for (const time of med.times) {
      const summary = `💊 ${profileName ? profileName + '：' : ''}${med.name}${med.dose ? ' ' + med.dose : ''}`;
      lines.push('BEGIN:VEVENT',
        `UID:${med.id}-${time.replace(':', '')}@health-tracker`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${from}T${time.replace(':', '')}00`,
        'DURATION:PT10M',
        `RRULE:${rule}`,
        `SUMMARY:${esc(summary)}`,
        ...(med.note ? [`DESCRIPTION:${esc(med.note)}`] : []),
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:PT0M', 'END:VALARM',
        'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
