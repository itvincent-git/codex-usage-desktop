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
        UserDefaults.standard.string(forKey: "modelPeriod").flatMap(Self.init(rawValue:)) ?? .today
    }
}

struct SelectModelPeriod: AppIntent {
    static let title: LocalizedStringResource = "切换模型用量周期"

    @Parameter(title: "统计周期") var selection: String

    init() {}
    init(period: UsagePeriod) { selection = period.rawValue }
    init(selection: String) { self.selection = selection }

    func perform() async throws -> some IntentResult {
        if let period = UsagePeriod(rawValue: selection) {
            UserDefaults.standard.set(period.rawValue, forKey: "modelPeriod")
        } else if selection.hasPrefix("large:"), let period = UsagePeriod(rawValue: String(selection.dropFirst(6))) {
            UserDefaults.standard.set(period.rawValue, forKey: "largePeriod")
            UserDefaults.standard.removeObject(forKey: "largeProjectPage")
            UserDefaults.standard.removeObject(forKey: "largeOverviewPage")
        } else if selection == "project" || selection == "model" {
            UserDefaults.standard.set(selection == "project", forKey: "largeProjectRanking")
            UserDefaults.standard.removeObject(forKey: "largeProjectID")
            UserDefaults.standard.removeObject(forKey: "largeProjectPage")
            UserDefaults.standard.removeObject(forKey: "largeOthersExpanded")
            UserDefaults.standard.removeObject(forKey: "largeOverviewPage")
        } else if selection == "others" {
            UserDefaults.standard.set(true, forKey: "largeOthersExpanded")
            UserDefaults.standard.removeObject(forKey: "largeOverviewPage")
        } else if selection == "back-project" {
            UserDefaults.standard.removeObject(forKey: "largeProjectID")
        } else if selection.hasPrefix("project:") {
            UserDefaults.standard.set(String(selection.dropFirst(8)), forKey: "largeProjectID")
            UserDefaults.standard.removeObject(forKey: "largeProjectPage")
        } else if selection.hasPrefix("page:"), let page = Int(selection.dropFirst(5)), page >= 0 {
            UserDefaults.standard.set(page, forKey: "largeProjectPage")
        } else if selection.hasPrefix("overview:"), let page = Int(selection.dropFirst(9)), page >= 0 {
            UserDefaults.standard.set(page, forKey: "largeOverviewPage")
        }
        return .result()
    }
}

struct ModelUsage: Decodable {
    struct Tokens: Decodable { let total: Int }
    let name: String
    let tokens: Tokens
    var id: String? = nil
    var threads: [ModelUsage]? = nil
}

struct ModelPeriods: Decodable {
    let today: [ModelUsage]
    let week: [ModelUsage]
    let month: [ModelUsage]
}

struct UsageSnapshot: Decodable {
    let capturedAt: TimeInterval
    let dayEndsAt: TimeInterval
    let weekEndsAt: TimeInterval
    let monthEndsAt: TimeInterval
    let today: Int
    let week: Int
    let month: Int
    let quotaPercent: Int?
    let quotaEndsAt: TimeInterval?
    let models: ModelPeriods?
    let projects: ModelPeriods?

    static func read() -> Self? {
        guard let user = getpwuid(getuid()) else { return nil }
        let home = String(cString: user.pointee.pw_dir)
        let file = URL(fileURLWithPath: home)
            .appending(path: "Library/Application Support/com.ccusage.codex.desktop/widget-usage.json")
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }
}

struct UsageEntry: TimelineEntry {
    let date: Date
    let snapshot: UsageSnapshot?
    let modelPeriod: UsagePeriod
    var projectRanking = false
    var expandedProjectID: String? = nil
    var projectPage = 0
    var overviewPage = 0
    var othersExpanded = false

    var now: TimeInterval { date.timeIntervalSince1970 }
    var today: Int? { snapshot.flatMap { now < $0.dayEndsAt ? $0.today : nil } }
    var week: Int? { snapshot.flatMap { now < $0.weekEndsAt ? $0.week : nil } }
    var month: Int? { snapshot.flatMap { now < $0.monthEndsAt ? $0.month : nil } }
    var quota: Int? {
        snapshot.flatMap { now < ($0.quotaEndsAt ?? 0) ? $0.quotaPercent : nil }
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
    private func entry(at date: Date, snapshot: UsageSnapshot?, family: WidgetFamily) -> UsageEntry {
        guard family == .systemLarge else {
            return UsageEntry(date: date, snapshot: snapshot, modelPeriod: .selected)
        }
        let defaults = UserDefaults.standard
        let period = defaults.string(forKey: "largePeriod").flatMap(UsagePeriod.init(rawValue:)) ?? .today
        let projects = defaults.object(forKey: "largeProjectRanking") as? Bool ?? true
        return UsageEntry(date: date, snapshot: snapshot, modelPeriod: period, projectRanking: projects,
                          expandedProjectID: defaults.string(forKey: "largeProjectID"),
                          projectPage: defaults.integer(forKey: "largeProjectPage"),
                          overviewPage: defaults.integer(forKey: "largeOverviewPage"),
                          othersExpanded: defaults.bool(forKey: "largeOthersExpanded"))
    }

    func placeholder(in context: Context) -> UsageEntry {
        let now = Date()
        let time = now.timeIntervalSince1970
        let models = [
            ModelUsage(name: "GPT-5.5", tokens: .init(total: 1_680_000)),
            ModelUsage(name: "GPT-5.4", tokens: .init(total: 550_000)),
            ModelUsage(name: "GPT-5.4 mini", tokens: .init(total: 120_000))
        ]
        return UsageEntry(date: now, snapshot: UsageSnapshot(
            capturedAt: time, dayEndsAt: time + 86400, weekEndsAt: time + 86400,
            monthEndsAt: time + 86400, today: 2_350_000, week: 112_000_000,
            month: 325_000_000, quotaPercent: 74, quotaEndsAt: time + 86400,
            models: ModelPeriods(today: models, week: [], month: []),
            projects: nil
        ), modelPeriod: .today)
    }

    func getSnapshot(in context: Context, completion: @escaping (UsageEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context)
            : entry(at: Date(), snapshot: .read(), family: context.family))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UsageEntry>) -> Void) {
        let now = Date()
        let snapshot = UsageSnapshot.read()
        let nextPoll = now.addingTimeInterval(15 * 60)
        let boundaries = [snapshot?.dayEndsAt, snapshot?.weekEndsAt,
                          snapshot?.monthEndsAt, snapshot?.quotaEndsAt]
        let changes = Set(boundaries.compactMap { $0 }).sorted()
            .map(Date.init(timeIntervalSince1970:))
            .filter { $0 > now && $0 <= nextPoll }
        completion(Timeline(
            entries: ([now] + changes).map { entry(at: $0, snapshot: snapshot, family: context.family) },
            policy: .after(nextPoll)
        ))
    }
}

private func tokens(_ count: Int?) -> String {
    guard let count else { return "—" }
    if count >= 100_000_000 {
        return (Double(count) / 100_000_000).formatted(.number.precision(.fractionLength(2))) + " 亿"
    }
    if count >= 10_000 {
        return (Double(count) / 10_000).formatted(.number.precision(.fractionLength(1))) + " 万"
    }
    return count.formatted()
}

struct UsageWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: UsageEntry

    private func usage(_ label: String, _ value: Int?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(tokens(value))
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.55)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(value.map { "\($0.formatted()) tokens" } ?? "待更新")
    }

    private var quota: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 4) {
                Text("官方周余量").foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Text(entry.quota.map { "\($0)%" } ?? "—").fontWeight(.semibold).monospacedDigit()
            }
            .font(.caption)
            if let value = entry.quota {
                ProgressView(value: Double(value), total: 100)
                    .tint(value < 20 ? .red : .blue)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Codex 用量", systemImage: "chart.bar.xaxis")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 2)
            usage("本机今日 tokens", entry.today)
            Spacer(minLength: 2)
            quota
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    var body: some View {
        Group {
            if family == .systemLarge {
                LargeUsageWidgetView(entry: entry)
            } else if family == .systemMedium {
                BreakdownWidgetView(entry: entry)
            } else {
                small
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

private struct BreakdownWidgetView: View {
    let entry: UsageEntry
    private let modelColors: [Color] = [.blue, .teal, .purple]

    private func total(_ label: String, _ count: Int?) -> some View {
        HStack(spacing: 5) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text(tokens(count))
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(count.map { "\($0.formatted()) tokens" } ?? "待更新")
    }

    private var totals: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("本机用量")
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                .frame(height: 24, alignment: .leading)
            Spacer(minLength: 5)
            total("今日", entry.today)
            Spacer(minLength: 5)
            total("本周", entry.week)
            Spacer(minLength: 5)
            total("本月", entry.month)
            Spacer(minLength: 0)
        }
    }

    private var tabs: some View {
        HStack(spacing: 1) {
            ForEach(UsagePeriod.allCases, id: \.rawValue) { period in
                let selected = period == entry.modelPeriod
                Button(intent: SelectModelPeriod(period: period)) {
                    Text(period.label)
                        .font(.system(size: 11, weight: selected ? .bold : .medium))
                        .foregroundStyle(selected ? .primary : .secondary)
                        .frame(width: 26, height: 22)
                        .background {
                            if selected { Capsule().fill(.primary.opacity(0.14)) }
                        }
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(period.fullLabel + "模型用量")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .buttonStyle(.plain)
        .padding(1)
        .background(.primary.opacity(0.06), in: Capsule())
    }

    private func modelRow(_ model: ModelUsage, tint: Color) -> some View {
        let fraction = min(1, Double(model.tokens.total) / Double(max(1, entry.modelTotal)))
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(model.name).font(.system(size: 12, weight: .medium))
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 0)
                Text(tokens(model.tokens.total)).font(.system(size: 12, weight: .semibold, design: .rounded))
                    .monospacedDigit().lineLimit(1).fixedSize(horizontal: true, vertical: false)
            }
            GeometryReader { geometry in
                Capsule().fill(.primary.opacity(0.1))
                    .overlay(alignment: .leading) {
                        Capsule().fill(tint)
                            .frame(width: max(3, geometry.size.width * fraction))
                    }
            }
            .frame(height: 3)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.name)
        .accessibilityValue("\(model.tokens.total.formatted()) tokens")
    }

    var body: some View {
        GeometryReader { geometry in
            HStack(alignment: .top, spacing: 0) {
                totals.frame(width: (geometry.size.width - 25) / 3, alignment: .leading)
                Divider().padding(.horizontal, 12)
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 4) {
                        Text("模型用量").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        tabs
                    }
                    .frame(height: 24)
                    let models = entry.rankedRows(limit: 3)
                    if models.isEmpty {
                        Text(entry.models == nil ? "等待 Usage 更新" : "这段时间暂无用量")
                            .font(.caption).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    } else {
                        ForEach(models.indices, id: \.self) { index in
                            modelRow(models[index], tint: modelColors[index])
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

}

private struct LargeUsageWidgetView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: UsageEntry
    private static let othersID = "widget-others"

    private var controls: some View {
        HStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 3) {
                Text("本机\(entry.modelPeriod.fullLabel)")
                    .font(.caption2).foregroundStyle(.secondary)
                Text(tokens(entry.total(for: entry.modelPeriod)))
                    .font(.system(size: 21, weight: .semibold, design: .rounded))
                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            HStack(spacing: 2) {
                if expandedProject != nil || showOthers {
                    let back = expandedProject != nil ? "back-project" : (entry.projectRanking ? "project" : "model")
                    Button(intent: SelectModelPeriod(selection: back)) {
                        Label("返回", systemImage: "chevron.left").font(.caption.weight(.semibold))
                            .padding(.horizontal, 7).frame(height: 28)
                    }
                } else {
                    modeButton("项目", projects: true)
                    modeButton("模型", projects: false)
                }
            }
            .padding(2)
            .background(.primary.opacity(0.07), in: Capsule())
            HStack(spacing: 2) {
                ForEach(UsagePeriod.allCases, id: \.rawValue) { period in
                    let selected = period == entry.modelPeriod
                    Button(intent: SelectModelPeriod(selection: "large:\(period.rawValue)")) {
                        VStack(spacing: 2) {
                            Text(period.fullLabel)
                                .font(.system(size: 11, weight: selected ? .bold : .medium))
                            if !selected {
                                Text(tokens(entry.total(for: period)))
                                    .font(.system(size: 9, weight: .medium)).monospacedDigit()
                                    .lineLimit(1).minimumScaleFactor(0.7)
                            }
                        }
                        .foregroundStyle(selected ? .primary : .secondary)
                        .frame(width: 43, height: 32)
                        .background { if selected { RoundedRectangle(cornerRadius: 8).fill(.primary.opacity(0.14)) } }
                        .contentShape(Rectangle())
                    }
                    .accessibilityLabel(period.fullLabel)
                    .accessibilityValue(entry.total(for: period).map { "\($0.formatted()) tokens" } ?? "待更新")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(2)
            .background(.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func modeButton(_ title: String, projects: Bool) -> some View {
        let selected = entry.projectRanking == projects
        return Button(intent: SelectModelPeriod(selection: projects ? "project" : "model")) {
            Text(title).font(.system(size: 12, weight: selected ? .bold : .medium))
                .foregroundStyle(selected ? .primary : .secondary)
                .frame(width: 29, height: 28)
                .background { if selected { Capsule().fill(.primary.opacity(0.14)) } }
                .contentShape(Rectangle())
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var expandedProject: ModelUsage? {
        guard entry.projectRanking, let id = entry.expandedProjectID else { return nil }
        return entry.models?.first { $0.id == id }
    }

    private var allRows: [ModelUsage] {
        (entry.models ?? []).filter { $0.tokens.total > 0 }
    }

    private var showOthers: Bool {
        entry.othersExpanded && allRows.count > 5
    }

    private var chartTint: Color {
        renderingMode == .fullColor ? .blue : .primary
    }

    private func segmentWidth(for row: ModelUsage, in rows: [ModelUsage]) -> CGFloat {
        let widths: [CGFloat] = [20, 16, 10, 6, 3.5, 2]
        let larger = rows.filter { $0.tokens.total > row.tokens.total }.count
        return widths[min(larger, widths.count - 1)]
    }

    private func ringShares(_ rows: [ModelUsage]) -> [Double] {
        let total = Double(max(1, entry.modelTotal))
        let shares = rows.map { Double($0.tokens.total) / total }
        guard rows.count > 1, let largest = shares.max(), let smallest = shares.min() else {
            return shares
        }

        let maximumShare = 0.63
        let hasTinyTail = smallest < 0.003 || shares.filter { $0 < 0.012 }.count >= 2
        let minimumShare = hasTinyTail ? 0.035 : 0.0
        guard largest > maximumShare || hasTinyTail else { return shares }

        // Softmax over log usage with an adaptive temperature. Scaling by the largest share
        // keeps the largest weight at 1 and avoids exponentiating raw token counts.
        let relative = shares.map { $0 / largest }
        let smallestRelative = smallest / largest
        var low = 0.0
        var high = 1.0
        for _ in 0..<20 {
            let exponent = (low + high) / 2
            let sum = relative.reduce(0.0) { $0 + pow($1, exponent) }
            let largestAdjusted = 1 / sum
            let smallestAdjusted = pow(smallestRelative, exponent) / sum
            if largestAdjusted > maximumShare || smallestAdjusted < minimumShare {
                high = exponent
            } else {
                low = exponent
            }
        }
        let weights = relative.map { pow($0, low) }
        let sum = weights.reduce(0, +)
        return weights.map { $0 / sum }
    }

    private func usageRing(_ rows: [ModelUsage]) -> some View {
        let edges = ringShares(rows).reduce(into: [0.0]) { edges, share in
            edges.append(min(1, (edges.last ?? 0) + share))
        }
        return ZStack {
            ForEach(rows.indices, id: \.self) { index in
                let start = edges[index]
                let end = edges[index + 1]
                let gap = rows.count > 1 ? min(0.009, (end - start) / 4) : 0
                Circle().trim(from: start + gap, to: end - gap)
                    .stroke(chartTint.opacity(0.85), lineWidth: segmentWidth(for: rows[index], in: rows))
                    .rotationEffect(.degrees(-90))
                    .frame(width: 88, height: 88)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: 112, height: 112)
    }

    @ViewBuilder
    private func projectLink<Content: View>(_ row: ModelUsage, @ViewBuilder content: () -> Content) -> some View {
        if row.id == Self.othersID {
            Button(intent: SelectModelPeriod(selection: "others"), label: content)
                .buttonStyle(.plain)
                .accessibilityLabel("展开其余用量")
        } else if entry.projectRanking, let id = row.id {
            Button(intent: SelectModelPeriod(selection: "project:\(id)"), label: content)
                .buttonStyle(.plain)
                .accessibilityLabel("展开\(row.name)的对话")
        } else {
            content()
        }
    }

    private func ranking(_ rows: [ModelUsage], showMarkers: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if rows.isEmpty {
                Text(entry.models == nil ? "等待 Usage 更新" : "这段时间暂无用量")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(rows.indices, id: \.self) { index in
                let row = rows[index]
                let highlighted = showMarkers && index == 0
                let label = row.id == nil && row.name.hasPrefix("<external_") ? "未命名对话" : row.name
                projectLink(row) {
                    HStack(spacing: 6) {
                        if showMarkers {
                            let diameter = 2 + segmentWidth(for: row, in: rows) * 0.54
                            Circle().fill(chartTint.opacity(0.85))
                                .frame(width: diameter, height: diameter)
                                .frame(width: 15)
                                .accessibilityHidden(true)
                        }
                        Text(label)
                            .font(.system(size: 11, weight: highlighted ? .semibold : .regular))
                            .lineLimit(2).truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(tokens(row.tokens.total))
                            .font(.caption.weight(highlighted ? .semibold : .medium))
                            .monospacedDigit().fixedSize()
                        if entry.projectRanking || row.id == Self.othersID {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 8)).foregroundStyle(.secondary)
                                .opacity(row.id == nil ? 0 : 1)
                                .accessibilityHidden(true)
                        }
                    }
                    .frame(minHeight: 29)
                    .contentShape(Rectangle())
                    .accessibilityValue("\(row.tokens.total.formatted()) tokens")
                }
                if index < rows.count - 1 {
                    Divider().opacity(0.5)
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
        return VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(project.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                Spacer()
                Text(tokens(project.tokens.total)).font(.system(size: 15, weight: .semibold)).monospacedDigit()
            }
            Text("\(entry.modelPeriod.fullLabel) · \(threads.count) 个对话")
                .font(.caption2).foregroundStyle(.secondary)
            ForEach(shown.indices, id: \.self) { index in
                let thread = shown[index]
                HStack(spacing: 8) {
                    Text(thread.name).font(.system(size: 12)).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 0)
                    Text(tokens(thread.tokens.total)).font(.caption.weight(.semibold)).monospacedDigit()
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
                    pageButton("chevron.left", target: max(0, page - 1), enabled: page > 0)
                    Text("\(page + 1)/\(pages)").monospacedDigit()
                    pageButton("chevron.right", target: min(pages - 1, page + 1), enabled: page + 1 < pages)
                }
                .font(.caption2)
            }
        }
    }

    private func pageButton(_ icon: String, target: Int, enabled: Bool, overview: Bool = false) -> some View {
        Button(intent: SelectModelPeriod(selection: "\(overview ? "overview" : "page"):\(target)")) {
            Image(systemName: icon).frame(width: 23, height: 18)
                .background(.primary.opacity(0.08), in: Capsule())
                .opacity(enabled ? 1 : 0.35)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private var overview: some View {
        let leading = Array(allRows.prefix(5))
        let other = allRows.dropFirst(5).reduce(0) { $0 + $1.tokens.total }
        let visible = other > 0
            ? leading + [ModelUsage(name: "其余", tokens: .init(total: other), id: Self.othersID)]
            : leading
        return HStack(spacing: 12) {
            usageRing(visible)
            ranking(visible, showMarkers: true)
        }
        .frame(maxHeight: .infinity)
    }

    private var othersDetails: some View {
        let remaining = Array(allRows.dropFirst(5))
        let pages = max(1, (remaining.count + 5) / 6)
        let page = min(max(0, entry.overviewPage), pages - 1)
        let shown = Array(remaining.dropFirst(page * 6).prefix(6))
        return VStack(alignment: .leading, spacing: 5) {
            Text("其余 · \(remaining.count) 项").font(.caption.weight(.semibold))
            ranking(shown, showMarkers: false)
            Spacer(minLength: 0)
            if pages > 1 {
                HStack(spacing: 12) {
                    Spacer()
                    pageButton("chevron.left", target: max(0, page - 1), enabled: page > 0, overview: true)
                    Text("\(page + 1)/\(pages)").monospacedDigit()
                    pageButton("chevron.right", target: min(pages - 1, page + 1), enabled: page + 1 < pages, overview: true)
                }
                .font(.caption2)
            }
        }
    }

    private func time(_ timestamp: TimeInterval, includeDate: Bool = false) -> String {
        let format = DateFormatter()
        format.locale = Locale(identifier: "zh_CN")
        format.timeZone = TimeZone(identifier: "Asia/Shanghai")
        format.dateFormat = includeDate ? "M/d HH:mm" : "HH:mm"
        return format.string(from: Date(timeIntervalSince1970: timestamp))
    }

    private var quota: some View {
        HStack(spacing: 6) {
            Text("官方周余量").font(.caption2).foregroundStyle(.secondary)
            Text(entry.quota.map { "\($0)%" } ?? "—")
                .font(.system(size: 17, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle((entry.quota ?? 100) < 20 ? Color.red : Color.primary)
        }
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityElement(children: .combine)
    }

    private var timestamps: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                quota
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 2) {
                    if entry.quota != nil, let reset = entry.snapshot?.quotaEndsAt {
                        Text("\(time(reset, includeDate: true)) 重置")
                    }
                    if let updated = entry.snapshot?.capturedAt {
                        Text("更新于 \(time(updated))")
                    }
                }
                .font(.caption2).foregroundStyle(.secondary)
            }
            if let value = entry.quota {
                GeometryReader { geometry in
                    Capsule().fill(.primary.opacity(0.13))
                        .overlay(alignment: .leading) {
                            Capsule().fill(value < 20 ? Color.red : .blue)
                                .frame(width: geometry.size.width * Double(value) / 100)
                        }
                }
                .frame(height: 4)
                .accessibilityHidden(true)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            controls
            if let project = expandedProject {
                projectDetails(project)
            } else if showOthers {
                othersDetails
            } else {
                overview
            }
            Divider()
            timestamps
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
    }
}
