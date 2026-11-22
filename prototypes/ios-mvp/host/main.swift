// The UIKit host: one view backed by a CAMetalLayer that GPUI draws into,
// a display link that asks GPUI for frames, and touches passed on.
import UIKit
import QuartzCore

final class GPUIView: UIView {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    private var started = false
    private var link: CADisplayLink?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
    }
    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = Float(window?.windowScene?.screen.scale ?? traitCollection.displayScale)
        layer.contentsScale = CGFloat(scale)
        let (w, h) = (Float(bounds.width), Float(bounds.height))
        if !started, w > 0 {
            started = true
            ffm_start(Unmanaged.passUnretained(layer).toOpaque(), w, h, scale)
            link = CADisplayLink(target: self, selector: #selector(tick))
            link?.add(to: .main, forMode: .common)
            injectTapsFromArguments()
        } else if started {
            ffm_resize(w, h, scale)
        }
    }

    @objc private func tick() { ffm_frame() }

    private func send(_ touches: Set<UITouch>, _ phase: UInt8) {
        for t in touches {
            let p = t.location(in: self)
            ffm_touch(UInt64(UInt(bitPattern: ObjectIdentifier(t).hashValue)), phase, Float(p.x), Float(p.y))
        }
    }
    override func touchesBegan(_ t: Set<UITouch>, with e: UIEvent?) { send(t, 0) }
    override func touchesMoved(_ t: Set<UITouch>, with e: UIEvent?) { send(t, 1) }
    override func touchesEnded(_ t: Set<UITouch>, with e: UIEvent?) { send(t, 2) }
    override func touchesCancelled(_ t: Set<UITouch>, with e: UIEvent?) { send(t, 3) }

    /// `-taps N`: N synthetic taps at the view's centre, a quarter second apart,
    /// sent through the same `ffm_touch` path UIKit's touches take. The
    /// simulator offers no headless way to tap.
    private func injectTapsFromArguments() {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-taps"), i + 1 < args.count, let n = Int(args[i + 1]) else { return }
        let c = CGPoint(x: bounds.midX, y: bounds.midY - 30)
        for k in 0..<n {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0 + Double(k) * 0.25) {
                let id = UInt64(1000 + k)
                ffm_touch(id, 0, Float(c.x), Float(c.y))
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    ffm_touch(id, 2, Float(c.x), Float(c.y))
                }
            }
        }
    }
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ app: UIApplication, configurationForConnecting session: UISceneSession,
                     options _: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// iOS 27 requires the scene lifecycle: the window hangs off the scene.
@objc(SceneDelegate)
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo _: UISceneSession, options _: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: scene)
        let vc = UIViewController()
        vc.view = GPUIView(frame: w.bounds)
        w.rootViewController = vc
        w.makeKeyAndVisible()
        window = w
    }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
