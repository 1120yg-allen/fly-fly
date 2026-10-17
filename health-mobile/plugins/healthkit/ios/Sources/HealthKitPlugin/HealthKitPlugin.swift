import Foundation
import Capacitor
import HealthKit

/// 唯讀存取 Apple 健康：只讀取健康紀錄 App 會用到的項目，不寫入任何資料。
/// 回傳的時間都是毫秒（Unix epoch），日期與單位換算交給 JS（native.js / integrations.js）處理。
@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readData", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    private enum Daily: String, CaseIterable {
        case steps, exercise, water, heart

        var type: HKQuantityType {
            switch self {
            case .steps: return HKQuantityType.quantityType(forIdentifier: .stepCount)!
            case .exercise: return HKQuantityType.quantityType(forIdentifier: .appleExerciseTime)!
            case .water: return HKQuantityType.quantityType(forIdentifier: .dietaryWater)!
            case .heart: return HKQuantityType.quantityType(forIdentifier: .restingHeartRate)!
            }
        }
        var unit: HKUnit {
            switch self {
            case .steps: return .count()
            case .exercise: return .minute()
            case .water: return .literUnit(with: .milli)
            case .heart: return HKUnit.count().unitDivided(by: .minute())
            }
        }
        var options: HKStatisticsOptions { self == .heart ? .discreteAverage : .cumulativeSum }
    }

    private let weightType = HKQuantityType.quantityType(forIdentifier: .bodyMass)!
    private let glucoseType = HKQuantityType.quantityType(forIdentifier: .bloodGlucose)!
    private let tempType = HKQuantityType.quantityType(forIdentifier: .bodyTemperature)!
    private let sysType = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic)!
    private let diaType = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic)!
    private let bpType = HKCorrelationType.correlationType(forIdentifier: .bloodPressure)!
    private let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!

    private var readTypes: Set<HKObjectType> {
        var s: Set<HKObjectType> = [weightType, glucoseType, tempType, sysType, diaType, sleepType]
        Daily.allCases.forEach { s.insert($0.type) }
        return s
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["value": HKHealthStore.isHealthDataAvailable()])
    }

    /// 跳出系統的「健康」授權畫面。Apple 不會告訴 App 使用者是否拒絕讀取（隱私設計），
    /// 拒絕時讀到的只會是空資料。
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("此裝置不支援 Apple 健康")
            return
        }
        store.requestAuthorization(toShare: nil, read: readTypes) { ok, error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve(["value": ok])
            }
        }
    }

    /// 讀取最近 days 天的資料
    @objc func readData(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("此裝置不支援 Apple 健康")
            return
        }
        let days = max(1, min(call.getInt("days") ?? 90, 3650))
        let cal = Calendar.current
        let end = Date()
        let start = cal.date(byAdding: .day, value: -days, to: cal.startOfDay(for: end))!

        let group = DispatchGroup()
        let lock = NSLock()
        var result: [String: Any] = [:]
        var errors: [String] = []
        func put(_ key: String, _ value: Any) { lock.lock(); result[key] = value; lock.unlock() }
        func fail(_ key: String, _ error: Error) { lock.lock(); errors.append("\(key): \(error.localizedDescription)"); lock.unlock() }

        // 每日加總／平均：HealthKit 會依「資料來源優先順序」合併 iPhone 與 Apple Watch，不會重複計算
        for d in Daily.allCases {
            group.enter()
            let q = HKStatisticsCollectionQuery(
                quantityType: d.type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end),
                options: d.options,
                anchorDate: cal.startOfDay(for: start),
                intervalComponents: DateComponents(day: 1))
            q.initialResultsHandler = { _, stats, error in
                defer { group.leave() }
                if let error = error { fail(d.rawValue, error); return }
                var rows: [[Double]] = []
                stats?.enumerateStatistics(from: start, to: end) { s, _ in
                    let q = d == .heart ? s.averageQuantity() : s.sumQuantity()
                    if let v = q?.doubleValue(for: d.unit), v > 0 {
                        rows.append([s.startDate.timeIntervalSince1970 * 1000, v])
                    }
                }
                put(d.rawValue, rows)
            }
            store.execute(q)
        }

        // 單筆量測
        let samples: [(String, HKQuantityType, HKUnit)] = [
            ("weight", weightType, .gramUnit(with: .kilo)),
            ("glucose", glucoseType, HKUnit(from: "mg/dL")),
            ("temp", tempType, .degreeCelsius())
        ]
        for (key, type, unit) in samples {
            group.enter()
            query(type, start, end) { list, error in
                defer { group.leave() }
                if let error = error { fail(key, error); return }
                put(key, (list as? [HKQuantitySample] ?? []).map {
                    [$0.startDate.timeIntervalSince1970 * 1000, $0.quantity.doubleValue(for: unit)]
                })
            }
        }

        // 血壓（收縮壓與舒張壓配對儲存）
        group.enter()
        query(bpType, start, end) { list, error in
            defer { group.leave() }
            if let error = error { fail("bp", error); return }
            let mmHg = HKUnit.millimeterOfMercury()
            let rows: [[Double]] = (list as? [HKCorrelation] ?? []).compactMap { c in
                guard let sys = c.objects(for: self.sysType).first as? HKQuantitySample,
                      let dia = c.objects(for: self.diaType).first as? HKQuantitySample else { return nil }
                return [c.startDate.timeIntervalSince1970 * 1000, sys.quantity.doubleValue(for: mmHg), dia.quantity.doubleValue(for: mmHg)]
            }
            put("bp", rows)
        }

        // 睡眠：只取「睡著」的區段（不含在床上、清醒），附上來源名稱，由 JS 依來源取最大值
        group.enter()
        query(sleepType, start, end) { list, error in
            defer { group.leave() }
            if let error = error { fail("sleep", error); return }
            let inBed = HKCategoryValueSleepAnalysis.inBed.rawValue
            let awake = HKCategoryValueSleepAnalysis.awake.rawValue
            let rows: [[String: Any]] = (list as? [HKCategorySample] ?? []).compactMap { s in
                guard s.value != inBed && s.value != awake else { return nil }
                return [
                    "start": s.startDate.timeIntervalSince1970 * 1000,
                    "end": s.endDate.timeIntervalSince1970 * 1000,
                    "source": s.sourceRevision.source.name
                ]
            }
            put("sleep", rows)
        }

        group.notify(queue: .main) {
            result["errors"] = errors
            call.resolve(result)
        }
    }

    private func query(_ type: HKSampleType, _ start: Date, _ end: Date, _ done: @escaping ([HKSample]?, Error?) -> Void) {
        let q = HKSampleQuery(
            sampleType: type,
            predicate: HKQuery.predicateForSamples(withStart: start, end: end),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { _, list, error in done(list, error) }
        store.execute(q)
    }
}
