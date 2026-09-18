import Foundation
import Capacitor

/// Hands a statement shared into the app ("Share → SubSweep" from Files,
/// Mail or the bank app) over to the web code. AppDelegate passes the file
/// URL to `take(url:)` the moment it arrives; the text is read into memory
/// and parked here, and the web side calls `consume()` to collect it — on
/// start-up for a cold launch, or when the `subsweepShare` window event fires
/// for a share into an app that is already running.
///
/// iOS delivers the file by copying it into the app's Documents/Inbox. That
/// copy is deleted as soon as it has been read, so nothing stays on disk.
@objc(ShareIntakePlugin)
public class ShareIntakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareIntakePlugin"
    public let jsName = "ShareIntake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "consume", returnType: CAPPluginReturnPromise)
    ]

    // Matches the server's upload limit.
    private static let maxBytes = 5 * 1024 * 1024
    private static var pendingName: String?
    private static var pendingText: String?
    private static var pendingError: String?
    private static let arrived = Notification.Name("SubSweepShareArrived")

    public override func load() {
        NotificationCenter.default.addObserver(forName: Self.arrived, object: nil, queue: .main) { [weak self] _ in
            self?.bridge?.triggerWindowJSEvent(eventName: "subsweepShare")
        }
    }

    static func take(url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        pendingName = url.lastPathComponent
        pendingText = nil
        pendingError = nil

        if let data = try? Data(contentsOf: url) {
            if data.count > maxBytes {
                pendingError = "That file is over 5 MB. Export a shorter date range and share it again."
            } else if let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) {
                pendingText = text
            } else {
                pendingError = "\"\(url.lastPathComponent)\" doesn't look like a text CSV file."
            }
        } else {
            pendingError = "Couldn't read \"\(url.lastPathComponent)\" from the app that shared it. Save it to Files and choose it from there instead."
        }

        // The Inbox copy is ours to remove; a file opened in place is not.
        if url.path.contains("/Inbox/") {
            try? FileManager.default.removeItem(at: url)
        }
        NotificationCenter.default.post(name: arrived, object: nil)
    }

    @objc func consume(_ call: CAPPluginCall) {
        var ret = JSObject()
        if let error = Self.pendingError {
            ret["error"] = error
        } else if let text = Self.pendingText {
            ret["name"] = Self.pendingName ?? "statement.csv"
            ret["text"] = text
        }
        Self.pendingName = nil
        Self.pendingText = nil
        Self.pendingError = nil
        call.resolve(ret)
    }
}

/// The storyboard's view controller. Capacitor only auto-registers plugins
/// that arrive as packages; one that lives in the app target is registered
/// here, once the bridge exists.
class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShareIntakePlugin())
    }
}
