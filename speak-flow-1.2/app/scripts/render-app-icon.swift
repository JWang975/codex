import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let iconset = root.appendingPathComponent("assets/AppIcon.iconset")
let menuBarIcon = root.appendingPathComponent("assets/SpeakFlowMenuBar.png")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

let sizes: [(String, CGFloat)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

func drawIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()

    let bounds = NSRect(x: 0, y: 0, width: size, height: size)
    NSColor(calibratedRed: 0.075, green: 0.08, blue: 0.095, alpha: 1).setFill()
    NSBezierPath(roundedRect: bounds, xRadius: size * 0.22, yRadius: size * 0.22).fill()

    let inner = bounds.insetBy(dx: size * 0.08, dy: size * 0.08)
    let gradient = NSGradient(colors: [
        NSColor(calibratedRed: 0.10, green: 0.78, blue: 0.56, alpha: 1),
        NSColor(calibratedRed: 0.04, green: 0.42, blue: 0.35, alpha: 1),
    ])
    gradient?.draw(in: NSBezierPath(roundedRect: inner, xRadius: size * 0.18, yRadius: size * 0.18), angle: -38)

    NSColor(calibratedWhite: 1, alpha: 0.16).setStroke()
    let ring = NSBezierPath(roundedRect: inner.insetBy(dx: size * 0.015, dy: size * 0.015), xRadius: size * 0.17, yRadius: size * 0.17)
    ring.lineWidth = max(1, size * 0.015)
    ring.stroke()

    let micRect = NSRect(x: size * 0.38, y: size * 0.34, width: size * 0.24, height: size * 0.36)
    NSColor(calibratedWhite: 1, alpha: 0.96).setFill()
    NSBezierPath(roundedRect: micRect, xRadius: size * 0.12, yRadius: size * 0.12).fill()

    NSColor(calibratedWhite: 1, alpha: 0.96).setStroke()
    let stem = NSBezierPath()
    stem.lineWidth = max(2, size * 0.035)
    stem.lineCapStyle = .round
    stem.move(to: NSPoint(x: size * 0.50, y: size * 0.22))
    stem.line(to: NSPoint(x: size * 0.50, y: size * 0.33))
    stem.stroke()

    let base = NSBezierPath()
    base.lineWidth = max(2, size * 0.035)
    base.lineCapStyle = .round
    base.move(to: NSPoint(x: size * 0.40, y: size * 0.22))
    base.line(to: NSPoint(x: size * 0.60, y: size * 0.22))
    base.stroke()

    let arc = NSBezierPath()
    arc.lineWidth = max(2, size * 0.032)
    arc.lineCapStyle = .round
    arc.appendArc(
        withCenter: NSPoint(x: size * 0.50, y: size * 0.46),
        radius: size * 0.21,
        startAngle: 205,
        endAngle: 335,
        clockwise: false
    )
    arc.stroke()

    image.unlockFocus()
    return image
}

func writePng(_ image: NSImage, to url: URL) throws {
    guard
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
    else {
        fatalError("Could not render \(url.lastPathComponent)")
    }
    try png.write(to: url)
}

for (name, size) in sizes {
    let image = drawIcon(size: size)
    try writePng(image, to: iconset.appendingPathComponent(name))
}

try writePng(drawIcon(size: 18), to: menuBarIcon)
