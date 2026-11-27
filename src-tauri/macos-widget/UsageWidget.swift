import AppIntents
import Darwin
import Foundation
import SwiftUI
import WidgetKit

enum UsagePeriod: String, CaseIterable {
    case today, week, month

    var label: String {
        switch self {
        case .today: "日"
        case .week: "周"
        case .month: "月"
        }
    }

    var fullLabel: String {
        switch self {
        case .today: "今日"
        case .week: "本周"
        case .month: "本月"
        }
    }

    static var selected: Self {
        WidgetStateStore.shared.modelPeriod
    }
}

enum WidgetSlot: String {
    case small, medium, large

    init(family: WidgetFamily) {
        switch family {
        case .systemMedium: self = .medium
        case .systemLarge: self = .large
        default: self = .small
        }
    }
}

// Mirrors widget interaction state in memory so rapid taps avoid repeated UserDefaults IPC round-trips.
private final class WidgetStateStore: @unchecked Sendable {
    static let shared = WidgetStateStore()

    private let lock = NSLock()
    private var modelPeriodValue: UsagePeriod
    private var largePeriodValue: UsagePeriod
    private var largeProjectRankingValue: Bool
    private var largeProjectIDValue: String?
    private var largeProjectPageValue: Int
    private var largeOverviewPageValue: Int
    private var largeOthersExpandedValue: Bool
    private var quotaDetailUntil: [String: TimeInterval] = [:]

    private init() {
        let defaults = UserDefaults.standard
        modelPeriodValue = defaults.string(forKey: "modelPeriod").flatMap(UsagePeriod.init(rawValue:)) ?? .today
        largePeriodValue = defaults.string(forKey: "largePeriod").flatMap(UsagePeriod.init(rawValue:)) ?? .today
        largeProjectRankingValue = defaults.object(forKey: "largeProjectRanking") as? Bool ?? true
        largeProjectIDValue = defaults.string(forKey: "largeProjectID")
        largeProjectPageValue = defaults.integer(forKey: "largeProjectPage")
        largeOverviewPageValue = defaults.integer(forKey: "largeOverviewPage")
        largeOthersExpandedValue = defaults.bool(forKey: "largeOthersExpanded")
        for slot in [WidgetSlot.small, .medium, .large] {
            let key = "quotaDetail.\(slot.rawValue)"
            let until = defaults.double(forKey: key)
            if until > 0 { quotaDetailUntil[key] = until }
        }
    }

    var modelPeriod: UsagePeriod {
        lock.lock()
        defer { lock.unlock() }
        return modelPeriodValue
    }

    func quotaUntil(for slot: WidgetSlot) -> TimeInterval? {
        lock.lock()
        defer { lock.unlock() }
        return quotaDetailUntil["quotaDetail.\(slot.rawValue)"]
    }

    func largeState() -> (
        period: UsagePeriod, projectRanking: Bool, projectID: String?,
        projectPage: Int, overviewPage: Int, othersExpanded: Bool
    ) {
        lock.lock()
        defer { lock.unlock() }
        return (
            largePeriodValue, largeProjectRankingValue, largeProjectIDValue,
            largeProjectPageValue, largeOverviewPageValue, largeOthersExpandedValue
        )
    }

    func apply(_ selection: String) {
        let defaults = UserDefaults.standard
        lock.lock()
        defer { lock.unlock() }

        if selection.hasPrefix("quota-detail:") {
            let rawSlot = String(selection.dropFirst("quota-detail:".count))
            if let slot = WidgetSlot(rawValue: rawSlot) {
                let key = "quotaDetail.\(slot.rawValue)"
                let now = Date().timeIntervalSince1970
                if let active = quotaDetailUntil[key], active > now {
                    quotaDetailUntil.removeValue(forKey: key)
                    defaults.removeObject(forKey: key)
                } else {
                    let until = now + 3.0
                    quotaDetailUntil[key] = until
                    defaults.set(until, forKey: key)
                }
            }
        } else if let period = UsagePeriod(rawValue: selection) {
            modelPeriodValue = period
            defaults.set(period.rawValue, forKey: "modelPeriod")
        } else if selection.hasPrefix("large:"), let period = UsagePeriod(rawValue: String(selection.dropFirst(6))) {
            largePeriodValue = period
            largeProjectPageValue = 0
            largeOverviewPageValue = 0
            defaults.set(period.rawValue, forKey: "largePeriod")
            defaults.removeObject(forKey: "largeProjectPage")
            defaults.removeObject(forKey: "largeOverviewPage")
        } else if selection == "project" || selection == "model" {
            largeProjectRankingValue = (selection == "project")
            largeProjectIDValue = nil
            largeProjectPageValue = 0
            largeOthersExpandedValue = false
            largeOverviewPageValue = 0
            defaults.set(largeProjectRankingValue, forKey: "largeProjectRanking")
            for key in ["largeProjectID", "largeProjectPage", "largeOthersExpanded", "largeOverviewPage"] {
                defaults.removeObject(forKey: key)
            }
        } else if selection == "others" {
            largeOthersExpandedValue = true
            largeOverviewPageValue = 0
            defaults.set(true, forKey: "largeOthersExpanded")
            defaults.removeObject(forKey: "largeOverviewPage")
        } else if selection == "back-project" {
            largeProjectIDValue = nil
            defaults.removeObject(forKey: "largeProjectID")
        } else if selection.hasPrefix("project:") {
            let id = String(selection.dropFirst(8))
            largeProjectIDValue = id
            largeProjectPageValue = 0
            defaults.set(id, forKey: "largeProjectID")
            defaults.removeObject(forKey: "largeProjectPage")
        } else if selection.hasPrefix("page:"), let page = Int(selection.dropFirst(5)), page >= 0 {
            largeProjectPageValue = page
            defaults.set(page, forKey: "largeProjectPage")
        } else if selection.hasPrefix("overview:"), let page = Int(selection.dropFirst(9)), page >= 0 {
            largeOverviewPageValue = page
            defaults.set(page, forKey: "largeOverviewPage")
        }
    }
}

struct SelectModelPeriod: AppIntent {
    static let title: LocalizedStringResource = "切换模型用量周期"
    static let openAppWhenRun = false

    @Parameter(title: "统计周期") var selection: String

    init() {}
    init(period: UsagePeriod) { selection = period.rawValue }
    init(selection: String) { self.selection = selection }

    func perform() async throws -> some IntentResult {
        if selection == "refresh" {
            WidgetSnapshotCache.shared.invalidateStatWindow()
            return .result()
        }
        WidgetStateStore.shared.apply(selection)
        return .result()
    }
}

struct ModelUsage: Codable {
    struct Tokens: Codable { let total: Int }
    let name: String
    let tokens: Tokens
    var id: String? = nil
    var threads: [ModelUsage]? = nil
}

struct ModelPeriods: Codable {
    let today: [ModelUsage]
    let week: [ModelUsage]
    let month: [ModelUsage]
}

struct PreparedChartPeriod: Codable {
    let shortTotal: String?
    let exactTotal: String?
    let models: PreparedChart?
    let projects: PreparedChart?
}

struct PreparedChart: Codable {
    struct Arc: Codable, Equatable {
        let start: Double
        let end: Double
        let width: CGFloat
        let tone: Double
    }

    struct Row: Codable {
        let id: String?
        let name: String
        let short: String
        let exact: String
        let dot: CGFloat
        let tone: Double?

        init(_ row: ModelUsage, dot: CGFloat = 0, tone: Double? = nil) {
            id = row.id
            name = row.id == nil && row.name.hasPrefix("<external_") ? "未命名对话" : row.name
            short = tokens(row.tokens.total)
            exact = row.tokens.total.formatted()
            self.dot = dot
            self.tone = tone
        }
    }

    let rows: [Row]
    let arcs: [Arc]?
}

struct UsageSnapshot: Codable {
    let capturedAt: TimeInterval
    let dayEndsAt: TimeInterval
    let weekEndsAt: TimeInterval
    let monthEndsAt: TimeInterval
    let today: Int
    let week: Int
    let month: Int
    let quotaPercent: Int?
    var quotaRemaining: Double? = nil
    var quotaBaseline: Double? = nil
    let quotaEndsAt: TimeInterval?
    let models: ModelPeriods?
    let projects: ModelPeriods?
    var charts: [String: PreparedChartPeriod]? = nil

    static func read() -> Self? {
        WidgetSnapshotCache.shared.read()
    }
}

private final class WidgetSnapshotCache: @unchecked Sendable {
    static let shared = WidgetSnapshotCache()
    private static let projectionFormat = 1
    private static let statCoalesceWindow: TimeInterval = 2.0

    private struct Version: Codable, Equatable {
        let inode: UInt64
        let size: UInt64
        let modified: Date

        init?(_ url: URL) {
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
                  let inode = attributes[.systemFileNumber] as? NSNumber,
                  let size = attributes[.size] as? NSNumber,
                  let modified = attributes[.modificationDate] as? Date else { return nil }
            self.inode = inode.uint64Value
            self.size = size.uint64Value
            self.modified = modified
        }
    }

    private struct Projection: Codable {
        let format: Int
        let version: Version
        let savedAt: Date
        let snapshot: UsageSnapshot
    }

    private let lock = NSLock()
    private let fileURL: URL? = {
        guard let user = getpwuid(getuid()) else { return nil }
        return URL(fileURLWithPath: String(cString: user.pointee.pw_dir))
            .appending(path: "Library/Application Support/com.ccusage.codex.desktop/widget-usage.json")
    }()
    private let cacheURL: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appending(path: "usage-codex-projection-v1.plist")
    private var cached: (version: Version, checkedAt: TimeInterval, snapshot: UsageSnapshot)? = nil

    func invalidateStatWindow() {
        lock.lock()
        defer { lock.unlock() }
        if let existing = cached {
            cached = (existing.version, 0, existing.snapshot)
        }
    }

    func read() -> UsageSnapshot? {
        guard let url = fileURL else { return nil }
        let uptime = ProcessInfo.processInfo.systemUptime
        lock.lock()
        defer { lock.unlock() }

        if let existing = cached, uptime - existing.checkedAt < Self.statCoalesceWindow {
            return existing.snapshot
        }

        guard let version = Version(url) else {
            cached = nil
            guard let bytes = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder().decode(UsageSnapshot.self, from: bytes)
        }
        if let existing = cached, existing.version == version {
            cached = (version, uptime, existing.snapshot)
            return existing.snapshot
        }

        if let cacheURL, let data = try? Data(contentsOf: cacheURL),
           let saved = try? PropertyListDecoder().decode(Projection.self, from: data) {
            if Date().timeIntervalSince(saved.savedAt) < 24 * 60 * 60 {
                if saved.format == Self.projectionFormat, saved.version == version {
                    cached = (version, uptime, saved.snapshot)
                    return saved.snapshot
                }
            } else {
                try? FileManager.default.removeItem(at: cacheURL)
            }
        }

        guard let bytes = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(UsageSnapshot.self, from: bytes) else { return nil }
        if Version(url) == version {
            cached = (version, uptime, snapshot)
            if let cacheURL {
                let record = Projection(format: Self.projectionFormat, version: version, savedAt: Date(), snapshot: snapshot)
                let encoder = PropertyListEncoder()
                encoder.outputFormat = .binary
                if let data = try? encoder.encode(record) {
                    try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? data.write(to: cacheURL, options: .atomic)
                }
            }
        }
        return snapshot
    }
}

struct UsageEntry: TimelineEntry {
    var date: Date
    let snapshot: UsageSnapshot?
    let modelPeriod: UsagePeriod
    var projectRanking = false
    var expandedProjectID: String? = nil
    var projectPage = 0
    var overviewPage = 0
    var othersExpanded = false
    var slot: WidgetSlot = .small
    var quotaDetailUntil: TimeInterval? = nil

    var now: TimeInterval { date.timeIntervalSince1970 }
    var quotaExpanded: Bool {
        guard let until = quotaDetailUntil else { return false }
        return until > now
    }
    var today: Int? { snapshot.flatMap { now < $0.dayEndsAt ? $0.today : nil } }
    var week: Int? { snapshot.flatMap { now < $0.weekEndsAt ? $0.week : nil } }
    var month: Int? { snapshot.flatMap { now < $0.monthEndsAt ? $0.month : nil } }
    var quotaRemaining: Double? {
        snapshot.flatMap {
            guard now < ($0.quotaEndsAt ?? 0) else { return nil }
            return $0.quotaRemaining ?? $0.quotaPercent.map(Double.init)
        }
    }
    var quotaBaseline: Double? {
        guard quotaRemaining != nil else { return nil }
        return snapshot?.quotaBaseline
    }
    var quotaEndsAt: TimeInterval? {
        guard quotaRemaining != nil else { return nil }
        return snapshot?.quotaEndsAt
    }

    var models: [ModelUsage]? {
        let periods = projectRanking ? snapshot?.projects : snapshot?.models
        switch modelPeriod {
        case .today: return today == nil ? nil : periods?.today
        case .week: return week == nil ? nil : periods?.week
        case .month: return month == nil ? nil : periods?.month
        }
    }

    func total(for period: UsagePeriod) -> Int? {
        switch period {
        case .today: today
        case .week: week
        case .month: month
        }
    }

    func totalLabel(for period: UsagePeriod) -> String {
        guard let total = total(for: period) else { return "—" }
        return snapshot?.charts?[period.rawValue]?.shortTotal ?? tokens(total)
    }

    func exactTotalLabel(for period: UsagePeriod) -> String {
        guard let total = total(for: period) else { return "待更新" }
        let exact = snapshot?.charts?[period.rawValue]?.exactTotal ?? total.formatted()
        return "\(exact) tokens"
    }

    var preparedChart: PreparedChart? {
        guard total(for: modelPeriod) != nil, let period = snapshot?.charts?[modelPeriod.rawValue] else { return nil }
        return projectRanking ? period.projects : period.models
    }

    var modelTotal: Int { total(for: modelPeriod) ?? 0 }

    func rankedRows(limit: Int) -> [ModelUsage] {
        let rows = (models ?? []).filter { $0.tokens.total > 0 }
        guard rows.count > limit else { return rows }
        let other = rows.dropFirst(limit - 1).reduce(0) { $0 + $1.tokens.total }
        return Array(rows.prefix(limit - 1)) + [
            ModelUsage(name: projectRanking ? "其他项目" : "其他模型", tokens: .init(total: other))
        ]
    }
}

struct UsageProvider: TimelineProvider {
    private func entry(at date: Date, family: WidgetFamily) -> UsageEntry {
        let state = WidgetStateStore.shared
        let slot = WidgetSlot(family: family)
        let snapshot = UsageSnapshot.read()
        let until = state.quotaUntil(for: slot)
        guard family == .systemLarge else {
            return UsageEntry(
                date: date, snapshot: snapshot, modelPeriod: state.modelPeriod,
                slot: slot, quotaDetailUntil: until
            )
        }
        let large = state.largeState()
        return UsageEntry(
            date: date, snapshot: snapshot, modelPeriod: large.period,
            projectRanking: large.projectRanking, expandedProjectID: large.projectID,
            projectPage: large.projectPage, overviewPage: large.overviewPage,
            othersExpanded: large.othersExpanded, slot: slot, quotaDetailUntil: until
        )
    }

    func placeholder(in context: Context) -> UsageEntry {
        let now = Date()
        let time = now.timeIntervalSince1970
        let models = [
            ModelUsage(name: "GPT-5.4", tokens: .init(total: 1_680_000)),
            ModelUsage(name: "GPT-5.3", tokens: .init(total: 550_000)),
            ModelUsage(name: "GPT-5.3 mini", tokens: .init(total: 120_000))
        ]
        return UsageEntry(
            date: now,
            snapshot: UsageSnapshot(
                capturedAt: time, dayEndsAt: time + 86400, weekEndsAt: time + 86400,
                monthEndsAt: time + 86400, today: 2_350_000, week: 112_000_000,
                month: 325_000_000, quotaPercent: 74, quotaRemaining: 74, quotaBaseline: 86,
                quotaEndsAt: time + 86400 * 3,
                models: ModelPeriods(today: models, week: [], month: []),
                projects: nil
            ),
            modelPeriod: .today,
            slot: WidgetSlot(family: context.family)
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (UsageEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : entry(at: Date(), family: context.family))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UsageEntry>) -> Void) {
        let now = Date()
        let current = entry(at: now, family: context.family)
        let snapshot = current.snapshot
        let nextPoll = now.addingTimeInterval(15 * 60)
        let boundaries = [
            snapshot?.dayEndsAt, snapshot?.weekEndsAt, snapshot?.monthEndsAt,
            snapshot?.quotaEndsAt, current.quotaExpanded ? current.quotaDetailUntil : nil
        ]
        let changes = Set(boundaries.compactMap { $0 }).sorted()
            .map(Date.init(timeIntervalSince1970:))
            .filter { $0 > now && $0 <= nextPoll }
        let entries = [current] + changes.map { date in
            var updated = current
            updated.date = date
            return updated
        }
        completion(Timeline(entries: entries, policy: .after(nextPoll)))
    }
}

private func tokens(_ count: Int?) -> String {
    guard let count else { return "—" }
    if count >= 100_000_000 {
        return (Double(count) / 100_000_000).formatted(.number.precision(.fractionLength(2))) + " 亿"
    }
    if count >= 10_000_000 {
        return (Double(count) / 10_000).formatted(.number.precision(.fractionLength(0))) + " 万"
    }
    if count >= 10_000 {
        return (Double(count) / 10_000).formatted(.number.precision(.fractionLength(1))) + " 万"
    }
    return count.formatted()
}

private func resetCountdown(until resetAt: TimeInterval?, at now: TimeInterval) -> String? {
    guard let resetAt, resetAt > now else { return nil }
    let minutes = Int(ceil((resetAt - now) / 60))
    if minutes >= 1440 {
        return "\(minutes / 1440)天\(minutes % 1440 / 60)小时后重置"
    }
    if minutes >= 60 {
        return "\(minutes / 60)小时\(minutes % 60)分钟后重置"
    }
    return "\(minutes)分钟后重置"
}

private struct StableWidgetButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
    }
}

private extension View {
    // Keep the visible label outside Button(intent:) so WidgetKit's host highlight only hits Color.clear.
    func widgetIntentOverlay(
        _ selection: String, label: String, value: String? = nil, selected: Bool = false, enabled: Bool = true
    ) -> some View {
        accessibilityHidden(true)
            .overlay {
                if enabled {
                    Button(intent: SelectModelPeriod(selection: selection)) {
                        Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(StableWidgetButtonStyle())
                    .accessibilityLabel(label)
                    .accessibilityValue(value ?? "")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
    }

    func withoutWidgetAnimation() -> some View {
        contentTransition(.identity)
            .transition(.identity)
            .transaction { transaction in
                transaction.animation = nil
                transaction.disablesAnimations = true
            }
    }
}

private struct WeeklyQuotaBar: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: UsageEntry
    var inline = false
    var prominent = false

    private static func formatPercent(_ value: Double) -> String {
        if value < 0.005 { return "0%" }
        let decimals = value < 1 ? 2 : 1
        return value.formatted(.number.precision(.fractionLength(0...decimals))) + "%"
    }

    private var breakdown: (
        remain: Double, today: Double, weekPrior: Double,
        remainText: String, todayText: String, weekText: String
    ) {
        let remain = min(100, max(0, entry.quotaRemaining ?? 0))
        let prev = min(100, max(remain, entry.quotaBaseline ?? remain))
        let today = max(0, prev - remain)
        let weekPrior = max(0, 100 - prev)
        let todayText = entry.quotaBaseline == nil ? "—" : Self.formatPercent(today)
        return (
            remain, today, weekPrior,
            Self.formatPercent(remain),
            todayText,
            Self.formatPercent(weekPrior)
        )
    }

    private func segmentFill(part: Int, color: Color, expanded: Bool, hasCurrent: Bool) -> AnyShapeStyle {
        let fullColor = renderingMode == .fullColor
        switch part {
        case 0:
            guard hasCurrent else { return AnyShapeStyle(.clear) }
            return fullColor
                ? AnyShapeStyle(color.opacity(expanded ? 0.38 : 1.0))
                : AnyShapeStyle(.primary.opacity(expanded ? 0.24 : 0.78))
        case 1:
            guard hasCurrent else { return AnyShapeStyle(.clear) }
            return fullColor
                ? AnyShapeStyle(color.opacity(expanded ? 0.20 : 0.42))
                : AnyShapeStyle(.primary.opacity(expanded ? 0.14 : 0.36))
        default:
            return AnyShapeStyle(.primary.opacity(expanded ? 0.07 : 0.12))
        }
    }

    private func morphingParts(
        color: Color, expanded: Bool,
        rowWidth: CGFloat, rowHeight: CGFloat,
        barX0: CGFloat, barWidth: CGFloat, barCenterY: CGFloat,
        barHeight: CGFloat, explodedHeight: CGFloat, fontSize: CGFloat
    ) -> some View {
        let parts = breakdown
        let hasCurrent = entry.quotaRemaining != nil
        let liveFrac = parts.remain / 100
        let endFrac = (parts.remain + parts.today) / 100

        let solidW = hasCurrent && liveFrac > 0 ? min(barWidth, max(barHeight, barWidth * liveFrac)) : 0
        let endW = hasCurrent && endFrac > 0 ? min(barWidth, max(solidW, barWidth * endFrac)) : 0

        let gap: CGFloat = 5
        let minW: CGFloat = min(42, max(28, (rowWidth - gap * 2) / 3))
        let flex = max(0, rowWidth - gap * 2 - minW * 3)
        let expW0 = minW + flex * (parts.remain / 100)
        let expW1 = minW + flex * (parts.today / 100)
        let expW2 = max(minW, rowWidth - gap * 2 - expW0 - expW1)

        let expX0: CGFloat = 0
        let expX1 = expW0 + gap
        let expX2 = expW0 + gap + expW1 + gap
        let expCY = rowHeight * 0.5

        let w0 = expanded ? expW0 : solidW
        let w1 = expanded ? expW1 : endW
        let w2 = expanded ? expW2 : barWidth

        let cx0 = expanded ? (expX0 + expW0 * 0.5) : (barX0 + solidW * 0.5)
        let cx1 = expanded ? (expX1 + expW1 * 0.5) : (barX0 + endW * 0.5)
        let cx2 = expanded ? (expX2 + expW2 * 0.5) : (barX0 + barWidth * 0.5)

        let cy = expanded ? expCY : barCenterY
        let h = expanded ? explodedHeight : barHeight
        let spring = Animation.spring(response: 0.34, dampingFraction: 0.80)

        return ZStack {
            Capsule(style: .continuous)
                .fill(segmentFill(part: 2, color: color, expanded: expanded, hasCurrent: hasCurrent))
                .overlay {
                    Text(parts.weekText)
                        .font(.system(size: fontSize, weight: .medium, design: .rounded))
                        .monospacedDigit().foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.75).padding(.horizontal, 4)
                        .opacity(expanded ? 1 : 0).scaleEffect(expanded ? 1 : 0.75)
                }
                .frame(width: max(0, w2), height: h)
                .position(x: cx2, y: cy)

            Capsule(style: .continuous)
                .fill(segmentFill(part: 1, color: color, expanded: expanded, hasCurrent: hasCurrent))
                .opacity(!expanded && parts.today < 0.005 ? 0 : 1)
                .overlay {
                    Text(parts.todayText)
                        .font(.system(size: fontSize, weight: .semibold, design: .rounded))
                        .monospacedDigit().foregroundStyle(.primary.opacity(0.88))
                        .lineLimit(1).minimumScaleFactor(0.75).padding(.horizontal, 4)
                        .opacity(expanded ? 1 : 0).scaleEffect(expanded ? 1 : 0.75)
                }
                .frame(width: max(0, w1), height: h)
                .position(x: cx1, y: cy)

            Capsule(style: .continuous)
                .fill(segmentFill(part: 0, color: color, expanded: expanded, hasCurrent: hasCurrent))
                .opacity(!expanded && parts.remain < 0.005 ? 0 : 1)
                .overlay {
                    Text(parts.remainText)
                        .font(.system(size: fontSize, weight: .bold, design: .rounded))
                        .monospacedDigit().foregroundStyle(.primary)
                        .lineLimit(1).minimumScaleFactor(0.75).padding(.horizontal, 4)
                        .opacity(expanded ? 1 : 0).scaleEffect(expanded ? 1 : 0.75)
                }
                .frame(width: max(0, w0), height: h)
                .position(x: cx0, y: cy)
        }
        .animation(spring, value: expanded)
        .allowsHitTesting(false)
    }

    var body: some View {
        let color: Color = (entry.quotaRemaining ?? 100) < 20 ? .red : .blue
        let expanded = entry.quotaExpanded
        let parts = breakdown
        let rowHeight: CGFloat = prominent ? 48 : (inline ? 16 : 22)
        let barHeight: CGFloat = prominent ? 8.5 : 4.5

        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            ZStack {
                Group {
                    if prominent {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("官方周余量")
                                    .font(.system(size: 11.5, weight: .medium))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Spacer(minLength: 4)
                                Text(entry.quotaRemaining.map { "\(Int($0.rounded()))%" } ?? "—")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                    .foregroundStyle(color == .red ? .red : .primary)
                                    .monospacedDigit().fixedSize()
                            }
                            .frame(height: 17)
                            Color.clear.frame(height: barHeight)
                            HStack(spacing: 6) {
                                Text(resetCountdown(until: entry.quotaEndsAt, at: entry.now) ?? " ")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Spacer(minLength: 4)
                            }
                            .frame(height: 13)
                        }
                    } else if inline {
                        HStack(spacing: 7) {
                            Text("官方周余量")
                                .font(.system(size: 10.5))
                                .foregroundStyle(.secondary)
                                .frame(width: 64, alignment: .leading)
                            Spacer(minLength: 0)
                            Text(entry.quotaRemaining.map { "\(Int($0.rounded()))%" } ?? "—")
                                .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                                .foregroundStyle(color == .red ? .red : .primary)
                                .monospacedDigit()
                                .frame(width: 34, alignment: .trailing)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Text("官方周余量").foregroundStyle(.secondary).lineLimit(1)
                                Spacer(minLength: 1)
                                Text(entry.quotaRemaining.map { "\(Int($0.rounded()))%" } ?? "—")
                                    .foregroundStyle(color == .red ? .red : .primary)
                                    .fontWeight(.semibold).monospacedDigit().fixedSize()
                            }
                            .font(.system(size: 10.5))
                            .frame(height: 13)
                            Color.clear.frame(height: barHeight)
                        }
                    }
                }
                .contentTransition(.identity)
                .opacity(expanded ? 0 : 1)
                .animation(.easeOut(duration: 0.18), value: expanded)

                morphingParts(
                    color: color,
                    expanded: expanded,
                    rowWidth: w,
                    rowHeight: h,
                    barX0: inline ? 71 : 0,
                    barWidth: inline ? max(20, w - 112) : w,
                    barCenterY: prominent ? ((h - 46.5) * 0.5 + 21 + barHeight * 0.5) : (inline ? h * 0.5 : h - barHeight * 0.5),
                    barHeight: barHeight,
                    explodedHeight: prominent ? 28 : (inline ? 15 : 19),
                    fontSize: prominent ? 12 : (inline ? 9.5 : 10)
                )
            }
            .frame(width: w, height: h)
            .widgetIntentOverlay(
                "quota-detail:\(entry.slot.rawValue)",
                label: "官方周余量",
                value: "\(parts.remainText), \(parts.todayText), \(parts.weekText)",
                selected: expanded,
                enabled: entry.quotaRemaining != nil
            )
        }
        .frame(height: rowHeight)
    }
}

struct UsageWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetContentMargins) private var margins
    let entry: UsageEntry

    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Codex")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 2)
                Text("今日")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            .frame(height: 18)
            .withoutWidgetAnimation()

            Spacer(minLength: 4)

            VStack(alignment: .leading, spacing: 2) {
                Text("今日用量")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                Text(entry.totalLabel(for: .today))
                    .font(.system(size: 25, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)
                    .frame(height: 29, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            .accessibilityValue(entry.exactTotalLabel(for: .today))
            .withoutWidgetAnimation()

            Spacer(minLength: 4)

            Rectangle().fill(.primary.opacity(0.12)).frame(height: 0.5)
                .padding(.bottom, 6)
                .withoutWidgetAnimation()

            WeeklyQuotaBar(entry: entry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    var body: some View {
        ZStack {
            Button(intent: SelectModelPeriod(selection: "refresh")) {
                Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("刷新用量")
            Group {
                if family == .systemLarge {
                    LargeUsageWidgetView(entry: entry)
                } else if family == .systemMedium {
                    BreakdownWidgetView(entry: entry)
                } else {
                    small
                }
            }
            .padding(margins)
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

private struct BreakdownWidgetView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: UsageEntry
    private static let barTones: [Double] = [1.0, 0.72, 0.48]

    private var barTint: Color {
        renderingMode == .fullColor ? .blue : .primary
    }

    private func total(_ period: UsagePeriod) -> some View {
        let selected = period == entry.modelPeriod
        return HStack(spacing: 4) {
            Text(period.fullLabel)
                .font(.system(size: 11, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? .primary : .secondary)
            Spacer(minLength: 0)
            Text(entry.totalLabel(for: period))
                .font(.system(size: 14.5, weight: selected ? .bold : .semibold, design: .rounded))
                .foregroundStyle(.primary.opacity(selected ? 1.0 : 0.84))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.65)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(entry.exactTotalLabel(for: period))
    }

    private var totals: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Codex")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(height: 22, alignment: .leading)
            Spacer(minLength: 5)
            total(.today)
            Spacer(minLength: 4)
            total(.week)
            Spacer(minLength: 4)
            total(.month)
            Spacer(minLength: 0)
        }
        .withoutWidgetAnimation()
    }

    private var tabs: some View {
        HStack(spacing: 2) {
            ForEach(UsagePeriod.allCases, id: \.rawValue) { period in
                let selected = period == entry.modelPeriod
                Text(period.label)
                    .font(.system(size: 11, weight: selected ? .bold : .semibold))
                    .foregroundStyle(selected ? .primary : .secondary)
                    .frame(width: 24, height: 19)
                    .background(
                        .primary.opacity(selected ? 0.16 : 0),
                        in: RoundedRectangle(cornerRadius: 5.5, style: .continuous)
                    )
                    .widgetIntentOverlay(
                        period.rawValue,
                        label: period.fullLabel + "模型用量",
                        selected: selected
                    )
            }
        }
        .padding(1.5)
        .background(.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .withoutWidgetAnimation()
    }

    private func modelRow(_ model: ModelUsage?, tone: Double) -> some View {
        let fraction = model.map { min(1, Double($0.tokens.total) / Double(max(1, entry.modelTotal))) } ?? 0
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(model?.name ?? " ")
                    .font(.system(size: 11, weight: tone >= 0.99 ? .semibold : .regular))
                    .foregroundStyle(.primary.opacity(tone >= 0.99 ? 1 : 0.88))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Text(model.map { tokens($0.tokens.total) } ?? " ")
                    .font(.system(size: 11, weight: tone >= 0.99 ? .semibold : .medium, design: .rounded))
                    .foregroundStyle(.primary.opacity(tone >= 0.99 ? 1 : 0.84))
                    .monospacedDigit()
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .contentTransition(.identity)
            .opacity(model == nil ? 0 : 1)
            GeometryReader { geometry in
                Capsule().fill(.primary.opacity(0.10))
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(barTint.opacity(0.92 * tone))
                            .frame(width: model == nil ? 0 : max(4, geometry.size.width * fraction))
                    }
            }
            .frame(height: 3)
            .opacity(model == nil ? 0 : 1)
            .animation(.smooth(duration: 0.32), value: fraction)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model?.name ?? "")
        .accessibilityValue(model.map { "\($0.tokens.total.formatted()) tokens" } ?? "")
    }

    var body: some View {
        VStack(spacing: 4) {
            GeometryReader { geometry in
                HStack(alignment: .top, spacing: 0) {
                    totals.frame(width: (geometry.size.width - 21) * 0.35, alignment: .leading)
                    Rectangle()
                        .fill(.primary.opacity(0.12))
                        .frame(width: 0.5)
                        .padding(.horizontal, 10)
                        .withoutWidgetAnimation()
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 4) {
                            Text("模型用量")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 0)
                            tabs
                        }
                        .frame(height: 22)
                        .withoutWidgetAnimation()
                        let models = entry.rankedRows(limit: 3)
                        if models.isEmpty {
                            Text(entry.models == nil ? "等待 Usage 更新" : "这段时间暂无用量")
                                .font(.caption).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                                .withoutWidgetAnimation()
                        } else {
                            ForEach(0..<3, id: \.self) { index in
                                modelRow(index < models.count ? models[index] : nil, tone: Self.barTones[index])
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            Rectangle().fill(.primary.opacity(0.12)).frame(height: 0.5)
                .withoutWidgetAnimation()
            WeeklyQuotaBar(entry: entry, inline: true)
        }
    }
}

private func widgetRingShares(_ rows: [ModelUsage]) -> [Double] {
    let total = rows.reduce(0.0) { $0 + Double($1.tokens.total) }
    guard total > 0 else { return [] }
    let shares = rows.map { Double($0.tokens.total) / total }
    if shares.count == 2 {
        let first = min(0.98, max(0.02, shares[0]))
        return [first, 1 - first]
    }
    guard shares.count > 2, let smallest = shares.min(), smallest < 0.022 else {
        return shares
    }
    let weights = shares.map { max(0.032, pow($0, 0.85)) }
    let adjustedTotal = weights.reduce(0, +)
    return weights.map { $0 / adjustedTotal }
}

private struct LargeUsageWidgetView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: UsageEntry
    private static let othersID = "widget-others"
    private static let ringWidths: [CGFloat] = [17.5, 15, 13, 11.2, 9.8, 8.8]
    private static let ringTones: [Double] = [1.0, 0.80, 0.65, 0.54, 0.46, 0.40]
    private static let slotCount = 6

    private func controls(showOthers: Bool, expandedProject: ModelUsage?) -> some View {
        let controlTrack = RoundedRectangle(cornerRadius: 10, style: .continuous)
        return HStack(alignment: .center, spacing: 5) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text("Codex")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Text(entry.modelPeriod.fullLabel)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.tertiary)
                }
                .frame(height: 20)
                Text(entry.totalLabel(for: entry.modelPeriod))
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .frame(height: 23, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 2)
            HStack(spacing: 2) {
                if expandedProject != nil || showOthers {
                    let back = expandedProject != nil ? "back-project" : (entry.projectRanking ? "project" : "model")
                    HStack(spacing: 3) {
                        Image(systemName: "chevron.left").font(.system(size: 10, weight: .bold))
                        Text("返回").font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(.primary)
                    .frame(width: 72, height: 32)
                    .widgetIntentOverlay(back, label: "返回")
                } else {
                    modeButton("项目", projects: true)
                    modeButton("模型", projects: false)
                }
            }
            .padding(2)
            .background(.primary.opacity(0.07), in: controlTrack)
            HStack(spacing: 2) {
                ForEach(UsagePeriod.allCases, id: \.rawValue) { period in
                    periodButton(period)
                }
            }
            .padding(2)
            .background(.primary.opacity(0.07), in: controlTrack)
        }
        .frame(height: 47)
        .withoutWidgetAnimation()
    }

    private func modeButton(_ title: String, projects: Bool) -> some View {
        let selected = entry.projectRanking == projects
        let thumb = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return Text(title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(selected ? .primary : .secondary)
            .frame(width: 35, height: 32)
            .background(.primary.opacity(selected ? 0.16 : 0), in: thumb)
            .widgetIntentOverlay(projects ? "project" : "model", label: title, selected: selected)
    }

    private func periodButton(_ period: UsagePeriod) -> some View {
        let selected = period == entry.modelPeriod
        let thumb = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return VStack(spacing: 1) {
            Text(period.fullLabel)
                .font(.system(size: selected ? 11.5 : 11, weight: selected ? .bold : .semibold))
                .foregroundStyle(selected ? .primary : .secondary)
            if !selected {
                Text(entry.totalLabel(for: period))
                    .font(.system(size: 8.5, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .opacity(0.88)
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
            }
        }
        .padding(.horizontal, 2)
        .frame(width: 46, height: 32)
        .background(.primary.opacity(selected ? 0.16 : 0), in: thumb)
        .widgetIntentOverlay(
            "large:\(period.rawValue)",
            label: period.fullLabel,
            value: entry.exactTotalLabel(for: period),
            selected: selected
        )
    }

    private var expandedProject: ModelUsage? {
        guard entry.projectRanking, let id = entry.expandedProjectID else { return nil }
        return entry.models?.first { $0.id == id }
    }

    private var allRows: [ModelUsage] {
        (entry.models ?? []).filter { $0.tokens.total > 0 }
    }

    private var chartTint: Color {
        renderingMode == .fullColor ? .blue : .primary
    }

    private func rank(of row: ModelUsage, in rows: [ModelUsage]) -> Int {
        min(rows.filter { $0.tokens.total > row.tokens.total }.count, Self.ringWidths.count - 1)
    }

    private func fallbackArcs(from rows: [ModelUsage]) -> [PreparedChart.Arc] {
        let parts = widgetRingShares(rows)
        guard !parts.isEmpty else { return [] }
        let multiple = parts.count > 1
        var position = 0.0
        return rows.indices.map { index in
            let size = parts[index]
            let itemRank = rank(of: rows[index], in: rows)
            let gap = multiple ? min(0.0043, size * 0.25) : 0
            let start = position + gap
            let end = max(start, position + size - gap)
            position += size
            return PreparedChart.Arc(
                start: start, end: end,
                width: Self.ringWidths[itemRank], tone: Self.ringTones[itemRank]
            )
        }
    }

    private func ringSlots(from arcs: [PreparedChart.Arc]) -> [PreparedChart.Arc] {
        guard !arcs.isEmpty else {
            return Array(
                repeating: PreparedChart.Arc(start: 0, end: 0, width: Self.ringWidths.last ?? 8.8, tone: 0),
                count: Self.slotCount
            )
        }
        return (0..<Self.slotCount).map { index in
            if index < arcs.count { return arcs[index] }
            return PreparedChart.Arc(
                start: 1.0, end: 1.0,
                width: Self.ringWidths[min(index, Self.ringWidths.count - 1)], tone: 0
            )
        }
    }

    private func animatedRing(_ arcs: [PreparedChart.Arc]) -> some View {
        let slots = ringSlots(from: arcs)
        return ZStack {
            if arcs.isEmpty {
                Circle()
                    .stroke(.primary.opacity(0.08), lineWidth: 12)
                    .frame(width: 96, height: 96)
            }
            ForEach(0..<Self.slotCount, id: \.self) { index in
                let slot = slots[index]
                Circle()
                    .trim(from: slot.start, to: slot.end)
                    .stroke(
                        chartTint.opacity(0.94 * slot.tone),
                        style: StrokeStyle(lineWidth: slot.width, lineCap: .butt)
                    )
                    .rotationEffect(.degrees(-90))
                    .frame(width: 96, height: 96)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: 118, height: 118)
        .animation(.smooth(duration: 0.36), value: slots)
    }

    private func rowAction(for row: PreparedChart.Row) -> (selection: String, label: String)? {
        if row.id == Self.othersID { return ("others", "展开其余用量") }
        if entry.projectRanking, let id = row.id { return ("project:\(id)", "展开\(row.name)的对话") }
        return nil
    }

    private func ranking(_ rows: [PreparedChart.Row], showMarkers: Bool) -> some View {
        let showTrailingChevron = showMarkers && entry.projectRanking && rows.contains { rowAction(for: $0) != nil }
        return VStack(alignment: .leading, spacing: 0) {
            if rows.isEmpty {
                Text(entry.models == nil ? "等待 Usage 更新" : "这段时间暂无用量")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(rows.indices, id: \.self) { index in
                let row = rows[index]
                let highlighted = showMarkers && index == 0
                let action = rowAction(for: row)
                let tone = row.tone ?? Self.ringTones[min(index, Self.ringTones.count - 1)]
                HStack(spacing: 5.5) {
                    if showMarkers {
                        Circle()
                            .fill(chartTint.opacity(0.94 * tone))
                            .frame(width: row.dot, height: row.dot)
                            .frame(width: 10)
                            .accessibilityHidden(true)
                    }
                    HStack(spacing: 3) {
                        Text(row.name)
                            .font(.system(size: 11, weight: highlighted ? .semibold : .regular))
                            .foregroundStyle(.primary.opacity(highlighted ? 1 : 0.88))
                            .lineLimit(1)
                            .truncationMode(entry.projectRanking ? .tail : .middle)
                        if !showTrailingChevron && action != nil {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 7.5, weight: .semibold))
                                .foregroundStyle(.tertiary)
                                .accessibilityHidden(true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.short)
                        .font(.system(size: 11.5, weight: highlighted ? .semibold : .medium, design: .rounded))
                        .foregroundStyle(.primary.opacity(highlighted ? 1 : 0.86))
                        .monospacedDigit()
                        .fixedSize()
                    if showTrailingChevron {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(.tertiary)
                            .opacity(action == nil ? 0 : 1)
                            .frame(width: 6)
                            .accessibilityHidden(true)
                    }
                }
                .frame(height: 25.5)
                .contentShape(Rectangle())
                .widgetIntentOverlay(
                    action?.selection ?? "",
                    label: action?.label ?? row.name,
                    value: "\(row.exact) tokens",
                    enabled: action != nil
                )
                if index < rows.count - 1 {
                    Rectangle().fill(.primary.opacity(0.10)).frame(height: 0.5)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func projectDetails(_ project: ModelUsage) -> some View {
        let threads = project.threads ?? []
        let pageSize = 6
        let pages = max(1, (threads.count + pageSize - 1) / pageSize)
        let page = min(entry.projectPage, pages - 1)
        let shown = Array(threads.dropFirst(page * pageSize).prefix(pageSize))
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(project.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                Spacer()
                Text(tokens(project.tokens.total))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            }
            Text("\(entry.modelPeriod.fullLabel) · \(threads.count) 个对话")
                .font(.caption2).foregroundStyle(.secondary)
            ForEach(shown.indices, id: \.self) { index in
                let thread = shown[index]
                HStack(spacing: 8) {
                    Text(thread.name).font(.system(size: 12)).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 0)
                    Text(tokens(thread.tokens.total))
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                }
                .frame(minHeight: 16)
            }
            if threads.isEmpty {
                Text("暂无对话明细").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if pages > 1 {
                HStack(spacing: 12) {
                    Spacer()
                    pageButton("chevron.left", label: "上一页", target: max(0, page - 1), enabled: page > 0)
                    Text("\(page + 1)/\(pages)").monospacedDigit()
                    pageButton("chevron.right", label: "下一页", target: min(pages - 1, page + 1), enabled: page + 1 < pages)
                }
                .font(.caption2)
            }
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
    }

    private func pageButton(_ icon: String, label: String, target: Int, enabled: Bool, overview: Bool = false) -> some View {
        Image(systemName: icon)
            .frame(width: 24, height: 18)
            .background(.primary.opacity(0.08), in: Capsule())
            .opacity(enabled ? 1 : 0.35)
            .widgetIntentOverlay("\(overview ? "overview" : "page"):\(target)", label: label, enabled: enabled)
    }

    private func overviewContent(prepared: PreparedChart?, fallbackRows: [ModelUsage]) -> (arcs: [PreparedChart.Arc], rows: [PreparedChart.Row]) {
        if let prepared {
            if let arcs = prepared.arcs { return (arcs, prepared.rows) }
            let leading = Array(fallbackRows.prefix(5))
            let other = fallbackRows.dropFirst(5).reduce(0) { $0 + $1.tokens.total }
            let visible = other > 0
                ? leading + [ModelUsage(name: "其余", tokens: .init(total: other), id: Self.othersID)]
                : leading
            return (fallbackArcs(from: visible), prepared.rows)
        }
        let leading = Array(fallbackRows.prefix(5))
        let other = fallbackRows.dropFirst(5).reduce(0) { $0 + $1.tokens.total }
        let visible = other > 0
            ? leading + [ModelUsage(name: "其余", tokens: .init(total: other), id: Self.othersID)]
            : leading
        let mappedRows: [PreparedChart.Row] = visible.map {
            let r = rank(of: $0, in: visible)
            return .init($0, dot: 4.5 + Self.ringWidths[r] * 0.22, tone: Self.ringTones[r])
        }
        return (fallbackArcs(from: visible), mappedRows)
    }

    private func othersDetails(_ rows: [ModelUsage]) -> some View {
        let remaining = Array(rows.dropFirst(5))
        let pages = max(1, (remaining.count + 5) / 6)
        let page = min(max(0, entry.overviewPage), pages - 1)
        let shown = Array(remaining.dropFirst(page * 6).prefix(6))
        return VStack(alignment: .leading, spacing: 5) {
            Text("其余 · \(remaining.count) 项").font(.caption.weight(.semibold))
            ranking(shown.map { .init($0) }, showMarkers: false)
            Spacer(minLength: 0)
            if pages > 1 {
                HStack(spacing: 12) {
                    Spacer()
                    pageButton("chevron.left", label: "上一页", target: max(0, page - 1), enabled: page > 0, overview: true)
                    Text("\(page + 1)/\(pages)").monospacedDigit()
                    pageButton("chevron.right", label: "下一页", target: min(pages - 1, page + 1), enabled: page + 1 < pages, overview: true)
                }
                .font(.caption2)
            }
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
    }

    private var stageIdentity: String {
        "\(entry.projectRanking):\(entry.modelPeriod.rawValue)"
    }

    var body: some View {
        let prepared = entry.preparedChart
        let needsRawRows = prepared?.arcs == nil || entry.othersExpanded
        let rows = needsRawRows ? allRows : []
        let project = expandedProject
        let showOthers = entry.othersExpanded && rows.count > 5
        VStack(alignment: .leading, spacing: 7) {
            controls(showOthers: showOthers, expandedProject: project)
            if let project {
                projectDetails(project)
                    .id("project:\(project.id ?? project.name):\(entry.modelPeriod.rawValue):\(entry.projectPage)")
                    .withoutWidgetAnimation()
            } else if showOthers {
                othersDetails(rows)
                    .id("others:\(stageIdentity):\(entry.overviewPage)")
                    .withoutWidgetAnimation()
            } else {
                let content = overviewContent(prepared: prepared, fallbackRows: rows)
                HStack(spacing: 10) {
                    animatedRing(content.arcs)
                    ranking(content.rows, showMarkers: true)
                        .id(stageIdentity)
                        .withoutWidgetAnimation()
                }
                .frame(maxHeight: .infinity)
            }
            Rectangle().fill(.primary.opacity(0.14)).frame(height: 0.5)
                .withoutWidgetAnimation()
            WeeklyQuotaBar(entry: entry, prominent: true)
        }
    }
}

@main struct CodexUsageWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CodexUsageWidget", provider: UsageProvider()) { entry in
            UsageWidgetView(entry: entry)
        }
        .configurationDisplayName("Codex 用量")
        .description("本机 token 用量与官方账号周余量。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
