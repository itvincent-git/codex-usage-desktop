import AppKit

// A separate native app: same-process fullscreen does not reproduce cross-app Spaces.
final class FullscreenApp: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 100, y: 100, width: 800, height: 600),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "Quota overlay fullscreen regression"
        window.collectionBehavior = [.fullScreenPrimary]
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.toggleFullScreen(nil)
        DispatchQueue.global().async {
            while let command = readLine() {
                DispatchQueue.main.async {
                    switch command {
                    case "activate":
                        NSApp.activate(ignoringOtherApps: true)
                        self.window.makeKeyAndOrderFront(nil)
                    case "quit":
                        NSApp.terminate(nil)
                    default:
                        break
                    }
                }
            }
        }
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        print("FULLSCREEN_READY")
        fflush(stdout)
    }
}

let application = NSApplication.shared
let delegate = FullscreenApp()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
