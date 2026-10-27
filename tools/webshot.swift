// Offscreen WebKit runner: loads a local page in a WKWebView (Safari's engine),
// seeds localStorage, runs scripted steps and saves full-resolution snapshots.
// The tests (test/run.mjs --webkit), the screenshots (tools/screenshots.mjs) and
// the benchmarks (tools/perf/) use it.
//
//   swiftc -O -o webshot tools/webshot.swift -framework Cocoa -framework WebKit
//   webshot <page.html> <plan.json> <outdir>
//
// A plan is JSON: { width, height, storage?: {key: value}, preload?: js,
// noAnim?: bool, steps: [{ js?, wait?, shot?, log? }] }. Each step's js runs as
// the body of an async function and its return value is printed as "[i] value";
// shot saves a 2x PNG. preload runs before the page's own scripts.
import Cocoa
import WebKit

struct Step: Decodable { let js: String?; let wait: Int?; let shot: String?; let log: Bool? }
struct Plan: Decodable { let width: Int; let height: Int; let storage: [String: String]?; let preload: String?; let noAnim: Bool?; let steps: [Step] }

final class Runner: NSObject, WKNavigationDelegate {
  let web: WKWebView; let window: NSWindow; let plan: Plan; let out: URL; let page: URL
  init(page: URL, plan: Plan, out: URL) {
    self.page = page; self.plan = plan; self.out = out
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .nonPersistent()
    // Benchmarks: keep a never-visible page from having its timers throttled.
    for name in ["_setHiddenPageDOMTimerThrottlingEnabled:", "_setPageVisibilityBasedProcessSuppressionEnabled:", "_setHiddenPageDOMTimerThrottlingAutoIncreases:"] {
      let sel = Selector((name))
      if cfg.preferences.responds(to: sel) {
        typealias F = @convention(c) (AnyObject, Selector, Bool) -> Void
        unsafeBitCast(cfg.preferences.method(for: sel), to: F.self)(cfg.preferences, sel, false)
      }
    }
    var seed = "try{"
    for (k, v) in plan.storage ?? [:] {
      let kj = String(data: try! JSONEncoder().encode(k), encoding: .utf8)!
      let vj = String(data: try! JSONEncoder().encode(v), encoding: .utf8)!
      seed += "localStorage.setItem(\(kj),\(vj));"
    }
    seed += "}catch(e){}"
    cfg.userContentController.addUserScript(WKUserScript(source: seed, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    if let pre = plan.preload {
      cfg.userContentController.addUserScript(WKUserScript(source: pre, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    if plan.noAnim ?? false {
      let css = "var s=document.createElement('style');s.textContent='*,*::before,*::after{transition:none!important;animation:none!important}';document.documentElement.appendChild(s);"
      cfg.userContentController.addUserScript(WKUserScript(source: css, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }
    let rect = NSRect(x: 0, y: 0, width: plan.width, height: plan.height)
    web = WKWebView(frame: rect, configuration: cfg)
    window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: plan.width, height: plan.height), styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    window.colorSpace = .sRGB // snapshots in sRGB, whatever the screens are
    window.contentView = web
    window.orderBack(nil)
    web.navigationDelegate = self
  }
  func start() { web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent()) }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) { DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.run(0) } }
  func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { print("nav fail", e); exit(2) }
  func run(_ i: Int) {
    if i >= plan.steps.count { exit(0) }
    let st = plan.steps[i]
    let next = { DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(st.wait ?? 0)) { self.shoot(st) { self.run(i + 1) } } }
    if let js = st.js {
      web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
        switch r {
        case .success(let v): if st.log ?? true { print("[\(i)]", v) }
        case .failure(let e): print("[\(i)] JS error:", e)
        }
        next()
      }
    } else { next() }
  }
  func shoot(_ st: Step, _ done: @escaping () -> Void) {
    guard let name = st.shot else { done(); return }
    let c = WKSnapshotConfiguration()
    web.takeSnapshot(with: c) { img, err in
      if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: self.out.appendingPathComponent(name)); print("shot", name, Int(rep.pixelsWide), "x", Int(rep.pixelsHigh))
      } else { print("snapshot failed", err as Any) }
      done()
    }
  }
}

let args = CommandLine.arguments
guard args.count >= 4 else { print("usage: webshot page.html steps.json outdir"); exit(1) }
let plan = try! JSONDecoder().decode(Plan.self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let runner = Runner(page: URL(fileURLWithPath: args[1]), plan: plan, out: URL(fileURLWithPath: args[3], isDirectory: true))
runner.start()
DispatchQueue.main.asyncAfter(deadline: .now() + 120) { print("timeout"); exit(3) }
app.run()
