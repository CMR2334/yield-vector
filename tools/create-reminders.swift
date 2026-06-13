import EventKit
import Foundation

let store = EKEventStore()
let sema = DispatchSemaphore(value: 0)

store.requestFullAccessToReminders { granted, error in
    guard granted else {
        print("Access denied: \(error?.localizedDescription ?? "unknown")")
        sema.signal()
        return
    }

    let reminder = EKReminder(eventStore: store)
    reminder.title = "Complete Codex plugin install — double-click FINISH_CODEX_SETUP.command on Desktop"
    reminder.notes = "4 commands in claude:\n/plugin marketplace add openai/codex-plugin-cc\n/plugin install codex@openai-codex\n/reload-plugins\n/codex:setup\n\nIf login needed: !codex login\n(@openai/codex npm already installed ✓)"
    reminder.calendar = store.defaultCalendarForNewReminders()

    var components = DateComponents()
    components.year = 2026
    components.month = 6
    components.day = 5
    components.hour = 9
    components.minute = 0
    reminder.dueDateComponents = components

    let alarm = EKAlarm(absoluteDate: Calendar.current.date(from: components)!)
    reminder.addAlarm(alarm)

    do {
        try store.save(reminder, commit: true)
        print("Reminder created: \(reminder.title ?? "")")
    } catch {
        print("Save failed: \(error.localizedDescription)")
    }
    sema.signal()
}

sema.wait()
