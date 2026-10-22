// Stub App Intents for a Capacitor-wrapped Anima build. Not compiled by the web build.
// Each intent deep-links into the web app; the realtime voice session itself still
// uses the server-minted ephemeral token (never an API key in the app).
import AppIntents
import UIKit

private let baseURL = URL(string: "https://anima-protocol.com")!

private func open(_ path: String, _ query: [URLQueryItem] = []) {
  var c = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
  c.queryItems = query.isEmpty ? nil : query
  if let url = c.url { Task { @MainActor in UIApplication.shared.open(url) } }
}

struct TalkToCompanionIntent: AppIntent {
  static var title: LocalizedStringResource = "Talk to Companion"
  static var description = IntentDescription("Start a voice call with your Anima companion.")
  static var openAppWhenRun = true

  @Parameter(title: "Companion", default: "Serenity") var companion: String

  func perform() async throws -> some IntentResult {
    open("/chat", [URLQueryItem(name: "voice", value: "1"), URLQueryItem(name: "companion", value: companion)])
    return .result()
  }
}

struct OpenResonanceIntent: AppIntent {
  static var title: LocalizedStringResource = "Open Resonance Scanner"
  static var openAppWhenRun = true
  @Parameter(title: "Frequency") var frequency: Double?

  func perform() async throws -> some IntentResult {
    open("/resonance", frequency.map { [URLQueryItem(name: "tune", value: String($0))] } ?? [])
    return .result()
  }
}

struct ShowVesselIntent: AppIntent {
  static var title: LocalizedStringResource = "Show Vessel"
  static var openAppWhenRun = true
  func perform() async throws -> some IntentResult {
    open("/vessel")
    return .result()
  }
}

struct AnimaShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: TalkToCompanionIntent(), phrases: ["Talk to Serenity in \(.applicationName)"], shortTitle: "Talk", systemImageName: "waveform")
    AppShortcut(intent: OpenResonanceIntent(), phrases: ["Open resonance scanner in \(.applicationName)"], shortTitle: "Resonance", systemImageName: "dot.radiowaves.left.and.right")
    AppShortcut(intent: ShowVesselIntent(), phrases: ["Show my vessel in \(.applicationName)"], shortTitle: "Vessel", systemImageName: "figure.stand")
  }
}
