// Renders an app bundle's icon the way macOS draws it (Liquid Glass and all)
// to a PNG with a transparent background.
//
//     render APP OUT.png SIZE [dark|light]
import AppKit

let args = CommandLine.arguments
guard args.count >= 4, let size = Double(args[3]) else {
  FileHandle.standardError.write("usage: render APP OUT.png SIZE [dark|light]\n".data(using: .utf8)!)
  exit(2)
}
let app = URL(fileURLWithPath: args[1]).standardizedFileURL.path
NSApplication.shared.appearance = NSAppearance(named: args.count > 4 && args[4] == "light" ? .aqua : .darkAqua)

// A freshly registered bundle first comes back as a generic type icon.
var ready = false
for _ in 0..<40 {
  if "\(NSWorkspace.shared.icon(forFile: app).representations.first as Any)".contains("ISBundleIcon") { ready = true; break }
  RunLoop.current.run(until: Date().addingTimeInterval(0.25))
}
guard ready else {
  FileHandle.standardError.write("render: LaunchServices has no icon for \(app)\n".data(using: .utf8)!)
  exit(1)
}
_ = NSWorkspace.shared.icon(forFile: app).cgImage(forProposedRect: nil, context: nil, hints: nil)
RunLoop.current.run(until: Date().addingTimeInterval(1))

let icon = NSWorkspace.shared.icon(forFile: app)
let px = Int(size)
icon.size = NSSize(width: size, height: size)
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
  hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = icon.size
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
icon.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
