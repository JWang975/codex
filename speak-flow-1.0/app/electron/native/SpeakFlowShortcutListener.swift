import ApplicationServices
import Foundation

struct ShortcutSpec {
    let raw: String
    let modifiers: Set<String>
    let key: String
}

final class ShortcutListener {
    private let captureMode: Bool
    private let shortcut: ShortcutSpec?
    private let cooldownSeconds: TimeInterval
    private var tap: CFMachPort?
    private var lastTriggerAt = Date.distantPast
    private var pendingModifier: (shortcut: String, display: String)?
    private var pendingWorkItem: DispatchWorkItem?

    init(captureMode: Bool, shortcut: String?, cooldownMs: Int) {
        self.captureMode = captureMode
        self.shortcut = shortcut.flatMap { ShortcutListener.parseShortcut($0) }
        self.cooldownSeconds = TimeInterval(max(250, cooldownMs)) / 1000.0
    }

    func run(timeoutMs: Int) {
        guard AXIsProcessTrusted() else {
            emit([
                "type": "status",
                "status": "error",
                "message": "需要在 macOS 辅助功能/输入监控中允许 Speak flow。",
            ])
            exit(2)
        }

        let eventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
        let userInfo = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        guard let createdTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: captureMode ? .defaultTap : .listenOnly,
            eventsOfInterest: CGEventMask(eventMask),
            callback: shortcutEventCallback,
            userInfo: userInfo
        ) else {
            emit([
                "type": "status",
                "status": "error",
                "message": "无法启动键盘监听，请检查辅助功能/输入监控权限。",
            ])
            exit(2)
        }

        tap = createdTap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, createdTap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        CGEvent.tapEnable(tap: createdTap, enable: true)
        emit([
            "type": "status",
            "status": "ready",
            "backend": captureMode ? "capture" : "native",
            "message": captureMode ? "按下新的快捷键。" : "native 快捷键监听已启动。",
        ])

        if captureMode {
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(max(3000, timeoutMs))) {
                emit([
                    "type": "status",
                    "status": "error",
                    "message": "快捷键录制超时。",
                ])
                exit(3)
            }
        }

        CFRunLoopRun()
    }

    func handle(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .keyDown {
            return handleKeyDown(event)
        }
        if type == .flagsChanged {
            return handleFlagsChanged(event)
        }
        return Unmanaged.passUnretained(event)
    }

    private func handleKeyDown(_ event: CGEvent) -> Unmanaged<CGEvent>? {
        let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
        guard let key = Self.keyName(for: keyCode) else {
            return Unmanaged.passUnretained(event)
        }

        pendingWorkItem?.cancel()
        pendingWorkItem = nil

        if captureMode {
            let modifiers = Self.modifierNames(from: event.flags)
            let shortcut = (modifiers + [key.shortcut]).joined(separator: "+")
            let modifierDisplay = modifiers.count == 1 && pendingModifier != nil
                ? [pendingModifier!.display]
                : Self.modifierDisplayNames(from: event.flags)
            let display = modifierDisplay + [key.display]
            emit([
                "type": "capture",
                "shortcut": shortcut,
                "display": display,
                "backend": Self.requiresNativeBackend(shortcut) ? "native" : "electron",
            ])
            exit(0)
        }

        guard let spec = shortcut else {
            return Unmanaged.passUnretained(event)
        }
        if spec.key == key.shortcut && Self.flags(event.flags, contain: spec.modifiers) {
            trigger(spec.raw)
        }
        return Unmanaged.passUnretained(event)
    }

    private func handleFlagsChanged(_ event: CGEvent) -> Unmanaged<CGEvent>? {
        let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
        guard let modifier = Self.modifierKey(for: keyCode) else {
            return Unmanaged.passUnretained(event)
        }
        let isDown = Self.flags(event.flags, contain: [modifier.generic])
        guard isDown else {
            return Unmanaged.passUnretained(event)
        }

        if captureMode {
            pendingModifier = (modifier.shortcut, modifier.display)
            pendingWorkItem?.cancel()
            let workItem = DispatchWorkItem { [weak self] in
                guard let self, let pending = self.pendingModifier else { return }
                emit([
                    "type": "capture",
                    "shortcut": pending.shortcut,
                    "display": [pending.display],
                    "backend": "native",
                ])
                exit(0)
            }
            pendingWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(320), execute: workItem)
            return nil
        }

        guard let spec = shortcut else {
            return Unmanaged.passUnretained(event)
        }
        if spec.modifiers.isEmpty && (spec.key == modifier.shortcut || spec.key == modifier.generic) {
            trigger(spec.raw)
        }
        return Unmanaged.passUnretained(event)
    }

    private func trigger(_ shortcut: String) {
        let now = Date()
        guard now.timeIntervalSince(lastTriggerAt) >= cooldownSeconds else { return }
        lastTriggerAt = now
        emit([
            "type": "trigger",
            "source": "shortcut",
            "action": "toggle_recording",
            "shortcut": shortcut,
            "ts": Int(now.timeIntervalSince1970 * 1000),
        ])
    }

    private static func parseShortcut(_ raw: String) -> ShortcutSpec? {
        let parts = raw.split(separator: "+").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard let key = parts.last else { return nil }
        let modifiers = Set(parts.dropLast().compactMap { modifierName($0) })
        return ShortcutSpec(raw: raw, modifiers: modifiers, key: normalizeKey(key))
    }

    private static func modifierName(_ value: String) -> String? {
        switch value.lowercased() {
        case "control", "ctrl", "leftcontrol", "rightcontrol":
            return "Control"
        case "alt", "option", "leftalt", "rightalt", "leftoption", "rightoption":
            return "Alt"
        case "shift", "leftshift", "rightshift":
            return "Shift"
        case "command", "cmd", "meta", "leftcommand", "rightcommand":
            return "Command"
        case "fn", "function":
            return "Fn"
        default:
            return nil
        }
    }

    private static func normalizeKey(_ value: String) -> String {
        switch value.lowercased() {
        case "ctrl": return "Control"
        case "option": return "Alt"
        case "cmd", "meta": return "Command"
        case "enter": return "Return"
        case "esc": return "Escape"
        case "capslock", "caps lock": return "CapsLock"
        case "arrowup": return "Up"
        case "arrowdown": return "Down"
        case "arrowleft": return "Left"
        case "arrowright": return "Right"
        case "fn", "function": return "Fn"
        default: return value
        }
    }

    private static func requiresNativeBackend(_ shortcut: String) -> Bool {
        let parts = shortcut.split(separator: "+").map(String.init)
        guard let key = parts.last else { return false }
        if key == "Fn" || parts.contains("Fn") { return true }
        return parts.count == 1 && modifierName(key) != nil
    }

    private static func flags(_ flags: CGEventFlags, contain modifiers: Set<String>) -> Bool {
        for modifier in modifiers {
            switch modifier {
            case "Control":
                if !flags.contains(.maskControl) { return false }
            case "Alt":
                if !flags.contains(.maskAlternate) { return false }
            case "Shift":
                if !flags.contains(.maskShift) { return false }
            case "Command":
                if !flags.contains(.maskCommand) { return false }
            case "Fn":
                if !flags.contains(.maskSecondaryFn) { return false }
            default:
                return false
            }
        }
        return true
    }

    private static func modifierNames(from flags: CGEventFlags) -> [String] {
        var names: [String] = []
        if flags.contains(.maskControl) { names.append("Control") }
        if flags.contains(.maskAlternate) { names.append("Alt") }
        if flags.contains(.maskShift) { names.append("Shift") }
        if flags.contains(.maskCommand) { names.append("Command") }
        if flags.contains(.maskSecondaryFn) { names.append("Fn") }
        return names
    }

    private static func modifierDisplayNames(from flags: CGEventFlags) -> [String] {
        modifierNames(from: flags).map { name in
            if name == "Alt" { return "Option" }
            return name
        }
    }

    private static func modifierKey(for keyCode: Int) -> (generic: String, shortcut: String, display: String)? {
        switch keyCode {
        case 54: return ("Command", "RightCommand", "Right Command")
        case 55: return ("Command", "LeftCommand", "Left Command")
        case 56: return ("Shift", "LeftShift", "Left Shift")
        case 58: return ("Alt", "LeftAlt", "Left Option")
        case 59: return ("Control", "LeftControl", "Left Control")
        case 60: return ("Shift", "RightShift", "Right Shift")
        case 61: return ("Alt", "RightAlt", "Right Option")
        case 62: return ("Control", "RightControl", "Right Control")
        case 63: return ("Fn", "Fn", "Fn")
        default: return nil
        }
    }

    private static func keyName(for keyCode: Int) -> (shortcut: String, display: String)? {
        let map: [Int: (String, String)] = [
            0: ("A", "A"), 1: ("S", "S"), 2: ("D", "D"), 3: ("F", "F"),
            4: ("H", "H"), 5: ("G", "G"), 6: ("Z", "Z"), 7: ("X", "X"),
            8: ("C", "C"), 9: ("V", "V"), 11: ("B", "B"), 12: ("Q", "Q"),
            13: ("W", "W"), 14: ("E", "E"), 15: ("R", "R"), 16: ("Y", "Y"),
            17: ("T", "T"), 18: ("1", "1"), 19: ("2", "2"), 20: ("3", "3"),
            21: ("4", "4"), 22: ("6", "6"), 23: ("5", "5"), 24: ("=", "="),
            25: ("9", "9"), 26: ("7", "7"), 27: ("-", "-"), 28: ("8", "8"),
            29: ("0", "0"), 30: ("]", "]"), 31: ("O", "O"), 32: ("U", "U"),
            33: ("[", "["), 34: ("I", "I"), 35: ("P", "P"), 36: ("Return", "Return"),
            37: ("L", "L"), 38: ("J", "J"), 39: ("'", "'"), 40: ("K", "K"),
            41: (";", ";"), 42: ("\\", "\\"), 43: (",", ","), 44: ("/", "/"),
            45: ("N", "N"), 46: ("M", "M"), 47: (".", "."), 48: ("Tab", "Tab"),
            49: ("Space", "Space"), 50: ("`", "`"), 51: ("Backspace", "Backspace"),
            53: ("Escape", "Escape"), 57: ("CapsLock", "Caps Lock"),
            64: ("F17", "F17"), 79: ("F18", "F18"), 80: ("F19", "F19"),
            90: ("F20", "F20"), 96: ("F5", "F5"), 97: ("F6", "F6"),
            98: ("F7", "F7"), 99: ("F3", "F3"), 100: ("F8", "F8"),
            101: ("F9", "F9"), 103: ("F11", "F11"), 105: ("F13", "F13"),
            106: ("F16", "F16"), 107: ("F14", "F14"), 109: ("F10", "F10"),
            111: ("F12", "F12"), 113: ("F15", "F15"), 115: ("Home", "Home"),
            116: ("PageUp", "Page Up"), 117: ("Delete", "Delete"), 118: ("F4", "F4"),
            119: ("End", "End"), 120: ("F2", "F2"), 121: ("PageDown", "Page Down"),
            122: ("F1", "F1"), 123: ("Left", "Left"), 124: ("Right", "Right"),
            125: ("Down", "Down"), 126: ("Up", "Up"),
        ]
        return map[keyCode]
    }
}

private func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: []),
       let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

private let shortcutEventCallback: CGEventTapCallBack = { _, type, event, refcon in
    guard let refcon else {
        return Unmanaged.passUnretained(event)
    }
    let listener = Unmanaged<ShortcutListener>.fromOpaque(refcon).takeUnretainedValue()
    return listener.handle(type: type, event: event)
}

private func argumentValue(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

let capture = CommandLine.arguments.contains("--capture")
let shortcut = argumentValue("--shortcut")
let cooldownMs = Int(argumentValue("--cooldown-ms") ?? "900") ?? 900
let timeoutMs = Int(argumentValue("--timeout-ms") ?? "10000") ?? 10000

let listener = ShortcutListener(captureMode: capture, shortcut: shortcut, cooldownMs: cooldownMs)
listener.run(timeoutMs: timeoutMs)
