// Yield Vector → Apple Reminders bridge (Mac, EventKit).
//
// Consumes the feed the app already publishes to its sync Gist (`_feed`, contract
// v2 in js/reminders.js) and mirrors it into ONE existing Reminders list. Owns
// only reminders whose URL is https://yieldvector.local/id/<feed item id>; every
// other reminder in the list is invisible to it. Reads completions back and writes
// them to `yv-completions.json` in the same Gist (js/sync-pwa.js
// applyRemoteCompletions), plus a heartbeat file `consumer-mac-bridge.json`.
//
// Build:  swiftc -O -swift-version 5 -o tools/yv-reminders-bridge tools/yv-reminders-bridge.swift
// Run:    tools/yv-reminders-bridge [--dry-run] [--force-delete] [--skip-past-days N]
// Config: ~/.config/yield-vector/env  (GITHUB_TOKEN, GIST_ID, REMINDERS_LIST)
// State:  ~/.config/yield-vector/bridge-state.json (last-written values per id,
//         completions already reported) — lets the owner's own edits to a
//         reminder survive until the FEED changes that field.

import EventKit
import Foundation

// ---------------------------------------------------------------- config ----
let home = FileManager.default.homeDirectoryForCurrentUser.path
let cfgDir = "\(home)/.config/yield-vector"
let args = CommandLine.arguments
let dryRun = args.contains("--dry-run")
let forceDelete = args.contains("--force-delete")
let skipPastDays: Int = {
    if let i = args.firstIndex(of: "--skip-past-days"), i + 1 < args.count { return Int(args[i + 1]) ?? 0 }
    return 0
}()
let urlPrefix = "https://yieldvector.local/id/"
let deleteGuardFraction = 0.30

func log(_ s: String) {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    print("[\(f.string(from: Date()))] \(s)")
}
func fail(_ s: String) -> Never { log("ERROR \(s)"); exit(1) }

var env: [String: String] = [:]
if let text = try? String(contentsOfFile: "\(cfgDir)/env", encoding: .utf8) {
    for line in text.split(separator: "\n") {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard !t.hasPrefix("#"), let eq = t.firstIndex(of: "=") else { continue }
        env[String(t[..<eq])] = String(t[t.index(after: eq)...])
    }
}
guard let token = env["GITHUB_TOKEN"], !token.isEmpty else { fail("GITHUB_TOKEN missing in \(cfgDir)/env") }
guard let gistId = env["GIST_ID"], !gistId.isEmpty else { fail("GIST_ID missing in \(cfgDir)/env") }
let listName = env["REMINDERS_LIST"] ?? "Credit Cards | Banks | Travel"

// ------------------------------------------------------------------ http ----
func http(_ method: String, _ url: String, body: Data? = nil) -> (Int, Data) {
    var req = URLRequest(url: URL(string: url)!)
    req.httpMethod = method
    req.setValue("token \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    req.setValue("yv-reminders-bridge", forHTTPHeaderField: "User-Agent")
    if let b = body { req.httpBody = b; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    let sema = DispatchSemaphore(value: 0)
    var out: (Int, Data) = (0, Data())
    URLSession.shared.dataTask(with: req) { d, r, e in
        if let e = e { log("network: \(e.localizedDescription)") }
        out = ((r as? HTTPURLResponse)?.statusCode ?? 0, d ?? Data()); sema.signal()
    }.resume()
    sema.wait()
    return out
}

// ------------------------------------------------------------------ feed ----
struct Item { let id: String; let kind: String; let title: String; let due: Date; let notes: String }

let (gStatus, gData) = http("GET", "https://api.github.com/gists/\(gistId)")
guard gStatus == 200, let gist = try? JSONSerialization.jsonObject(with: gData) as? [String: Any],
      let files = gist["files"] as? [String: Any] else { fail("gist fetch HTTP \(gStatus)") }
func fileContent(_ name: String) -> String? {
    guard let f = files[name] as? [String: Any] else { return nil }
    if (f["truncated"] as? Bool) == true, let raw = f["raw_url"] as? String {
        let (s, d) = http("GET", raw); return s == 200 ? String(data: d, encoding: .utf8) : nil
    }
    return f["content"] as? String
}
guard let stateText = fileContent("capital-planner.json"),
      let state = try? JSONSerialization.jsonObject(with: Data(stateText.utf8)) as? [String: Any],
      let feed = state["_feed"] as? [String: Any] else { fail("capital-planner.json has no _feed") }
guard (feed["schema"] as? Int) == 2 else { fail("unknown feed schema \(String(describing: feed["schema"])) — update the bridge") }
let feedStatus = (feed["feedStatus"] as? String) ?? "ok"
guard feedStatus == "ok" else { fail("feedStatus=\(feedStatus) — producer degraded, not acting") }
let manifestVersion = (feed["manifestVersion"] as? Int) ?? 0

let dueParser = DateFormatter(); dueParser.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"; dueParser.timeZone = .current
let dayParser = DateFormatter(); dayParser.dateFormat = "yyyy-MM-dd"; dayParser.timeZone = .current
func parseDue(_ s: String) -> Date? {
    if let d = dueParser.date(from: s) { return d }
    if let d = dayParser.date(from: String(s.prefix(10))) { return Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: d) }
    return nil
}
var items: [Item] = []
for raw in (feed["items"] as? [[String: Any]]) ?? [] {
    guard let id = raw["id"] as? String, let title = raw["title"] as? String,
          let dueS = raw["dueDate"] as? String, let due = parseDue(dueS) else { log("skip malformed item \(raw["id"] ?? "?")"); continue }
    items.append(Item(id: id, kind: (raw["kind"] as? String) ?? "", title: title, due: due, notes: (raw["notes"] as? String) ?? ""))
}
let removedIds: [String] = ((feed["removed"] as? [[String: Any]]) ?? []).compactMap { $0["id"] as? String }
let liveIds = Set(items.map { $0.id })
if items.isEmpty && removedIds.isEmpty { fail("feed has no items and no tombstones — refusing to act on an empty manifest") }
log("feed ok: manifest \(manifestVersion), \(items.count) items, \(removedIds.count) tombstones\(dryRun ? "  [DRY RUN — nothing will be written]" : "")")

// ----------------------------------------------------------- local state ----
struct Written: Codable { var title: String; var due: String; var notes: String }
struct BridgeState: Codable { var written: [String: Written] = [:]; var reported: [String] = [] }
let statePath = "\(cfgDir)/bridge-state.json"
var bstate = (try? JSONDecoder().decode(BridgeState.self, from: Data(contentsOf: URL(fileURLWithPath: statePath)))) ?? BridgeState()
let iso = ISO8601DateFormatter()

// -------------------------------------------------------------- eventkit ----
let store = EKEventStore()
let access = DispatchSemaphore(value: 0); var granted = false
store.requestFullAccessToReminders { ok, err in granted = ok; if let e = err { log("access: \(e.localizedDescription)") }; access.signal() }
access.wait()
guard granted else { fail("Reminders access denied (System Settings → Privacy & Security → Reminders)") }
guard let list = store.calendars(for: .reminder).first(where: { $0.title == listName }) else {
    fail("list \"\(listName)\" not found; lists: \(store.calendars(for: .reminder).map { $0.title })")
}
let fetch = DispatchSemaphore(value: 0); var existing: [EKReminder] = []
store.fetchReminders(matching: store.predicateForReminders(in: [list])) { rs in existing = rs ?? []; fetch.signal() }
fetch.wait()
var owned: [String: EKReminder] = [:]
for r in existing {
    if let u = r.url?.absoluteString, u.hasPrefix(urlPrefix) { owned[String(u.dropFirst(urlPrefix.count))] = r }
}
log("list \"\(list.title)\" (\(list.source.title)): \(existing.count) reminders, \(owned.count) owned by the bridge")

// ------------------------------------------------------------------ plan ----
let today = Calendar.current.startOfDay(for: Date())
var creates = 0, updates = 0, deletes = 0, skippedPast = 0
var completions: [(String, Date)] = []
func dueComponents(_ d: Date) -> DateComponents {
    Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: d)
}
func apply(_ r: EKReminder, _ it: Item) {
    r.title = it.title; r.notes = it.notes.isEmpty ? nil : it.notes
    r.dueDateComponents = dueComponents(it.due)
    for a in r.alarms ?? [] { r.removeAlarm(a) }
    r.addAlarm(EKAlarm(absoluteDate: it.due))
    bstate.written[it.id] = Written(title: it.title, due: iso.string(from: it.due), notes: it.notes)
}
let dateFmt = DateFormatter(); dateFmt.dateFormat = "MMM d, yyyy"

for it in items {
    if let r = owned[it.id] {
        if r.isCompleted {
            let key = "\(it.id)@\(Int((r.completionDate ?? Date()).timeIntervalSince1970 * 1000))"
            if !bstate.reported.contains(key) { completions.append((it.id, r.completionDate ?? Date())); bstate.reported.append(key)
                log("COMPLETION  \(dateFmt.string(from: r.completionDate ?? Date()))  \(it.title)") }
            continue
        }
        let prev = bstate.written[it.id]
        var changes: [String] = []
        if prev?.title != it.title, r.title != it.title { changes.append("title") }
        if prev?.due != iso.string(from: it.due) { changes.append("due→\(dateFmt.string(from: it.due))") }
        if prev?.notes != it.notes { changes.append("notes") }
        if !changes.isEmpty {
            updates += 1; log("UPDATE      \(it.title)  [\(changes.joined(separator: ", "))]")
            if !dryRun { apply(r, it); try? store.save(r, commit: false) }
        }
    } else {
        let daysPast = Calendar.current.dateComponents([.day], from: it.due, to: today).day ?? 0
        if skipPastDays > 0 && daysPast > skipPastDays { skippedPast += 1; log("SKIP (past \(daysPast)d)  \(it.title)"); continue }
        creates += 1
        log("CREATE      \(dateFmt.string(from: it.due))\(daysPast > 0 ? " (\(daysPast)d overdue)" : "")  [\(it.kind)]  \(it.title)")
        if !dryRun {
            let r = EKReminder(eventStore: store); r.calendar = list
            r.url = URL(string: urlPrefix + it.id); apply(r, it); try? store.save(r, commit: false)
        }
    }
}
var toDelete: [EKReminder] = []
for id in removedIds { if let r = owned[id] { toDelete.append(r); log("DELETE      \(r.title ?? id)") } }
if !toDelete.isEmpty, owned.count >= 5, Double(toDelete.count) / Double(owned.count) > deleteGuardFraction, !forceDelete {
    log("DELETE GUARD: \(toDelete.count)/\(owned.count) owned reminders tombstoned (> \(Int(deleteGuardFraction * 100))%) — refusing; re-run with --force-delete if intended")
    toDelete = []
}
deletes = toDelete.count
if !dryRun { for r in toDelete { try? store.remove(r, commit: false); bstate.written.removeValue(forKey: owned.first { $0.value === r }?.key ?? "") } }

// ----------------------------------------------------------------- write ----
if dryRun {
    log("dry run summary: create \(creates), update \(updates), delete \(deletes), completions to report \(completions.count), skipped-past \(skippedPast)")
    exit(0)
}
do { try store.commit() } catch { fail("Reminders commit failed: \(error.localizedDescription)") }
log("reminders committed: create \(creates), update \(updates), delete \(deletes)")

// completions file: append to whatever is there (app reads; bridge owns the file)
var existingCompletions: [[String: String]] = []
if let t = fileContent("yv-completions.json"), let j = try? JSONSerialization.jsonObject(with: Data(t.utf8)) {
    if let d = j as? [String: Any], let c = d["completions"] as? [[String: String]] { existingCompletions = c }
    else if let a = j as? [[String: String]] { existingCompletions = a }
}
for (id, at) in completions { existingCompletions.append(["id": id, "completedAt": iso.string(from: at)]) }
if existingCompletions.count > 500 { existingCompletions = Array(existingCompletions.suffix(500)) }
let heartbeat: [String: Any] = ["consumer": "mac-bridge", "lastRunAt": iso.string(from: Date()), "manifestVersion": manifestVersion,
                                "itemsApplied": items.count, "created": creates, "updated": updates, "deleted": deletes,
                                "completionsReported": completions.count, "list": list.title]
var gistFiles: [String: Any] = ["consumer-mac-bridge.json": ["content": String(data: try! JSONSerialization.data(withJSONObject: heartbeat, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!]]
if !completions.isEmpty {
    gistFiles["yv-completions.json"] = ["content": String(data: try! JSONSerialization.data(withJSONObject: ["completions": existingCompletions], options: [.prettyPrinted]), encoding: .utf8)!]
}
let (pStatus, pData) = http("PATCH", "https://api.github.com/gists/\(gistId)", body: try! JSONSerialization.data(withJSONObject: ["files": gistFiles]))
if pStatus != 200 { log("gist PATCH HTTP \(pStatus): \(String(data: pData, encoding: .utf8)?.prefix(200) ?? "")") }
else { log("gist updated: heartbeat\(completions.isEmpty ? "" : " + \(completions.count) completion(s)")") }

bstate.reported = Array(bstate.reported.suffix(1000))
try? FileManager.default.createDirectory(atPath: cfgDir, withIntermediateDirectories: true)
try? JSONEncoder().encode(bstate).write(to: URL(fileURLWithPath: statePath))
