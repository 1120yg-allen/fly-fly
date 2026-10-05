'use strict';

/* ---------- 檢驗項目目錄 ----------
 * 每個分類：key、名稱、臨床意義（desc）、項目（items）。
 * 每個項目：
 *   key      內部代碼（存檔用，不可更改）
 *   code     報告上常見的英文縮寫
 *   name     中文名稱
 *   unit     單位
 *   range    參考值：[低, 高]（含）、{ lt } 小於、{ le } 小於等於、{ gt } 大於、
 *            { M: [...], F: [...] } 依性別；null 表示未提供參考值
 *   aliases  拍照辨識時用來比對的名稱（不分大小寫）
 *   desc     臨床意義
 *   kind     'qual' 定性（陰性/陽性）、'sco' 指數判讀、'tier' 分級、'text' 文字結果；預設為數值
 *   ctx      'urine' / 'stool'：同名項目（如紅血球）在尿液、糞便段落時才對應到此項
 * 參考值依各醫院檢驗方法可能略有不同，請以報告上的參考值為準。
 */
const LAB_CATEGORIES = [
  {
    key: 'physical', name: '一般理學檢查',
    desc: '身高、體重、血壓、視力及醫師問診。一般常規性檢查，瞭解個人視力是否正常、血壓是否偏高、有無辨色力異常，並透過醫師現場問診及身體檢查瞭解健康問題。',
    items: [
      { key: 'HEIGHT', code: 'Height', name: '身高', unit: 'cm', range: null, aliases: ['身高', 'height', 'body height'], desc: '用於計算身體質量指數（BMI），評估體位是否適中。' },
      { key: 'WEIGHT', code: 'Weight', name: '體重', unit: 'kg', range: null, aliases: ['體重', 'weight', 'body weight'], desc: '與身高一起計算 BMI；短期內明顯增減可能與飲食、水腫或疾病有關。' },
      { key: 'SBP', code: 'SBP', name: '收縮壓', unit: 'mmHg', range: { lt: 120 }, aliases: ['收縮壓', 'sbp', 'systolic'], desc: '心臟收縮時血管承受的壓力。長期偏高會增加中風、心臟病與腎臟病的風險。' },
      { key: 'DBP', code: 'DBP', name: '舒張壓', unit: 'mmHg', range: { lt: 80 }, aliases: ['舒張壓', 'dbp', 'diastolic'], desc: '心臟舒張時血管承受的壓力。與收縮壓一起判斷是否有高血壓。' },
      { key: 'VA_R', code: 'VA (R)', name: '右眼視力', unit: '', range: null, kind: 'text', aliases: ['右眼視力', '視力(右)', '視力 右', '右眼'], desc: '瞭解視力是否正常，是否需要矯正或進一步眼科檢查。' },
      { key: 'VA_L', code: 'VA (L)', name: '左眼視力', unit: '', range: null, kind: 'text', aliases: ['左眼視力', '視力(左)', '視力 左', '左眼'], desc: '瞭解視力是否正常，是否需要矯正或進一步眼科檢查。' },
      { key: 'COLOR_VISION', code: 'Color vision', name: '辨色力', unit: '', range: null, kind: 'text', aliases: ['辨色力', '色盲', 'color vision'], desc: '檢查有無辨色力異常（色盲、色弱）。' },
    ],
  },
  {
    key: 'cbc', name: '血液檢查',
    desc: '1. 發炎、疾病感染時，白血球（WBC）常呈升高現象。\n2. 貧血時，血色素（HGB）、紅血球（RBC）、血球比容（HCT）、MCH、MCHC 都可能呈低值。\n3. 血小板主要作用在於維持微血管的機能，在出血及凝血機轉中扮演重要的角色。\n4. 白血球分類、凝血功能與紅血球沉降速率可進一步協助判斷感染、過敏、血液疾病與出血傾向。',
    items: [
      { key: 'WBC', code: 'WBC', name: '白血球', unit: '10³/µL', range: [3.25, 9.16], aliases: ['wbc', '白血球', 'white blood cell', 'leukocyte', 'leukocytes'], desc: '身體對抗感染的細胞。發炎、感染時常升高；過低可能與病毒感染、骨髓功能或藥物有關。' },
      { key: 'RBC', code: 'RBC', name: '紅血球', unit: '10⁶/µL', range: { M: [4.21, 5.9], F: [3.78, 5.25] }, aliases: ['rbc', '紅血球', 'red blood cell', 'erythrocyte'], desc: '負責運送氧氣。偏低可能為貧血；偏高可能與脫水、缺氧或紅血球增多症有關。' },
      { key: 'HGB', code: 'Hb', name: '血色素', unit: 'g/dL', range: { M: [13.1, 17.2], F: [11.0, 15.2] }, aliases: ['hb', 'hgb', 'hemoglobin', 'haemoglobin', '血色素', '血紅素'], desc: '紅血球中攜帶氧氣的蛋白質，是判斷貧血最主要的指標。' },
      { key: 'HCT', code: 'Hct', name: '血球比容', unit: '%', range: { M: [39.6, 51.5], F: [34.8, 46.3] }, aliases: ['hct', 'hematocrit', '血比容', '血球比容', '血球比'], desc: '紅血球占血液體積的比例。貧血時偏低，脫水時可能偏高。' },
      { key: 'PLT', code: 'PLT', name: '血小板', unit: '10³/µL', range: [150, 378], aliases: ['plt', 'platelet', 'platelets', '血小板'], desc: '維持微血管機能，在出血及凝血中扮演重要角色。過低容易出血或瘀青，過高可能與發炎或骨髓疾病有關。' },
      { key: 'MCV', code: 'MCV', name: '平均血球容積', unit: 'fL', range: [80.9, 99.3], aliases: ['mcv', '平均血球容積', '平均紅血球容積'], desc: '紅血球的平均大小。偏小常見於缺鐵性貧血或海洋性貧血；偏大可能與維生素 B12、葉酸缺乏或飲酒有關。' },
      { key: 'MCH', code: 'MCH', name: '平均紅血球血紅素量', unit: 'pg', range: [25.5, 33.2], aliases: ['mch', '平均血球血紅素', '平均紅血球血紅素量', '平均血色素蛋白'], desc: '每個紅血球所含的血紅素量。貧血時可能偏低，協助判斷貧血類型。' },
      { key: 'MCHC', code: 'MCHC', name: '平均紅血球血紅素濃度', unit: 'g/dL', range: [31.0, 34.9], aliases: ['mchc', '平均血球血紅素濃度', '平均紅血球血紅素濃度'], desc: '紅血球內血紅素的濃度。偏低常見於缺鐵性貧血。' },
      { key: 'RDW', code: 'RDW-CV', name: '紅血球分佈寬度', unit: '%', range: [11.6, 15.0], aliases: ['rdw-cv', 'rdw', '紅血球分佈寬度', '紅血球分布寬度'], desc: '紅血球大小的差異程度。偏高表示大小不一，常見於缺鐵性貧血或混合型貧血。' },
      { key: 'RETIC', code: 'Retic', name: '網狀紅血球', unit: '%', range: { M: [1.05, 2.5], F: [0.87, 2.48] }, aliases: ['reticulocyte', 'retic', '網狀紅血球'], desc: '剛從骨髓釋出的年輕紅血球，反映骨髓製造紅血球的能力，可協助判斷貧血原因。' },
      { key: 'NEUT', code: 'Neut', name: '嗜中性球', unit: '%', range: [41.6, 74.4], aliases: ['neutrophils', 'neutrophil', 'neut', 'seg', 'segment', '嗜中性球', '嗜中性白血球'], desc: '最主要的白血球，對抗細菌感染。細菌感染時常升高。' },
      { key: 'LYMPH', code: 'Lym', name: '淋巴球', unit: '%', range: [18.0, 48.8], aliases: ['lymphocytes', 'lymphocyte', 'lymph', 'lym', '淋巴球'], desc: '負責免疫反應的白血球。病毒感染時常升高。' },
      { key: 'MONO', code: 'Mono', name: '單核球', unit: '%', range: [3.3, 8.9], aliases: ['monocytes', 'monocyte', 'mono', '單核球'], desc: '可吞噬病原體與壞死組織，慢性感染或發炎時可能升高。' },
      { key: 'EOS', code: 'Eos', name: '嗜酸性球', unit: '%', range: [0.3, 7.9], aliases: ['eosinophils', 'eosinophil', 'eos', 'eso', '嗜酸性球', '嗜酸性白血球'], desc: '過敏反應或寄生蟲感染時常升高。' },
      { key: 'BASO', code: 'Baso', name: '嗜鹼性球', unit: '%', range: [0.2, 1.6], aliases: ['basophils', 'basophil', 'baso', '嗜鹼性球', '嗜鹼性白血球'], desc: '與過敏反應有關，數量很少；明顯升高時需注意血液疾病。' },
      { key: 'ESR', code: 'ESR', name: '紅血球沉降速率', unit: 'mm/hr', range: { M: [2, 10], F: [2, 15] }, aliases: ['e.s.r.', 'esr', '紅血球沉澱速率', '紅血球沉降速率'], desc: '非特異性的發炎指標，感染、自體免疫疾病或腫瘤時可能升高。' },
      { key: 'PT', code: 'PT', name: '凝血酶原時間', unit: 'sec', range: [9.7, 11.8], aliases: ['prothrombin time', 'pt', '凝血酵素原時間', '凝血酶原時間'], desc: '評估外在凝血途徑。延長可能與肝病、維生素 K 缺乏或服用抗凝血劑有關。' },
      { key: 'INR', code: 'INR', name: '國際標準化比值', unit: '', range: [0.91, 1.10], aliases: ['inr'], desc: '將 PT 標準化後的數值，常用於監測抗凝血藥物（如 Warfarin）的效果。' },
      { key: 'APTT', code: 'aPTT', name: '活化部分凝血活酶時間', unit: 'sec', range: [25.6, 32.6], aliases: ['aptt', 'a-ptt', '活化部分凝血激素時間', '活化部分凝血活酶時間'], desc: '評估內在凝血途徑。延長可能與凝血因子缺乏（如血友病）或使用肝素有關。' },
    ],
  },
  {
    key: 'urine', name: '尿液檢查',
    desc: '尿是腎臟所分泌的排泄物，也是新陳代謝的最終產物。尿液檢查主要目的：\n1. 診斷與評估腎臟與泌尿道系統疾病。\n2. 診斷與評估是否有糖尿病及肝臟疾病。\n3. 檢查泌尿系統是否感染、發炎或結石。',
    items: [
      { key: 'U_APPEAR', code: 'Color', name: '外觀', unit: '', range: null, kind: 'text', ctx: 'urine', ref: 'Clear, yellow（清澈、黃色）', aliases: ['color-appearance', 'appearance', 'color', '外觀', '顏色'], desc: '尿液顏色與清澈度。混濁可能與感染、結晶有關；深茶色可能為脫水或膽紅素增加；紅色可能有血尿。' },
      { key: 'U_SG', code: 'SG', name: '比重', unit: '', range: [1.003, 1.035], ctx: 'urine', aliases: ['specific gravity', 'sp.gr', 's.g.', 'sg', '比重'], desc: '反映腎臟濃縮尿液的能力與身體水分狀態。偏高可能脫水，持續偏低可能腎臟濃縮功能不佳。' },
      { key: 'U_PH', code: 'pH', name: '酸鹼值', unit: '', range: [5.0, 8.0], ctx: 'urine', aliases: ['ph', '酸鹼值', '酸鹼度'], desc: '尿液酸鹼度，受飲食影響。持續過酸或過鹼可能與結石、泌尿道感染或代謝異常有關。' },
      { key: 'U_PRO', code: 'PRO', name: '尿蛋白', unit: '', range: null, kind: 'qual', normal: ['neg', 'trace'], ref: '(-) ~ (+/-)', ctx: 'urine', aliases: ['protein', 'pro', '尿蛋白', '蛋白'], desc: '正常尿中幾乎沒有蛋白質。陽性可能為腎臟疾病（如腎絲球受損、糖尿病腎病變），也可能因發燒、劇烈運動暫時出現。' },
      { key: 'U_GLU', code: 'GLU', name: '尿糖', unit: '', range: null, kind: 'qual', ref: '(-)', ctx: 'urine', aliases: ['glucose', 'glu', 'sugar', '尿糖', '葡萄糖'], desc: '血糖過高超過腎臟回收能力時，尿中會出現糖，常見於糖尿病。' },
      { key: 'U_BIL', code: 'BIL', name: '尿膽紅素', unit: '', range: null, kind: 'qual', ref: '(-)', ctx: 'urine', aliases: ['bilirubin', 'bil', '尿膽紅素', '膽紅素'], desc: '陽性可能與肝臟疾病或膽道阻塞有關。' },
      { key: 'U_URO', code: 'URO', name: '尿膽素原', unit: 'mg/dL', range: { le: 1.5 }, ctx: 'urine', aliases: ['urobilinogen', 'uro', 'ubg', '尿膽素原', '尿膽原'], desc: '偏高可能與肝臟疾病或溶血有關；完全沒有時需注意膽道阻塞。' },
      { key: 'U_KET', code: 'KET', name: '酮體', unit: '', range: null, kind: 'qual', ref: '(-)', ctx: 'urine', aliases: ['ketone', 'ketones', 'ket', '酮體'], desc: '身體以脂肪代替醣類產生能量時出現，常見於飢餓、劇烈減重、嘔吐，或糖尿病控制不佳（酮酸中毒）。' },
      { key: 'U_NIT', code: 'NIT', name: '亞硝酸鹽', unit: '', range: null, kind: 'qual', ref: '(-)', ctx: 'urine', aliases: ['nitrite', 'nit', '亞硝酸', '亞硝酸鹽', '硝酸鹽'], desc: '某些細菌會把尿中的硝酸鹽轉為亞硝酸鹽，陽性提示泌尿道細菌感染。' },
      { key: 'U_OB', code: 'OB', name: '尿潛血', unit: '', range: null, kind: 'qual', ref: '(-)', ctx: 'urine', aliases: ['occult blood', 'o.b.', 'ob', 'blood', '潛血', '尿潛血'], desc: '偵測尿中是否有血。陽性可能與泌尿道感染、結石、腎臟疾病有關，女性生理期也可能出現。' },
      { key: 'U_LEU', code: 'LEU', name: '白血球酯酶', unit: '', range: null, kind: 'qual', ref: '(-)', ctx: 'urine', aliases: ['wbc esterase', 'leukocyte esterase', 'leu', '白血球酯酶', '白血球脂酶'], desc: '陽性表示尿中有白血球，提示泌尿道感染或發炎。' },
      { key: 'U_ALB', code: 'ALB', name: '尿白蛋白（試紙）', unit: 'mg/L', range: { le: 10 }, ref: '10', ctx: 'urine', aliases: ['albumin', 'alb', '白蛋白'], desc: '早期腎臟受損時，尿中白蛋白會先增加，常用於糖尿病、高血壓患者的腎臟篩檢。' },
      { key: 'U_CRE', code: 'CRE', name: '尿肌酸酐（試紙）', unit: '', range: null, ctx: 'urine', ref: 'N/A', aliases: ['creatinine', 'cre', 'crea', '肌酸酐'], desc: '用來校正尿液濃度，與尿白蛋白一起計算白蛋白／肌酸酐比值。' },
      { key: 'U_ACR', code: 'ACR', name: '白蛋白／肌酸酐比值', unit: 'mg/g', range: { lt: 30 }, ctx: 'urine', aliases: ['albumin/creatinine ratio', 'albumin / creatinine ratio', 'acr', 'uacr', 'a/c ratio', '白蛋白對肌酸酐比值', '白蛋白/肌酸酐'], desc: '比單次尿白蛋白更準確的早期腎病指標。≥ 30 表示可能有微量白蛋白尿。' },
      { key: 'U_RBC', code: 'RBC', name: '尿沉渣紅血球', unit: '/HPF', range: [0, 2], rangeResult: true, ctx: 'urine', aliases: ['rbc', '紅血球', 'red blood cell'], desc: '顯微鏡下尿中的紅血球數。偏高表示血尿，可能與結石、感染、腎臟疾病或腫瘤有關。' },
      { key: 'U_WBC', code: 'WBC', name: '尿沉渣白血球', unit: '/HPF', range: [0, 5], rangeResult: true, ctx: 'urine', aliases: ['wbc', '白血球', 'white blood cell', 'pus cell'], desc: '顯微鏡下尿中的白血球數。偏高提示泌尿道感染或發炎。' },
      { key: 'U_EPI', code: 'Epith', name: '上皮細胞', unit: '/HPF', range: [0, 5], rangeResult: true, ctx: 'urine', ref: 'Squamous epithelial cells 0–5', aliases: ['squamous epithelial cells', 'epithelial cells', 'epithelial cell', 'epith cell', 'epith', '上皮細胞'], desc: '泌尿道表面脫落的細胞。數量多時可能為檢體受污染或泌尿道發炎。' },
      { key: 'U_CAST', code: 'Cast', name: '圓柱體', unit: '/LPF', range: [0, 2], rangeResult: true, ctx: 'urine', ref: 'Hyaline cast 0–2', aliases: ['hyaline cast', 'casts', 'cast', '圓柱體'], desc: '在腎小管中形成的蛋白質柱狀物。透明圓柱體少量可為正常，其他種類或數量增加提示腎臟疾病。' },
      { key: 'U_CRYSTAL', code: 'Crystal', name: '結晶體', unit: '/HPF', range: null, kind: 'qual', ref: '無異常結晶', ctx: 'urine', aliases: ['crystals', 'crystal', '結晶體', '結晶'], desc: '尿中礦物質形成的結晶。異常結晶可能與結石或代謝疾病有關。' },
      { key: 'U_BACT', code: 'Bacteria', name: '細菌', unit: '/HPF', range: null, kind: 'qual', ref: '(-)（新鮮檢體）', ctx: 'urine', aliases: ['bacteria', '細菌'], desc: '新鮮尿液中出現細菌，提示泌尿道感染，也可能是檢體受污染。' },
    ],
  },
  {
    key: 'urine24', name: '尿液特殊檢驗',
    desc: '收集 24 小時尿液，測定兒茶酚胺（多巴胺、腎上腺素、正腎上腺素）及其代謝物香草扁桃酸（VMA），用於評估嗜鉻細胞瘤等內分泌腫瘤或不明原因的高血壓。微蛋白尿則用於早期腎臟病變篩檢。參考值只適用 18 歲以上。',
    items: [
      { key: 'U_MALB', code: 'Micro-ALB', name: '微蛋白尿', unit: 'mg/L', range: { lt: 30 }, aliases: ['micro-albumin', 'microalbumin', 'micro albumin', '微蛋白尿', '微白蛋白'], desc: '尿中微量白蛋白，是糖尿病、高血壓腎病變的早期指標。' },
      { key: 'VMA', code: 'VMA', name: '香草扁桃酸', unit: 'mg/24hrs', range: [1.6, 7.3], aliases: ['vanillylmandelic acid', 'vma', '香草扁桃酸'], desc: '腎上腺素與正腎上腺素的代謝產物，偏高時需注意嗜鉻細胞瘤或神經母細胞瘤。（≥ 18 歲適用）' },
      { key: 'DOPAMINE', code: 'Dopamine', name: '多巴胺', unit: 'µg/24hrs', range: [62, 444], aliases: ['dopamine', '多巴胺'], desc: '兒茶酚胺的一種，用於評估腎上腺或神經內分泌腫瘤。（≥ 18 歲適用）' },
      { key: 'EPINEPHRINE', code: 'Epinephrine', name: '腎上腺素', unit: 'µg/24hrs', range: [4, 20], aliases: ['epinephrine', 'adrenaline', '腎上腺素'], desc: '由腎上腺分泌的壓力荷爾蒙，持續偏高可能與嗜鉻細胞瘤有關。（≥ 18 歲適用）' },
      { key: 'NOREPINEPHRINE', code: 'Nor-epinephrine', name: '正腎上腺素', unit: 'µg/24hrs', range: [23, 105], aliases: ['nor-epinephrine', 'norepinephrine', 'noradrenaline', '正腎上腺素'], desc: '調節血壓的荷爾蒙，偏高可能造成高血壓，需排除嗜鉻細胞瘤。（≥ 18 歲適用）' },
    ],
  },
  {
    key: 'stool', name: '糞便檢查',
    desc: '腸胃疾病篩檢。糞便潛血可篩檢大腸直腸癌、息肉或腸胃道出血；寄生蟲檢查可發現腸道寄生蟲感染。',
    items: [
      { key: 'STOOL_OB', code: 'Stool OB', name: '糞便潛血', unit: '', range: null, kind: 'qual', ref: '(-)', ctx: 'stool', aliases: ['fecal occult blood', 'stool occult blood', 'stool ob', 'ifobt', 'fobt', '糞便潛血', '潛血', 'occult blood'], desc: '偵測肉眼看不到的腸胃道出血。陽性需進一步做大腸鏡檢查，排除大腸直腸癌或息肉。' },
      { key: 'PARASITE', code: 'Parasite', name: '寄生蟲', unit: '', range: null, kind: 'qual', ref: '(-)', ctx: 'stool', aliases: ['parasites', 'parasite', 'ova', '寄生蟲', '蟲卵'], desc: '檢查糞便中有無寄生蟲或蟲卵。' },
    ],
  },
  {
    key: 'liver', name: '肝功能檢查',
    desc: '1. 肝臟病變或受損時，血清中 GOT、GPT、ALP 指數可能升高。\n2. γ-GT 在酒精性肝損傷、膽道阻塞時，指數會有上升現象。\n3. ALP 在造骨病變、肝病、阻塞性黃疸時，指數會有上升現象。\n4. 總蛋白、白蛋白在脫水時可能偏高；肝硬化、腎病、營養不良時會有下降現象。',
    items: [
      { key: 'AST', code: 'AST (GOT)', name: '天門冬胺酸轉胺酶', unit: 'U/L', range: [8, 31], aliases: ['ast(got)', 'ast', 'sgot', 'got', '天門冬胺酸轉胺酶', '麩胺酸草醋酸轉胺基酶'], desc: '存在於肝臟、心肌與肌肉。肝炎、脂肪肝、心肌或肌肉受損時可能升高。' },
      { key: 'ALT', code: 'ALT (GPT)', name: '丙胺酸轉胺酶', unit: 'U/L', range: [0, 41], aliases: ['alt(gpt)', 'alt', 'sgpt', 'gpt', '丙胺酸轉胺酶', '胺基丙胺酸轉胺酶', '麩胺酸丙酮酸轉胺基酶'], desc: '主要存在於肝細胞，是反映肝細胞受損最敏感的指標，肝炎、脂肪肝時常升高。' },
      { key: 'ALP', code: 'ALP', name: '鹼性磷酸酶', unit: 'U/L', range: [34, 104], aliases: ['alkaline phosphatase', 'alk-p', 'alk.p', 'alp', '鹼性磷酸酶', '鹼性磷酸酯酶'], desc: '存在於肝膽與骨骼。膽道阻塞、肝病或骨骼疾病（骨折癒合、骨轉移）時可能升高；生長期兒童本來就較高。' },
      { key: 'GGT', code: 'γ-GT', name: '麩胺醯轉移酶', unit: 'U/L', range: [9, 64], aliases: ['gamma-gt', 'g-gt', 'r-gt', 'y-gt', 'ggt', 'ggtp', '麩胺酸轉胺酵素', '丙麩胺酸轉胺酶', '麩胺醯轉移酶', '珈瑪麩胺醯轉移酶'], desc: '對酒精與膽道疾病敏感。飲酒、酒精性肝病、膽道阻塞或某些藥物會使其上升。' },
      { key: 'TP', code: 'TP', name: '總蛋白', unit: 'g/dL', range: [6.4, 8.9], aliases: ['total protein', 't-p', 't.p', 'tp', '總蛋白', '總蛋白量', '總蛋白質', '血清蛋白總量'], desc: '血中白蛋白與球蛋白的總和。偏低可能與營養不良、肝硬化、腎病有關；脫水時可能偏高。' },
      { key: 'ALB', code: 'ALB', name: '白蛋白', unit: 'g/dL', range: [3.5, 5.7], aliases: ['albumin', 'alb', '白蛋白'], desc: '由肝臟製造，反映肝臟合成能力與營養狀態。肝硬化、腎病、營養不良時會下降。' },
      { key: 'GLO', code: 'GLO', name: '球蛋白', unit: 'g/dL', range: null, aliases: ['globulin', 'glo', '球蛋白'], desc: '總蛋白減去白蛋白。包含免疫球蛋白，慢性發炎、肝硬化或某些血液疾病時可能升高。' },
      { key: 'LDH', code: 'LDH', name: '乳酸脫氫酶', unit: 'U/L', range: [140, 271], aliases: ['lactate dehydrogenase', 'ldh', '乳酸脫氫酶'], desc: '廣泛存在於各種組織。溶血、肝病、心肌或肌肉受損、某些腫瘤時可能升高。' },
      { key: 'NH3', code: 'Ammonia', name: '阿摩尼亞（血氨）', unit: 'µmol/L', range: [16, 53], aliases: ['ammonia', 'nh3', '阿摩尼亞'], desc: '蛋白質代謝產物，由肝臟代謝。嚴重肝病時升高，可能導致肝性腦病變。' },
      { key: 'LACTATE', code: 'Lactate', name: '乳酸', unit: 'mmol/L', range: [0.5, 2.2], aliases: ['lactic acid', 'lactate', '乳酸'], desc: '組織缺氧時產生。偏高可能與休克、嚴重感染、劇烈運動或肝功能不佳有關。' },
    ],
  },
  {
    key: 'bile', name: '膽功能檢查',
    desc: '測定溶血性貧血、黃疸、肝硬化、阻塞性膽道疾病。',
    items: [
      { key: 'TBIL', code: 'T-Bil', name: '總膽紅素', unit: 'mg/dL', range: [0.3, 1.0], aliases: ['total bilirubin', 'bilirubin total', 't-bil', 't.bil', 'tbil', 't-bili', '總膽紅素', 'bilirubin'], desc: '紅血球分解後的產物，由肝臟代謝排入膽汁。偏高會出現黃疸，可能與溶血、肝炎、肝硬化或膽道阻塞有關。' },
      { key: 'DBIL', code: 'D-Bil', name: '直接膽紅素', unit: 'mg/dL', range: [0.03, 0.18], aliases: ['direct bilirubin', 'd-bil', 'd.bil', 'dbil', '直接膽紅素'], desc: '經肝臟處理後的膽紅素。偏高常見於膽道阻塞或肝細胞疾病。' },
    ],
  },
  {
    key: 'kidney', name: '腎功能檢查',
    desc: '檢測腎臟機能障礙、尿毒症、體液不足。',
    items: [
      { key: 'BUN', code: 'BUN', name: '尿素氮', unit: 'mg/dL', range: [7, 25], aliases: ['blood urea nitrogen', 'urea nitrogen', 'bun', 'un', '血清尿素氮', '尿素氮'], desc: '蛋白質代謝產物，由腎臟排出。腎功能不佳、脫水、腸胃道出血或高蛋白飲食時可能升高。' },
      { key: 'CRE', code: 'CRE', name: '肌酸酐', unit: 'mg/dL', range: [0.6, 1.3], aliases: ['creatinine', 'crea', 'cre', '肌酸酐'], desc: '肌肉代謝產物，幾乎全由腎臟排出，是評估腎功能最常用的指標，偏高表示腎功能可能下降。' },
    ],
  },
  {
    key: 'glucose', name: '血糖檢查',
    desc: '糖尿病檢查。空腹血糖、飯後血糖反映當下血糖；糖化血色素反映近 3 個月平均血糖；胰島素與 C-胜肽可評估胰臟分泌胰島素的能力。',
    items: [
      { key: 'GLU_AC', code: 'Glu-AC', name: '空腹血糖', unit: 'mg/dL', range: [70, 100], aliases: ['glucose (a.c.)', 'glucose ac', 'glu-ac', 'glu ac', 'fasting glucose', 'fasting blood sugar', 'fbs', 'ac sugar', '空腹血糖', 'glucose', 'glu', '血糖'], desc: '空腹 8 小時以上的血糖。100–125 為糖尿病前期，≥ 126（兩次）可診斷為糖尿病；低於 70 為低血糖。' },
      { key: 'GLU_PC', code: 'Glu-PC', name: '飯後兩小時血糖', unit: 'mg/dL', range: { lt: 140 }, aliases: ['glucose (2hrs p.c.)', 'glucose 2hrs pc', 'glucose (p.c.)', 'glu-pc', 'glu pc', 'pc sugar', '飯後兩小時血糖', '飯後2小時血糖', '飯後血糖', '餐後血糖'], desc: '用餐後兩小時的血糖，反映身體處理醣類的能力。≥ 200 可能為糖尿病。' },
      { key: 'HBA1C', code: 'HbA1c', name: '糖化血色素', unit: '%', range: [4.0, 6.0], aliases: ['glycated hemoglobin', 'glycohemoglobin', 'hba1c', 'hb a1c', 'hbalc', 'a1c', '糖化血色素', '糖化血紅素'], desc: '反映過去約 3 個月的平均血糖。5.7–6.4% 為糖尿病前期，≥ 6.5% 可診斷為糖尿病；糖尿病患者通常以 < 7% 為控制目標。' },
      { key: 'INSULIN', code: 'Insulin', name: '胰島素', unit: 'µU/mL', range: { lt: 28.8 }, aliases: ['insulin', '胰島素'], desc: '胰臟分泌的降血糖荷爾蒙。空腹胰島素偏高可能代表胰島素阻抗。' },
      { key: 'CPEP', code: 'C-peptide', name: 'C-胜肽（0 分鐘）', unit: 'ng/mL', range: [0.78, 5.19], aliases: ['c-peptide', 'c peptide', 'cpeptide', 'c-pep', '胰島素連結胜肽', 'c-胜肽'], desc: '與胰島素等量分泌，可評估胰臟自行製造胰島素的能力，協助區分糖尿病類型。' },
    ],
  },
  {
    key: 'lipid', name: '血脂肪檢查',
    desc: '血清油脂升高會增加動脈硬化與心肌梗塞的危險性，更易引起高血壓。',
    items: [
      { key: 'TCHO', code: 'T-CHO', name: '總膽固醇', unit: 'mg/dL', range: { lt: 200 }, aliases: ['total cholesterol', 't-chol', 't.chol', 't-cho', 'tcho', 'chol', 'cholesterol', '總膽固醇'], desc: '血中膽固醇的總量。過高會增加動脈硬化與心血管疾病風險。' },
      { key: 'TG', code: 'TG', name: '三酸甘油酯', unit: 'mg/dL', range: { lt: 150 }, aliases: ['triglycerides', 'triglyceride', 'tg', '三酸甘油酯', '三酸甘油脂'], desc: '血中主要的脂肪。受飲食、飲酒影響大，過高會增加心血管疾病與胰臟炎風險。需空腹檢查。' },
    ],
  },
  {
    key: 'lipid2', name: '特殊脂肪',
    desc: '高密度膽固醇為好的膽固醇，會帶走附著於動脈內壁的膽固醇，防止動脈硬化；低密度膽固醇則為壞的膽固醇，會造成動脈硬化。',
    items: [
      { key: 'HDL', code: 'HDL-C', name: '高密度脂蛋白膽固醇', unit: 'mg/dL', range: { gt: 40 }, aliases: ['hdl-cholesterol', 'hdl cholesterol', 'hdl-c', 'hdl', '高密度脂蛋白膽固醇', '高密度脂蛋白', '高密度膽固醇'], desc: '「好的膽固醇」，越高越能保護血管。運動可以提升。' },
      { key: 'LDL', code: 'LDL-C', name: '低密度脂蛋白膽固醇', unit: 'mg/dL', range: { lt: 130 }, aliases: ['ldl-cholesterol', 'ldl cholesterol', 'ldl-c', 'ldl', '低密度脂蛋白膽固醇', '低密度脂蛋白', '低密度膽固醇'], desc: '「壞的膽固醇」，過高會沉積在血管壁造成動脈硬化。有心血管疾病或糖尿病者，控制目標會更低。' },
    ],
  },
  {
    key: 'cardio', name: '心臟血管與發炎指標',
    desc: '高敏感度 C-反應性蛋白（hsCRP）反映體內輕微的發炎程度，可用於評估感染、發炎性疾病，以及心血管疾病風險；肌酸磷酸酶（CK）在肌肉或心肌受損時會升高。',
    items: [
      { key: 'HSCRP', code: 'hsCRP', name: '高敏感度 C-反應性蛋白', unit: 'mg/dL', kind: 'tier', range: { lt: 1 },
        tiers: [
          { lt: 0.1, level: 'ok', text: '心血管低風險' },
          { le: 0.3, level: 'ok', text: '心血管平均風險' },
          { lt: 1, level: 'warn', text: '心血管高風險' },
          { level: 'warn', text: '偏高（發炎）' },
        ],
        ref: '< 1（評估感染或發炎）；心血管風險：低 < 0.1、平均 0.1–0.3、高 > 0.3',
        aliases: ['hs-crp', 'hscrp', 'hs crp', '高敏感度c-反應性蛋白', '高敏感度c反應性蛋白', '高敏感度c反應蛋白'], desc: '≥ 1 mg/dL 提示感染或發炎；低於 1 時可用來分級心血管疾病風險。' },
      { key: 'CK', code: 'CK', name: '肌酸磷酸酶', unit: 'U/L', range: [30, 223], aliases: ['creatine kinase', 'cpk', 'ck', '肌酸磷酸酶', '肌酸激酶'], desc: '存在於骨骼肌、心肌。劇烈運動、肌肉受傷、心肌梗塞或服用某些降血脂藥物時可能升高。' },
    ],
  },
  {
    key: 'hepatitis', name: '肝炎檢查',
    desc: '是否感染 B 型肝炎？是否具 B 型肝炎抗體？是否感染 C 型肝炎？是否感染 A 型肝炎？\n多數肝炎檢驗以 S/CO 指數（檢體訊號／判讀閾值）判讀為陰性或陽性。',
    items: [
      { key: 'HBSAG', code: 'HBsAg', name: 'B 型肝炎表面抗原（定性）', unit: 'S/CO', kind: 'sco', sco: { cutoff: 1 },
        pos: { level: 'warn', text: '陽性（B 肝帶原或感染）' }, neg: { level: 'ok', text: '陰性' },
        ref: '陰性 < 1.0；陽性 ≥ 1.0', aliases: ['hbsag (qualitative)', 'hbsag', 'hbs ag', 'hbs-ag', 'b型肝炎表面抗原', 'b型肝炎抗原'], desc: '陽性表示目前感染 B 型肝炎或為帶原者，應定期追蹤肝功能與腹部超音波。' },
      { key: 'HBSAG_Q', code: 'HBsAg (Quant)', name: 'B 型肝炎表面抗原（定量）', unit: 'IU/mL', kind: 'sco', sco: { cutoff: 0.05 },
        pos: { level: 'warn', text: '陽性' }, neg: { level: 'ok', text: '陰性' },
        ref: '陰性 < 0.05；陽性 ≥ 0.05', aliases: ['hbsag (quantitative)', 'hbsag quantitative', 'hbsag quant', 'qhbsag', 'hbsag定量', 'b型肝炎表面抗原定量'], desc: '測量表面抗原的濃度，可評估 B 肝帶原者的病毒活性與治療反應。' },
      { key: 'ANTI_HBS', code: 'Anti-HBs', name: 'B 型肝炎表面抗體', unit: 'mIU/mL', kind: 'sco', sco: { cutoff: 10 },
        pos: { level: 'ok', text: '陽性（具保護力）' }, neg: { level: 'info', text: '陰性（無保護力）' },
        ref: '陰性 < 10；陽性 ≥ 10', aliases: ['anti-hbs ab', 'anti-hbs', 'anti hbs', 'hbsab', 'hbs ab', '抗b型肝炎表面抗原抗體', 'b型肝炎表面抗體', 'b型肝炎抗體'], desc: '陽性表示對 B 型肝炎具有免疫力（打過疫苗或曾感染已痊癒）；陰性且表面抗原也陰性者，可考慮接種疫苗。' },
      { key: 'HBEAG', code: 'HBeAg', name: 'B 型肝炎 e 抗原', unit: 'S/CO', kind: 'sco', sco: { cutoff: 1 },
        pos: { level: 'warn', text: '陽性（病毒活性高）' }, neg: { level: 'ok', text: '陰性' },
        ref: '陰性 < 1.0；陽性 ≥ 1.0', aliases: ['hbeag', 'hbe ag', 'b型肝炎e抗原'], desc: '陽性表示 B 肝病毒複製活躍、傳染力較高。' },
      { key: 'ANTI_HBE', code: 'Anti-HBe', name: 'B 型肝炎 e 抗體', unit: 'S/CO', kind: 'sco', sco: { cutoff: 1, inverse: true },
        pos: { level: 'info', text: '陽性（恢復期）' }, neg: { level: 'ok', text: '陰性' },
        ref: '陰性 > 1.0；陽性 ≤ 1.0（數值越低越陽性）', aliases: ['anti-hbe', 'anti hbe', 'hbeab', 'hbe ab', '抗b型肝炎e抗原抗體'], desc: '出現 e 抗體通常表示病毒活性下降、進入恢復期。注意此項判讀方向相反：數值 ≤ 1.0 為陽性。' },
      { key: 'ANTI_HBC', code: 'Anti-HBc', name: 'B 型肝炎核心抗體', unit: 'S/CO', kind: 'sco', sco: { cutoff: 1 },
        pos: { level: 'info', text: '陽性（曾經感染）' }, neg: { level: 'ok', text: '陰性' },
        ref: '陰性 < 1.0；陽性 ≥ 1.0', aliases: ['anti-hbc', 'anti hbc', 'hbcab', 'hbc ab', '抗b型肝炎核心抗原抗體'], desc: '陽性表示曾經感染過 B 型肝炎（不論目前是否痊癒）。' },
      { key: 'ANTI_HBC_IGM', code: 'Anti-HBc IgM', name: 'B 型肝炎核心抗體 IgM', unit: 'S/CO', kind: 'sco', sco: { cutoff: 1 },
        pos: { level: 'warn', text: '陽性（急性感染）' }, neg: { level: 'ok', text: '陰性' },
        ref: '陰性 < 1.0；陽性 ≥ 1.0', aliases: ['anti-hbc-igm', 'anti-hbc igm', 'anti hbc igm', 'hbc igm', '抗b型肝炎核心抗原igm抗體'], desc: '陽性表示近期急性 B 型肝炎感染。' },
      { key: 'ANTI_HCV', code: 'Anti-HCV', name: 'C 型肝炎抗體', unit: 'S/CO', kind: 'sco', sco: { cutoff: 1 },
        pos: { level: 'warn', text: '陽性（需確認是否感染）' }, neg: { level: 'ok', text: '陰性' },
        ref: '陰性 < 1.0；陽性 ≥ 1.0', aliases: ['anti-hcv ab', 'anti-hcv', 'anti hcv', 'hcv ab', '抗c型肝炎抗體', 'c型肝炎抗體', 'c型肝炎'], desc: '陽性表示曾經或目前感染 C 型肝炎，需再驗病毒量（HCV RNA）確認。C 肝目前有口服藥可治癒。' },
      { key: 'ANTI_HAV_IGG', code: 'Anti-HAV IgG', name: 'A 型肝炎抗體 IgG', unit: 'S/CO', kind: 'sco', sco: { cutoff: 1 },
        pos: { level: 'ok', text: '陽性（具免疫力）' }, neg: { level: 'info', text: '陰性（無抗體）' },
        ref: '陰性 < 1.0；陽性 ≥ 1.0', aliases: ['anti-hav-igg', 'anti-hav igg', 'anti hav igg', 'hav igg', '抗a型肝炎igg抗體'], desc: '陽性表示曾感染或接種過疫苗，對 A 型肝炎具免疫力；陰性者可考慮接種疫苗。' },
      { key: 'ANTI_HAV_IGM', code: 'Anti-HAV IgM', name: 'A 型肝炎抗體 IgM', unit: 'S/CO', kind: 'sco', sco: { cutoff: 1.2, gray: [0.8, 1.2], strict: true },
        pos: { level: 'warn', text: '陽性（急性感染）' }, neg: { level: 'ok', text: '陰性' }, gray: { level: 'warn', text: '灰色地帶' },
        ref: '陰性 < 0.80；灰色地帶 0.80–1.20；陽性 > 1.20', aliases: ['anti-hav-igm', 'anti-hav igm', 'anti hav igm', 'hav igm', 'hav-igm', '抗a型肝炎igm抗體', 'a型肝炎'], desc: '陽性表示近期急性 A 型肝炎感染；灰色地帶需重新檢驗。' },
    ],
  },
  {
    key: 'uric', name: '尿酸檢查',
    desc: '檢測痛風及攝食過多普林食物。',
    items: [
      { key: 'UA', code: 'UA', name: '尿酸', unit: 'mg/dL', range: { M: [4.4, 7.6], F: [2.3, 6.6] }, aliases: ['uric acid', 'u.a.', 'u.a', 'ua', '尿酸'], desc: '普林代謝的產物。偏高可能引起痛風、尿酸結石，也與腎臟病、代謝症候群有關。' },
    ],
  },
  {
    key: 'afp', name: '胎兒蛋白檢查',
    desc: 'AFP 升高則有可能是肝炎、肝硬化或肝腫瘤。',
    items: [
      { key: 'AFP', code: 'AFP', name: '甲型胎兒蛋白', unit: 'ng/mL', range: { lt: 20 }, aliases: ['alpha-fetoprotein', 'a-fetoprotein', 'alpha fetoprotein', 'afp', '甲型胎兒蛋白', '胎兒蛋白'], desc: '肝癌的腫瘤標記，肝炎、肝硬化時也可能升高。B、C 肝帶原者應定期追蹤。' },
    ],
  },
  {
    key: 'thyroid', name: '甲狀腺機能檢查',
    desc: '檢測甲狀腺機能，評估身體代謝能力。TSH 偏低、甲狀腺素偏高提示甲狀腺機能亢進；TSH 偏高、甲狀腺素偏低提示甲狀腺機能低下。甲狀腺抗體可協助診斷自體免疫甲狀腺疾病。',
    items: [
      { key: 'T3', code: 'T3', name: '三碘甲狀腺素', unit: 'ng/dL', range: [78, 182], aliases: ['total t3', 't3', '三碘甲狀腺素'], desc: '活性較強的甲狀腺荷爾蒙。甲狀腺機能亢進時偏高。' },
      { key: 'T4', code: 'T4', name: '四碘甲狀腺素', unit: 'µg/dL', range: [4.6, 12.4], aliases: ['total t4', 't4', '四碘甲狀腺素'], desc: '甲狀腺分泌的主要荷爾蒙。偏高可能為甲狀腺機能亢進，偏低可能為機能低下。' },
      { key: 'TSH', code: 'TSH', name: '甲狀腺刺激素', unit: 'mIU/L', range: [0.17, 4.05], aliases: ['thyroid stimulating hormone', 'tsh', '甲狀腺刺激素', '甲狀腺素促素'], desc: '腦下垂體分泌、調控甲狀腺的荷爾蒙，是篩檢甲狀腺功能最敏感的指標。' },
      { key: 'FT4', code: 'Free T4', name: '游離甲狀腺素（RIA）', unit: 'ng/dL', range: [0.89, 1.79], aliases: ['free t4 (ria)', 'free t4', 'ft4', 'f-t4', '游離甲狀腺素'], desc: '未與蛋白質結合、真正有作用的甲狀腺素，比總 T4 更能反映甲狀腺功能。' },
      { key: 'FT4_CIA', code: 'Free T4 (CIA)', name: '游離型甲狀腺素（CIA）', unit: 'ng/dL', range: [0.7, 1.48], aliases: ['free t4 (cia)', 'ft4 (cia)', '游離型甲狀腺素'], desc: '以化學冷光法（CIA）檢測的游離甲狀腺素，參考值與 RIA 法不同。' },
      { key: 'ANTI_TG', code: 'Anti-Tg', name: '抗甲狀腺球蛋白抗體', unit: 'IU/mL', range: { lt: 14.4 }, aliases: ['anti-thyroglobulin antibody', 'anti-thyroglobulin', 'anti-tg', 'anti tg', 'tgab', '抗甲狀腺球蛋白抗體'], desc: '自體免疫甲狀腺疾病（如橋本氏甲狀腺炎、葛瑞夫茲病）時可能升高。' },
      { key: 'ANTI_TPO', code: 'Anti-TPO', name: '甲狀腺過氧化酶抗體', unit: 'IU/mL', range: { lt: 5.61 }, aliases: ['anti-tpo', 'anti tpo', 'tpo ab', 'tpoab', '甲狀腺過氧化酶抗體'], desc: '最常用來診斷橋本氏甲狀腺炎的抗體，陽性者未來發生甲狀腺機能低下的機會較高。' },
    ],
  },
  {
    key: 'cea', name: '癌性胚胎抗原檢查',
    desc: 'CEA 升高可能與肝癌、胰臟癌、腸胃道癌、乳癌、卵巢癌有關，另外抽菸也會使 CEA 升高。',
    items: [
      { key: 'CEA', code: 'CEA', name: '癌胚胎抗原', unit: 'ng/mL', range: { lt: 5 }, aliases: ['carcinoembryonic antigen', 'cea', '癌胚胎抗原', '癌胚抗原'], desc: '大腸直腸癌等腫瘤的標記，多用於追蹤治療效果與復發。抽菸、發炎也可能輕微升高。' },
    ],
  },
  {
    key: 'tumor', name: '癌症指標',
    desc: '1. PSA：檢測攝護腺肥大與攝護腺癌。\n2. CA-125、CA-153：卵巢癌、乳癌及骨盆腔發炎、月經期間 CA-125 濃度會升高。\n3. CA19-9：胰臟癌、結腸癌、胃癌、膽管癌、胰臟炎等。\n4. β-HCG：絨毛膜癌、睪丸癌、卵巢癌。\n腫瘤標記異常不等於罹癌，需由醫師綜合判斷。',
    items: [
      { key: 'PSA', code: 'PSA', name: '攝護腺特異抗原', unit: 'ng/mL', range: null, aliases: ['psa', '前列腺特異抗原', '攝護腺特異抗原'], desc: '攝護腺肥大、發炎或攝護腺癌時可能升高，適用男性。' },
      { key: 'CA125', code: 'CA-125', name: '癌症抗原 125', unit: 'U/mL', range: { lt: 35 }, aliases: ['ca-125', 'ca 125', 'ca125', '癌症抗原125'], desc: '卵巢癌的腫瘤標記；骨盆腔發炎、子宮內膜異位症、月經期間也可能升高。' },
      { key: 'CA153', code: 'CA-153', name: '癌症抗原 15-3', unit: 'U/mL', range: null, aliases: ['ca-15-3', 'ca 15-3', 'ca15-3', 'ca-153', 'ca153', '癌症抗原15-3'], desc: '乳癌的腫瘤標記，多用於追蹤治療效果與復發。' },
      { key: 'CA199', code: 'CA19-9', name: '癌症抗原 19-9', unit: 'U/mL', range: { lt: 37 }, aliases: ['ca-19-9', 'ca 19-9', 'ca19-9', 'ca-199', 'ca199', '癌症抗原ca19-9', '癌症抗原19-9'], desc: '胰臟癌、膽道癌的腫瘤標記；胰臟炎、膽道阻塞時也可能升高。' },
      { key: 'BHCG', code: 'β-HCG', name: '人類絨毛膜促性腺激素', unit: 'mIU/mL', range: null, aliases: ['beta-hcg', 'b-hcg', 'bhcg', 'hcg', '絨毛膜促性腺激素', '絨毛膜癌'], desc: '懷孕時會升高；非懷孕狀態升高時需注意絨毛膜癌、睪丸癌、卵巢癌。' },
    ],
  },
  {
    key: 'ekg', name: '心電圖檢查',
    desc: '檢查心律不整、心肌缺氧、心房室肥大、心肌炎等。',
    items: [
      { key: 'EKG', code: 'EKG', name: '靜態心電圖', unit: '', range: null, kind: 'text', aliases: ['靜態心電圖', '心電圖', 'electrocardiogram', 'ekg', 'ecg'], desc: '休息狀態下記錄心臟電氣活動，可發現心律不整、心肌缺氧或肥大。' },
      { key: 'EKG_EX', code: 'Exercise EKG', name: '運動心電圖', unit: '', range: null, kind: 'text', aliases: ['運動型心電圖', '運動心電圖', 'exercise ekg', 'treadmill'], desc: '在跑步機上運動時記錄心電圖，可發現休息時不明顯的冠狀動脈疾病。' },
    ],
  },
  { key: 'cxr', name: '胸部 X 光檢查', desc: '心臟肥大與否、呼吸道、肺疾病等檢查。',
    items: [{ key: 'CXR', code: 'Chest X-ray', name: '胸部 X 光', unit: '', range: null, kind: 'text', aliases: ['胸部x光攝影', '胸部x光', 'chest x-ray', 'chest pa', 'cxr'], desc: '檢查肺部（如肺炎、結核、腫瘤）、心臟大小與脊椎。' }] },
  { key: 'axr', name: '腹部 X 光檢查', desc: '檢查結石、骨刺、脊椎變形。',
    items: [{ key: 'AXR', code: 'KUB', name: '腹部 X 光', unit: '', range: null, kind: 'text', aliases: ['腹部x光攝影', '腹部x光', 'abdomen x-ray', 'kub'], desc: '檢查泌尿道結石、腸道氣體分布、骨刺與脊椎變形。' }] },
  { key: 'abdus', name: '腹部超音波檢查', desc: '檢查肝臟、膽囊、胰臟、脾臟、腎臟、肝內膽管、總膽管等器官是否正常。',
    items: [{ key: 'ABD_US', code: 'Abd. Echo', name: '腹部超音波', unit: '', range: null, kind: 'text', aliases: ['腹部超音波', 'abdominal sonography', 'abdominal ultrasound', 'abdomen echo', 'abd echo'], desc: '可發現脂肪肝、肝硬化、肝腫瘤、膽結石、腎結石、腎囊腫等。' }] },
  { key: 'vdrl', name: '梅毒檢查', desc: '梅毒之檢測。',
    items: [{ key: 'VDRL', code: 'VDRL', name: '梅毒血清檢查', unit: '', range: null, kind: 'qual', ref: 'Non-reactive（陰性）', aliases: ['vdrl', 'rpr', '梅毒'], desc: '篩檢梅毒感染。陽性需再做確認試驗（TPPA）。' }] },
  {
    key: 'lung', name: '肺功能檢查', desc: '評估肺部通氣能力。',
    items: [
      { key: 'FVC', code: 'FVC', name: '用力肺活量', unit: 'L', range: null, aliases: ['fvc', '用力肺活量'], desc: '深吸氣後用力吐出的最大氣量。偏低可能為限制性肺病。' },
      { key: 'FEV1', code: 'FEV1', name: '一秒最大呼氣量', unit: 'L', range: null, aliases: ['fev1', 'fev 1', '一秒最大呼氣量', '一秒用力呼氣量'], desc: '用力吐氣第一秒的氣量。偏低可能為阻塞性肺病（如氣喘、慢性阻塞性肺病）。' },
      { key: 'FEV1_FVC', code: 'FEV1/FVC', name: '一秒率', unit: '%', range: null, aliases: ['fev1/fvc ratio', 'fev1/fvc', '一秒率'], desc: 'FEV1 占 FVC 的比例，是判斷呼吸道阻塞的重要指標。' },
    ],
  },
  { key: 'bmd', name: '骨質密度檢查', desc: '骨質密度檢查，評估骨質疏鬆與骨折風險。',
    items: [{ key: 'BMD', code: 'T-score', name: '骨質密度 T 值', unit: '', range: null, signed: true, aliases: ['t-score', 't score', 'bmd', '骨質密度'], desc: '與年輕成人比較的骨密度分數，數值越低骨質越疏鬆。' }] },
  { key: 'hiv', name: '愛滋病檢查', desc: '檢測是否感染愛滋病。',
    items: [{ key: 'HIV', code: 'Anti-HIV', name: '愛滋病毒抗體', unit: '', range: null, kind: 'qual', ref: 'Non-reactive（陰性）', aliases: ['anti-hiv', 'hiv ab', 'hiv', '愛滋病'], desc: '篩檢愛滋病毒感染。陽性需再做確認檢驗。' }] },
  { key: 'hearing', name: '聽力檢查', desc: '聽力是否衰減、雙耳是否平衡。',
    items: [{ key: 'HEARING', code: 'Hearing', name: '聽力', unit: '', range: null, kind: 'text', aliases: ['聽力', 'hearing', 'audiometry'], desc: '檢查聽力是否下降，以及左右耳是否平衡。' }] },
  {
    key: 'chem', name: '生化檢驗（電解質與營養）',
    desc: '評估電解質（鈉、鉀、氯、鈣、鎂、磷）是否平衡，以及鐵質與維生素 D 的狀態。電解質異常可能與腎臟、內分泌、脫水或藥物有關；血清鐵、總鐵結合能力與鐵蛋白可協助判斷缺鐵性貧血；維生素 D 與骨骼健康相關。',
    items: [
      { key: 'IRON', code: 'Fe', name: '血清鐵', unit: 'µg/dL', range: [51, 209], aliases: ['serum iron', 'iron', 'fe', '血清鐵'], desc: '血中的鐵量。偏低常見於缺鐵性貧血或慢性發炎。' },
      { key: 'TIBC', code: 'TIBC', name: '總鐵結合能力', unit: 'µg/dL', range: [268, 593], aliases: ['total iron binding capacity', 'tibc', '總鐵結合能力'], desc: '血中可結合鐵的蛋白質總量。缺鐵時通常偏高。' },
      { key: 'FERRITIN', code: 'Ferritin', name: '鐵蛋白', unit: 'ng/mL', range: { M: [21.81, 274.66], F: [4.63, 204.0] }, aliases: ['ferritin', '鐵蛋白'], desc: '反映體內儲存的鐵量，偏低是缺鐵最可靠的指標；發炎、肝病時可能偏高。' },
      { key: 'VITD', code: '25-OH Vit D', name: '維生素 D', unit: 'ng/mL', kind: 'tier', range: [25, 80],
        tiers: [
          { lt: 10, level: 'warn', text: '嚴重缺乏' },
          { lt: 25, level: 'warn', text: '輕中度缺乏' },
          { le: 80, level: 'ok', text: '理想' },
          { level: 'warn', text: '可能過量' },
        ],
        ref: '嚴重缺乏 < 10；輕中度缺乏 10–24；理想 25–80；可能過量 > 80',
        aliases: ['25-oh vitamin d', '25(oh)d', '25-oh-d', '25-oh vit d', 'vitamin d', 'vit d', 'vit. d', '維生素d', '維他命d'], desc: '與鈣質吸收、骨骼健康及免疫功能有關。缺乏時可能導致骨質疏鬆。' },
      { key: 'NA', code: 'Na', name: '鈉', unit: 'mmol/L', range: [136, 145], aliases: ['sodium', 'na', '鈉'], desc: '維持體液平衡與神經肌肉功能。過低或過高可能與水分攝取、腎臟、內分泌疾病或藥物有關。' },
      { key: 'K', code: 'K', name: '鉀', unit: 'mmol/L', range: [3.5, 5.1], aliases: ['potassium', 'k', '鉀'], desc: '對心臟跳動與肌肉功能非常重要。過高或過低都可能引起心律不整，腎功能不佳者需特別注意。' },
      { key: 'CL', code: 'Cl', name: '氯', unit: 'mmol/L', range: [98, 107], aliases: ['chloride', 'cl', '氯'], desc: '與鈉一起維持體液與酸鹼平衡。' },
      { key: 'CA', code: 'Ca', name: '鈣', unit: 'mmol/L', range: [2.15, 2.58], conv: { from: 'mg/dl', factor: 1 / 4.008 }, aliases: ['calcium', 'ca', '鈣'], desc: '構成骨骼並參與神經肌肉功能。異常可能與副甲狀腺、維生素 D、腎臟疾病有關。報告若以 mg/dL 表示，辨識時會自動換算。' },
      { key: 'MG', code: 'Mg', name: '鎂', unit: 'mmol/L', range: [0.78, 1.11], conv: { from: 'mg/dl', factor: 1 / 2.431 }, aliases: ['magnesium', '鎂'], desc: '參與神經肌肉與心臟功能。偏低可能造成抽筋、心律不整。報告若以 mg/dL 表示，辨識時會自動換算。' },
      { key: 'P', code: 'P', name: '磷', unit: 'mg/dL', range: [2.5, 5], aliases: ['inorganic phosphorus', 'phosphorus', 'phosphate', 'ip', '無機磷', '磷'], desc: '與鈣一起維持骨骼健康。腎功能不佳時常偏高。' },
    ],
  },
];
