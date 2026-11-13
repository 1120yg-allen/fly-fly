'use strict';

/* ---------- 健康建議：每月回顧 ----------
 * 依據成員的紀錄（體重、血壓、血糖、睡眠、運動、步數、飲水、心情、服藥）與最新檢驗報告，
 * 套用台灣與美國的公開健康指引，產生飲食、睡眠、運動與追蹤建議。
 * 全部在裝置上計算，不會上傳資料。建議屬一般性衛教，不能取代醫師或營養師的個別評估。
 */
const ADVICE_SOURCES = {
  TW_DIET: { region: '台灣', name: '衛福部國民健康署《每日飲食指南》與「我的餐盤」' },
  TW_PA: { region: '台灣', name: '國民健康署 成人身體活動建議' },
  TW_HTN: { region: '台灣', name: '台灣高血壓學會 2022 高血壓治療指引（S-ABCDE、722 量血壓）' },
  TW_BMI: { region: '台灣', name: '國民健康署 成人體重分級（BMI 18.5–24）' },
  TW_WATER: { region: '台灣', name: '國民健康署 飲水建議（體重 × 30 毫升）' },
  TW_SLEEP: { region: '台灣', name: '台灣睡眠醫學學會' },
  TW_KIDNEY: { region: '台灣', name: '台灣腎臟醫學會 護腎衛教' },
  TW_SCREEN: { region: '台灣', name: '國民健康署 成人預防保健與癌症篩檢' },
  TW_MENTAL: { region: '台灣', name: '衛福部 安心專線 1925' },
  US_DGA: { region: '美國', name: '美國飲食指南（Dietary Guidelines for Americans）' },
  US_DASH: { region: '美國', name: '美國 NHLBI 得舒飲食（DASH）' },
  US_AHA: { region: '美國', name: '美國心臟協會（AHA）飲食與生活建議' },
  US_ADA: { region: '美國', name: '美國糖尿病學會（ADA）照護標準' },
  US_ACR: { region: '美國', name: '美國風濕病學會（ACR）痛風指引' },
  US_AASLD: { region: '美國', name: '美國肝病研究學會（AASLD）脂肪肝指引' },
  US_PAG: { region: '美國', name: '美國身體活動指南 第二版（Physical Activity Guidelines）' },
  US_SLEEP: { region: '美國', name: '美國睡眠醫學會（AASM）與 CDC 睡眠建議' },
};

const AREA_LABEL = { diet: '飲食', sleep: '睡眠', exercise: '運動', followup: '追蹤' };
const AREA_ICON = { diet: '🥗', sleep: '😴', exercise: '🏃', followup: '📅' };
const LEVEL_RANK = { warn: 0, info: 1, ok: 2 };

const avgOf = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const round1 = (n) => Math.round(n * 10) / 10;
const fmt0 = (n) => Math.round(n).toLocaleString('zh-TW');

/** 某個月的統計（目前月份只計算到今天） */
function monthStats(entries, y, m, now = new Date()) {
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  const effEnd = end > now ? now : end;
  const days = Math.max(1, Math.ceil((effEnd - start) / 864e5));
  const list = entries.filter((e) => { const t = new Date(e.time); return t >= start && t < end; });
  const of = (type) => list.filter((e) => e.type === type);
  const nums = (type, key) => of(type).map((e) => Number(e.values[key])).filter(Number.isFinite);
  const dailySum = (type, key) => {
    const map = new Map();
    for (const e of of(type)) {
      const k = e.time.slice(0, 10);
      map.set(k, (map.get(k) || 0) + (Number(e.values[key]) || 0));
    }
    return [...map.values()];
  };
  const bp = of('bp').filter((e) => Number.isFinite(e.values.sys) && Number.isFinite(e.values.dia));
  const weights = of('weight').sort((a, b) => new Date(a.time) - new Date(b.time)).map((e) => Number(e.values.weight)).filter(Number.isFinite);
  const fasting = of('glucose').filter((e) => e.values.context === 'fasting' || e.values.context === 'before').map((e) => Number(e.values.value)).filter(Number.isFinite);
  const exercise = nums('exercise', 'minutes');
  const steps = dailySum('steps', 'steps');
  const water = dailySum('water', 'ml');
  return {
    days, start, end,
    recordedDays: new Set(list.filter((e) => e.type !== 'lab').map((e) => e.time.slice(0, 10))).size,
    weight: avgOf(weights), weightFirst: weights[0] ?? null, weightLast: weights[weights.length - 1] ?? null,
    bpCount: bp.length,
    sys: avgOf(bp.map((e) => e.values.sys)), dia: avgOf(bp.map((e) => e.values.dia)),
    bpHigh: bp.filter((e) => e.values.sys >= 130 || e.values.dia >= 80).length,
    heart: avgOf(nums('heart', 'bpm')),
    fasting: avgOf(fasting), fastingCount: fasting.length,
    sleep: avgOf(nums('sleep', 'hours')), sleepNights: of('sleep').length,
    sleepQuality: avgOf(nums('sleep', 'quality')),
    exerciseTotal: exercise.reduce((a, b) => a + b, 0), exerciseCount: exercise.length,
    exerciseWeekly: (exercise.reduce((a, b) => a + b, 0) * 7) / days,
    strengthDays: new Set(of('exercise').filter((e) => /重訓|肌力|重量|啞鈴|彈力|深蹲|伏地挺身|core|strength|weight/i.test(e.values.kind || '')).map((e) => e.time.slice(0, 10))).size,
    steps: avgOf(steps), stepsDays: steps.length,
    water: avgOf(water), waterDays: water.length, waterValues: water,
    mood: avgOf(nums('mood', 'score')), moodCount: of('mood').length,
    fever: nums('temp', 'celsius').filter((c) => c >= 38).length,
  };
}

function ageOf(profile, now) {
  const by = Number(profile.birthYear);
  return by > 1900 && by <= now.getFullYear() ? now.getFullYear() - by : null;
}

/**
 * 產生某月份的建議。
 * input: { profile, entries（健康紀錄）, labLatest（{ key: { value, time } }）, adherence（{ due, taken }）, year, month, now }
 */
function buildAdvice({ profile, entries, labLatest = {}, adherence = null, year, month, now = new Date() }) {
  const s = monthStats(entries, year, month, now);
  // 目前月份稱「本月」，過去月份稱「9 月」
  const M = year === now.getFullYear() && month === now.getMonth() ? '本月' : `${month + 1} 月`;
  const sex = profile.sex;
  const age = ageOf(profile, now);
  const lab = (key) => labLatest[key] && LAB_ITEMS[key] ? { ...labLatest[key], item: LAB_ITEMS[key], st: evalLab(LAB_ITEMS[key], labLatest[key].value, sex) } : null;
  const labWarn = (key) => lab(key)?.st?.level === 'warn' ? lab(key) : null;
  const labDir = (key, dir) => { const l = labWarn(key); return l && (!dir || l.st.dir === dir) ? l : null; };
  const labText = (l) => `${l.item.code} ${typeof l.value === 'number' ? l.value : l.value}${l.item.unit && l.item.kind !== 'qual' ? ' ' + l.item.unit : ''}（${l.st.text}）`;

  // 最近一次體重（本月沒有時用全部紀錄中的最新值）
  const latestWeight = s.weightLast ?? [...entries].filter((e) => e.type === 'weight').sort((a, b) => new Date(b.time) - new Date(a.time))[0]?.values.weight ?? null;
  const height = Number(profile.height) || null;
  const bmi = height && latestWeight ? latestWeight / ((height / 100) ** 2) : null;

  const out = [];
  const add = (f) => out.push(f);

  /* ---------- 飲食 ---------- */
  const bpLab = labDir('SBP') || labDir('DBP');
  const bpHigh = (s.bpCount >= 1 && (s.sys >= 130 || s.dia >= 80)) || bpLab;
  if (bpHigh) {
    const detail = s.bpCount
      ? `${M}平均血壓 ${fmt0(s.sys)}/${fmt0(s.dia)} mmHg（量測 ${s.bpCount} 次，其中 ${s.bpHigh} 次 ≥ 130/80）。`
      : `檢驗報告血壓 ${[labWarn('SBP'), labWarn('DBP')].filter(Boolean).map(labText).join('、')}。`;
    const severe = (s.bpCount && (s.sys >= 140 || s.dia >= 90)) || [lab('SBP'), lab('DBP')].some((l) => l && labNumber(l.value) >= (l.item.key === 'SBP' ? 140 : 90));
    add({
      id: 'bp', area: 'diet', level: 'warn', title: '血壓偏高：減鹽與得舒飲食', detail,
      actions: [
        '每日鈉攝取：台灣建議少於 2,400 毫克（約鹽 6 公克），美國建議少於 2,300 毫克。少用醬料，少吃醃漬與加工食品，外食的湯汁不要喝完。',
        '採用得舒飲食（DASH）：多蔬菜水果、全穀、低脂乳品、堅果與豆類，減少紅肉、甜食與含糖飲料。',
        '台灣高血壓學會「S-ABCDE」：減鹽（S）、限酒（A）、控制體重（B）、戒菸（C）、得舒飲食（D）、規律運動（E）。',
        `用「722」原則在家量血壓：連續 7 天、早晚各 1 回、每回量 2 次取平均${s.bpCount < 7 ? `（${M}目前只量了 ${s.bpCount} 次）` : ''}。`,
        ...(severe ? ['平均已達 140/90 mmHg 以上，請與醫師討論是否需要藥物治療。'] : []),
      ],
      sources: ['TW_HTN', 'US_DASH', 'US_DGA'],
    });
  }

  const ldl = labDir('LDL') || labDir('TCHO');
  if (ldl) {
    add({
      id: 'ldl', area: 'diet', level: 'warn', title: '膽固醇偏高：減少飽和脂肪', detail: `最近檢驗 ${[labWarn('TCHO'), labWarn('LDL')].filter(Boolean).map(labText).join('、')}。`,
      actions: [
        '飽和脂肪少於每日總熱量的 10%：少吃肥肉、動物皮、內臟、奶油、椰子油與油炸食物，避免反式脂肪（酥油、部分糕餅）。',
        '用植物油、堅果、深海魚（鮭魚、鯖魚）取代動物性油脂，每週吃魚至少 2 次。',
        '增加膳食纖維：蔬菜每天至少 3 份、水果 2 份，主食至少 1/3 選擇未精製的全穀雜糧（糙米、燕麥、地瓜、豆類）。',
      ],
      sources: ['US_AHA', 'US_DGA', 'TW_DIET'],
    });
  }
  const hdl = labDir('HDL', 'low');
  if (hdl) {
    add({
      id: 'hdl', area: 'diet', level: 'warn', title: '好的膽固醇偏低', detail: `最近檢驗 ${labText(hdl)}。`,
      actions: [
        '規律有氧運動是提升 HDL 最有效的方法之一（見運動建議）。',
        '吸菸會降低 HDL，戒菸可以改善；過重者減重也有幫助。',
        '以不飽和脂肪（橄欖油、苦茶油、堅果、酪梨）取代精緻澱粉與甜食。',
      ],
      sources: ['US_AHA'],
    });
  }
  const tg = labDir('TG', 'high');
  if (tg) {
    add({
      id: 'tg', area: 'diet', level: 'warn', title: '三酸甘油酯偏高：少糖、少酒', detail: `最近檢驗 ${labText(tg)}。`,
      actions: [
        '減少含糖飲料、甜點與精緻澱粉（白麵包、蛋糕、白飯吃太多），添加糖少於每日總熱量的 10%。',
        '限制飲酒，三酸甘油酯明顯偏高時最好避免喝酒。',
        '每週吃 2 次以上富含 omega-3 的魚類，並控制體重。',
      ],
      sources: ['US_AHA', 'US_DGA', 'TW_DIET'],
    });
  }

  const gluLab = [labDir('GLU_AC', 'high'), labDir('HBA1C', 'high'), labDir('GLU_PC', 'high')].filter(Boolean);
  const homeHigh = s.fastingCount >= 2 && s.fasting >= 100;
  if (gluLab.length || homeHigh) {
    const diabetic = (lab('HBA1C') && labNumber(lab('HBA1C').value) >= 6.5) || (lab('GLU_AC') && labNumber(lab('GLU_AC').value) >= 126) || (homeHigh && s.fasting >= 126);
    add({
      id: 'glucose', area: 'diet', level: 'warn', title: '血糖偏高：調整醣類與飲料',
      detail: [gluLab.length ? `最近檢驗 ${gluLab.map(labText).join('、')}。` : '', homeHigh ? `${M}居家空腹／餐前血糖平均 ${fmt0(s.fasting)} mg/dL（${s.fastingCount} 次）。` : ''].join(''),
      actions: [
        '主食定量，至少 1/3 選擇全穀雜糧（糙米、燕麥、五穀飯），減少白飯、白麵、麵包等精緻澱粉。',
        '避免含糖飲料、果汁與甜點；想喝飲料時選無糖茶或白開水。',
        '每餐先吃蔬菜與蛋白質，再吃澱粉，有助於減緩餐後血糖上升。',
        '美國糖尿病學會建議：糖尿病前期者減重 5–7% 並每週運動 150 分鐘，可明顯降低變成糖尿病的風險。',
        ...(diabetic ? ['數值已達糖尿病診斷標準（HbA1c ≥ 6.5% 或空腹血糖 ≥ 126），請盡快就醫確認並討論治療。'] : []),
      ],
      sources: ['US_ADA', 'TW_DIET'],
    });
  }

  const ua = labDir('UA', 'high');
  if (ua) {
    add({
      id: 'ua', area: 'diet', level: 'warn', title: '尿酸偏高：減少高普林食物', detail: `最近檢驗 ${labText(ua)}。`,
      actions: [
        '少吃內臟、貝類與部分海鮮（如沙丁魚、干貝）、濃肉湯與火鍋湯底。',
        '限制飲酒，尤其是啤酒；少喝含糖飲料與果汁（果糖會使尿酸上升）。',
        '多喝水，維持體重；低脂乳品可作為蛋白質來源。',
      ],
      sources: ['US_ACR', 'TW_DIET'],
    });
  }

  const liver = [labDir('ALT', 'high'), labDir('AST', 'high'), labDir('GGT', 'high')].filter(Boolean);
  if (liver.length) {
    add({
      id: 'liver', area: 'diet', level: 'warn', title: '肝功能指數偏高：留意脂肪肝', detail: `最近檢驗 ${liver.map(labText).join('、')}。`,
      actions: [
        ...(bmi && bmi >= 24 ? ['體重過重時，減重 7–10% 可以明顯改善脂肪肝。'] : []),
        '減少或避免飲酒；少喝含糖飲料、少吃甜食與油炸食物。',
        '不要自行服用來源不明的藥物、草藥或保健食品。',
        'B 型或 C 型肝炎帶原者，請依醫師建議定期追蹤肝功能與腹部超音波。',
      ],
      sources: ['US_AASLD', 'TW_DIET'],
    });
  }

  if (bmi && bmi >= 24) {
    add({
      id: 'bmi', area: 'diet', level: bmi >= 27 ? 'warn' : 'info', title: bmi >= 27 ? '體重：BMI 達肥胖範圍' : '體重：BMI 過重',
      detail: `目前 BMI ${round1(bmi)}（台灣標準 18.5–24 為正常，24–27 過重，27 以上肥胖）。${s.weightFirst != null && s.weightLast != null && s.weightFirst !== s.weightLast ? `${M}體重 ${round1(s.weightFirst)} → ${round1(s.weightLast)} kg。` : ''}`,
      actions: [
        `先以 3–6 個月減重 5–10% 為目標（約 ${round1(latestWeight * 0.05)}–${round1(latestWeight * 0.1)} kg），每週減 0.5–1 kg 較容易維持。`,
        '每天少吃約 500 大卡：少喝含糖飲料、少吃油炸與零食，用「我的餐盤」控制份量。',
        '搭配每週 150–300 分鐘中等強度運動，效果比只控制飲食更好。',
      ],
      sources: ['TW_BMI', 'TW_DIET', 'US_DGA'],
    });
  } else if (bmi && bmi < 18.5) {
    add({
      id: 'bmi-low', area: 'diet', level: 'info', title: '體重過輕：確保熱量與蛋白質足夠', detail: `目前 BMI ${round1(bmi)}，低於 18.5。`,
      actions: [
        '三餐定時，每餐都有豆魚蛋肉類（約一掌心）與全穀雜糧。',
        '每天 1.5–2 杯乳品，可在兩餐之間加一份點心（如堅果、優格）。',
        '若體重持續下降或沒有原因地變瘦，請就醫檢查。',
      ],
      sources: ['TW_DIET', 'TW_BMI'],
    });
  }

  const anemia = [labDir('HGB', 'low'), labDir('FERRITIN', 'low'), labDir('IRON', 'low')].filter(Boolean);
  if (anemia.length) {
    add({
      id: 'iron', area: 'diet', level: 'warn', title: '可能貧血或缺鐵', detail: `最近檢驗 ${anemia.map(labText).join('、')}。`,
      actions: [
        '多吃含鐵食物：紅肉、文蛤、蛋黃、深綠色蔬菜（菠菜、地瓜葉）、豆類。',
        '搭配富含維生素 C 的水果（芭樂、柑橘、奇異果）幫助鐵吸收；茶與咖啡和正餐間隔 1 小時以上。',
        '貧血原因很多（如月經量多、腸胃出血），請與醫師討論，不要自行長期補鐵。',
      ],
      sources: ['TW_DIET'],
    });
  }

  const vitd = labWarn('VITD');
  if (vitd && labNumber(vitd.value) < 25) {
    add({
      id: 'vitd', area: 'diet', level: 'warn', title: '維生素 D 不足', detail: `最近檢驗 ${labText(vitd)}。`,
      actions: [
        '適度曬太陽：每天約 10–20 分鐘讓手臂、腿部照到陽光（避開正午強烈日照）。',
        '多吃鮭魚、鯖魚、蛋黃、經日曬的菇類與強化維生素 D 的乳品。',
        '是否需要補充劑與劑量，請與醫師討論。',
      ],
      sources: ['TW_DIET'],
    });
  }

  const kidney = [labDir('CRE', 'high'), labDir('BUN', 'high'), labWarn('U_PRO'), labWarn('U_ACR'), labWarn('U_MALB')].filter(Boolean);
  if (kidney.length) {
    add({
      id: 'kidney', area: 'diet', level: 'warn', title: '腎功能需要留意', detail: `最近檢驗 ${kidney.map(labText).join('、')}。`,
      actions: [
        '減少鹽分與加工食品，並控制好血壓與血糖，這是保護腎臟最重要的兩件事。',
        '不要自行長期服用止痛藥（如非類固醇消炎藥）、來源不明的草藥或偏方。',
        '蛋白質要吃多少因人而異，請依醫師或營養師的評估調整，不要自行大幅增減。',
      ],
      sources: ['TW_KIDNEY'],
    });
  }

  if (s.waterDays >= 3) {
    const goal = Number(profile.waterGoal) || (latestWeight ? Math.round(latestWeight * 30) : 2000);
    const metDays = s.waterValues.filter((v) => v >= goal).length;
    if (metDays / s.waterDays < 0.5) {
      add({
        id: 'water', area: 'diet', level: 'info', title: '喝水量偏少',
        detail: `${M}有紀錄的 ${s.waterDays} 天中，${metDays} 天達到目標 ${fmt0(goal)} ml（平均 ${fmt0(s.water)} ml）。`,
        actions: [
          `國健署建議每日飲水量約為體重（公斤）× 30 毫升${latestWeight ? `，以你的體重約 ${fmt0(latestWeight * 30)} ml` : ''}。`,
          '以白開水為主，少喝含糖飲料；把水杯放在看得到的地方，分次慢慢喝。',
          '心臟或腎臟疾病需要限水的人，請依醫師指示。',
        ],
        sources: ['TW_WATER'],
      });
    }
  }

  if (!out.some((f) => f.area === 'diet' && f.level === 'warn')) {
    add({
      id: 'diet-base', area: 'diet', level: 'ok', title: '均衡飲食：我的餐盤',
      detail: '目前沒有需要特別調整的飲食指標，維持均衡飲食即可。',
      actions: [
        '「我的餐盤」六口訣：每天早晚一杯奶、每餐水果拳頭大、菜比水果多一點、飯跟蔬菜一樣多、豆魚蛋肉一掌心、堅果種子一茶匙。',
        '添加糖少於每日總熱量 10%（台灣與美國建議相同），飽和脂肪少於 10%。',
        '鈉：台灣建議每日少於 2,400 毫克，美國建議少於 2,300 毫克。',
      ],
      sources: ['TW_DIET', 'US_DGA'],
    });
  }

  /* ---------- 睡眠 ---------- */
  const sleepRange = age != null && age >= 65 ? [7, 8] : [7, 9];
  const sleepRangeText = age != null && age >= 65 ? '65 歲以上建議每晚 7–8 小時' : '成人建議每晚至少 7 小時（約 7–9 小時）';
  const hygiene = [
    '固定起床時間（週末也一樣），白天多曬太陽、規律運動。',
    '睡前 1 小時減少手機、電腦等螢幕；下午之後避免咖啡、濃茶與能量飲料。',
    '晚餐不要太晚或太飽，睡前避免喝酒；臥室保持暗、安靜、涼爽。',
  ];
  if (s.sleepNights >= 3) {
    if (s.sleep < sleepRange[0]) {
      add({
        id: 'sleep-short', area: 'sleep', level: 'warn', title: '睡眠時間不足',
        detail: `${M} ${s.sleepNights} 晚的平均睡眠 ${round1(s.sleep)} 小時，${sleepRangeText}。`,
        actions: [...hygiene, '長期睡不夠會增加肥胖、高血壓、糖尿病與憂鬱的風險，優先把上床時間提早 30 分鐘開始。'],
        sources: ['US_SLEEP', 'TW_SLEEP'],
      });
    } else if (s.sleep > sleepRange[1] + 1) {
      add({
        id: 'sleep-long', area: 'sleep', level: 'info', title: '睡眠時間偏長',
        detail: `${M}平均睡眠 ${round1(s.sleep)} 小時，${sleepRangeText}。`,
        actions: ['如果睡很久仍白天疲倦、打鼾或被說睡覺時會停止呼吸，建議就醫評估睡眠呼吸中止症、甲狀腺或情緒問題。', '維持固定的起床時間，避免白天補眠超過 30 分鐘。'],
        sources: ['US_SLEEP', 'TW_SLEEP'],
      });
    } else {
      add({
        id: 'sleep-ok', area: 'sleep', level: 'ok', title: '睡眠時間達標',
        detail: `${M}平均睡眠 ${round1(s.sleep)} 小時，符合建議（${sleepRangeText}）。`,
        actions: ['繼續維持固定的作息時間。'], sources: ['US_SLEEP'],
      });
    }
    if (s.sleepQuality != null && s.sleepQuality <= 2.5) {
      add({
        id: 'sleep-quality', area: 'sleep', level: 'warn', title: '睡眠品質不佳',
        detail: `${M}睡眠品質平均 ${round1(s.sleepQuality)} 顆星（滿分 5）。`,
        actions: [...hygiene, '失眠持續超過 3 個月且影響白天生活，建議就醫；失眠認知行為治療（CBT-I）是美國睡眠醫學會建議的第一線治療。'],
        sources: ['US_SLEEP', 'TW_SLEEP'],
      });
    }
  } else {
    add({
      id: 'sleep-base', area: 'sleep', level: 'info', title: '記錄睡眠，掌握作息',
      detail: `${M}睡眠紀錄${s.sleepNights ? `只有 ${s.sleepNights} 晚` : '還沒有資料'}。${sleepRangeText}。`,
      actions: ['在「新增 → 睡眠」記錄每晚的時數與品質，下個月就能看到分析。', ...hygiene.slice(0, 2)],
      sources: ['US_SLEEP', 'TW_SLEEP'],
    });
  }

  /* ---------- 運動 ---------- */
  const strength = age != null && age >= 65
    ? '每週至少 2 天肌力訓練（深蹲、彈力帶、提重物），並加入平衡訓練（單腳站、太極）預防跌倒。'
    : '每週至少 2 天肌力訓練，練到主要大肌群（腿、臀、背、胸、肩、手臂）。';
  const safety = '有心臟病、胸痛、頭暈，或血壓、血糖控制不佳的人，開始新的運動前請先詢問醫師。';
  if (s.exerciseCount > 0) {
    const weekly = Math.round(s.exerciseWeekly);
    const basis = s.days < 28 ? `（依${M}前 ${s.days} 天推算）` : '';
    if (weekly < 150) {
      add({
        id: 'exercise-low', area: 'exercise', level: 'warn', title: '運動量未達每週 150 分鐘',
        detail: `${M}平均每週運動約 ${weekly} 分鐘${basis}。`,
        actions: [
          '台灣與美國都建議：每週至少 150 分鐘中等強度運動（快走、騎單車、游泳，會喘但還能說話），或 75 分鐘費力運動（跑步、跳繩）。',
          `目前每週還差約 ${150 - weekly} 分鐘，可以分次累積，例如每天快走 30 分鐘、每週 5 天。`,
          strength,
          ...(bmi && bmi >= 24 || gluLab.length || bpHigh ? ['規律運動對你的體重、血壓、血糖都有直接幫助。'] : []),
          safety,
        ],
        sources: ['TW_PA', 'US_PAG'],
      });
    } else {
      add({
        id: 'exercise-ok', area: 'exercise', level: 'ok', title: '有氧運動達標',
        detail: `${M}平均每週運動約 ${weekly} 分鐘${basis}，已達 150 分鐘的建議。`,
        actions: [
          '每週 300 分鐘以上中等強度運動可帶來更多健康益處。',
          s.strengthDays >= 2 ? `${M}有肌力訓練紀錄，很好，繼續保持每週至少 2 天。` : strength,
        ],
        sources: ['US_PAG', 'TW_PA'],
      });
    }
  } else {
    add({
      id: 'exercise-base', area: 'exercise', level: 'info', title: '開始記錄運動',
      detail: `${M}還沒有運動紀錄。`,
      actions: [
        '每週至少 150 分鐘中等強度運動，或 75 分鐘費力運動，可分次累積。',
        strength,
        '在「新增 → 運動」記錄時間與項目（例如快走、重訓），下個月就能看到是否達標。',
        safety,
      ],
      sources: ['TW_PA', 'US_PAG'],
    });
  }
  if (s.stepsDays >= 3 && s.steps < 5000) {
    add({
      id: 'steps', area: 'exercise', level: 'info', title: '日常活動量偏低',
      detail: `${M}平均每天 ${fmt0(s.steps)} 步（${s.stepsDays} 天紀錄），每天少於 5,000 步通常代表久坐。`,
      actions: ['每坐 1 小時起來走動 3–5 分鐘。', '多走樓梯、提早一站下車、飯後散步 10–15 分鐘。'],
      sources: ['US_PAG'],
    });
  }

  /* ---------- 追蹤 ---------- */
  const labWarnings = Object.keys(labLatest).map(lab).filter((l) => l && l.st?.level === 'warn');
  const latestLabTime = Object.values(labLatest).map((v) => new Date(v.time)).sort((a, b) => b - a)[0] || null;
  if (labWarnings.length) {
    add({
      id: 'lab-followup', area: 'followup', level: 'warn', title: `檢驗結果有 ${labWarnings.length} 項需要追蹤`,
      detail: labWarnings.slice(0, 8).map(labText).join('、') + (labWarnings.length > 8 ? ` 等 ${labWarnings.length} 項` : '') + '。',
      actions: [
        '帶著報告與醫師討論這些數值的意義，以及是否需要、何時需要複檢。',
        '複檢後到「檢驗」拍照上傳，App 會顯示前後變化。',
      ],
      sources: [],
    });
  }
  if (!latestLabTime || now - latestLabTime > 365 * 864e5) {
    const eligibility = age == null ? '在「設定 → 家庭成員」填寫出生年，可以看到適用的公費檢查。'
      : age >= 65 ? '65 歲以上每年可做 1 次公費成人健康檢查。'
      : age >= 40 ? '40–64 歲每 3 年可做 1 次公費成人健康檢查。'
      : age >= 30 ? '30–39 歲每 5 年可做 1 次公費成人健康檢查。' : '';
    add({
      id: 'checkup', area: 'followup', level: 'info', title: latestLabTime ? '距離上次檢驗已超過 1 年' : '還沒有檢驗報告',
      detail: latestLabTime ? `上次檢驗是 ${latestLabTime.getFullYear()}/${latestLabTime.getMonth() + 1}/${latestLabTime.getDate()}。` : '定期健康檢查可以及早發現血壓、血糖、血脂與肝腎功能的變化。',
      actions: [eligibility, '做完檢查後到「檢驗」拍照，App 會自動整理並在每月回顧中追蹤。'].filter(Boolean),
      sources: ['TW_SCREEN'],
    });
  }
  if (age != null && profile.sex) {
    const items = [];
    if (profile.sex === 'F' && age >= 30) items.push('子宮頸抹片：30 歲以上婦女每 3 年 1 次。');
    if (profile.sex === 'F' && age >= 40 && age <= 74) items.push('乳房 X 光攝影：40–74 歲婦女每 2 年 1 次。');
    if (age >= 45 && age <= 74) items.push('糞便潛血檢查（大腸癌）：45–74 歲每 2 年 1 次。');
    if (age >= 30) items.push('口腔黏膜檢查：30 歲以上有吸菸或嚼檳榔習慣者，每 2 年 1 次。');
    if (age <= 74 && (age >= 50 || (profile.sex === 'F' && age >= 45))) items.push(`低劑量電腦斷層（肺癌）：有肺癌家族史（男性 50–74 歲、女性 45–74 歲），或 50–74 歲重度吸菸者（30 包年以上），可符合公費資格。`);
    if (items.length) {
      add({
        id: 'screening', area: 'followup', level: 'info', title: '依年齡可接受的公費癌症篩檢', detail: `${age} 歲${profile.sex === 'F' ? '女性' : '男性'}適用：`,
        actions: [...items, '實際資格以國民健康署最新公告為準，可詢問家醫科或衛生所。'],
        sources: ['TW_SCREEN'],
      });
    }
  }
  if (adherence && adherence.due >= 5) {
    const rate = adherence.taken / adherence.due;
    if (rate < 0.8) {
      add({
        id: 'meds', area: 'followup', level: 'warn', title: `${M}服藥率 ${Math.round(rate * 100)}%`,
        detail: `${M}應服 ${adherence.due} 次，記錄已服用 ${adherence.taken} 次。`,
        actions: ['在「服藥」開啟通知，或匯出到手機行事曆，讓系統提醒。', '若因副作用或其他原因不想吃藥，請與醫師或藥師討論，不要自行停藥。'],
        sources: [],
      });
    }
  }
  if (s.moodCount >= 3 && s.mood <= 2.5) {
    add({
      id: 'mood', area: 'followup', level: 'warn', title: `${M}心情偏低落`,
      detail: `${M} ${s.moodCount} 次心情紀錄平均 ${round1(s.mood)} 分（滿分 5）。`,
      actions: [
        '規律作息、運動與曬太陽，都有助於改善情緒；和信任的家人朋友聊聊。',
        '如果情緒低落或對事物失去興趣持續 2 週以上，請尋求身心科或心理師協助。',
        '需要有人聊聊，可撥打衛福部安心專線 1925（24 小時免付費）。',
      ],
      sources: ['TW_MENTAL'],
    });
  }
  if (s.fever >= 2) {
    add({
      id: 'fever', area: 'followup', level: 'info', title: `${M}有 ${s.fever} 次發燒紀錄`, detail: '體溫 ≥ 38°C。',
      actions: ['持續發燒超過 3 天，或伴隨呼吸困難、意識改變，請盡快就醫。'], sources: [],
    });
  }
  if (s.days >= 14 && s.recordedDays < 4) {
    add({
      id: 'records', area: 'followup', level: 'info', title: `${M}紀錄較少`,
      detail: `${M} ${s.days} 天中只有 ${s.recordedDays} 天有紀錄，建議越多越能看出趨勢。`,
      actions: ['每週至少量 1 次體重；有高血壓風險者依 722 原則量血壓。', '睡眠與運動每天花 10 秒記錄即可。'],
      sources: [],
    });
  }

  out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  return { stats: s, bmi, findings: out };
}

/** 本月概況表：本月與上月的比較 */
function monthCompareRows(cur, prev) {
  const row = (label, a, b, fmt, unit, betterLow) => ({ label, cur: a, prev: b, fmt, unit, betterLow });
  const rows = [
    row('平均體重', cur.weight, prev.weight, round1, 'kg', true),
    row('平均血壓', cur.sys != null ? [cur.sys, cur.dia] : null, prev.sys != null ? [prev.sys, prev.dia] : null, (v) => `${fmt0(v[0])}/${fmt0(v[1])}`, 'mmHg', true),
    row('平均心率', cur.heart, prev.heart, fmt0, 'bpm', null),
    row('空腹血糖', cur.fasting, prev.fasting, fmt0, 'mg/dL', true),
    row('平均睡眠', cur.sleep, prev.sleep, round1, '小時', false),
    row('每週運動', cur.exerciseCount ? cur.exerciseWeekly : null, prev.exerciseCount ? prev.exerciseWeekly : null, fmt0, '分鐘', false),
    row('平均步數', cur.steps, prev.steps, fmt0, '步', false),
    row('平均飲水', cur.water, prev.water, fmt0, 'ml', false),
    row('平均心情', cur.mood, prev.mood, round1, '／5', false),
  ];
  return rows.filter((r) => r.cur != null || r.prev != null);
}

/** 匯出每月提醒到行事曆 */
function buildMonthlyICS(day, profileName) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  let first = new Date(now.getFullYear(), now.getMonth(), day);
  if (first < now) first = new Date(now.getFullYear(), now.getMonth() + 1, day);
  const start = `${first.getFullYear()}${pad(first.getMonth() + 1)}${pad(first.getDate())}T090000`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const summary = `📅 ${profileName ? profileName + '：' : ''}每月健康回顧`;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//health-tracker//advice//ZH', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:monthly-review-${day}-${encodeURIComponent(profileName || 'me')}@health-tracker`, `DTSTAMP:${stamp}`,
    `DTSTART:${start}`, 'DURATION:PT15M', `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
    `SUMMARY:${summary}`, 'DESCRIPTION:打開健康紀錄 App 的「建議」頁，查看本月的飲食、睡眠、運動建議與追蹤提醒。',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${summary}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
