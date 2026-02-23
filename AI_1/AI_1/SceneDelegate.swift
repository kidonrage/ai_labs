//
//  SceneDelegate.swift
//  AI_1
//
//  Created by Vlad Eliseev on 16.02.2026.
//

import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // 🔑 Configure your API here
        let apiBaseURL = URL(string: "https://api.proxyapi.ru/")!     // e.g. https://api.yourserver.com
        let apiKey = ""

        let rootVC = ChatViewController(
            apiBaseURL: apiBaseURL,
            apiKey: apiKey
        )

        let navigation = UINavigationController(rootViewController: rootVC)

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = navigation
        window.makeKeyAndVisible()

        self.window = window
    }

    // Optional lifecycle methods (can be left empty)

    func sceneDidDisconnect(_ scene: UIScene) {}

    func sceneDidBecomeActive(_ scene: UIScene) {}

    func sceneWillResignActive(_ scene: UIScene) {}

    func sceneWillEnterForeground(_ scene: UIScene) {}

    func sceneDidEnterBackground(_ scene: UIScene) {}
}
