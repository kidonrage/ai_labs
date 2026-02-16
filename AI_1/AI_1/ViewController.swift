//
//  ViewController.swift
//  AI_1
//
//  Created by Vlad Eliseev on 16.02.2026.
//

import UIKit

// MARK: - Model (DTOs)

struct OpenAIResponseDTO: Decodable {
    let output: [OutputItemDTO]?
}

struct OutputItemDTO: Decodable {
    let type: String?
    let role: String?
    let content: [ContentItemDTO]?
}

struct ContentItemDTO: Decodable {
    let type: String?
    let text: String?
}

// MARK: - Model (Request)

struct OpenAIRequestBody: Encodable {
    let model: String
    let input: String
}

// MARK: - Model (API Client)

final class OpenAIClient {
    enum ClientError: Error, LocalizedError {
        case invalidURL
        case badStatusCode(Int)
        case emptyAnswer

        var errorDescription: String? {
            switch self {
            case .invalidURL: return "Invalid API URL."
            case .badStatusCode(let code): return "Server returned status code \(code)."
            case .emptyAnswer: return "No answer text found in response."
            }
        }
    }

    private let baseURL: URL
    private let apiKey: String
    private let session: URLSession

    init(baseURL: URL, apiKey: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.apiKey = apiKey
        self.session = session
    }

    func sendText(_ text: String, model: String = "gpt-4o", completion: @escaping (Result<String, Error>) -> Void) {
        let endpoint = baseURL.appendingPathComponent("openai/v1/responses")

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let body = OpenAIRequestBody(model: model, input: text)

        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            completion(.failure(error))
            return
        }

        session.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }

            guard let http = response as? HTTPURLResponse else {
                completion(.failure(URLError(.badServerResponse)))
                return
            }

            guard (200...299).contains(http.statusCode) else {
                completion(.failure(ClientError.badStatusCode(http.statusCode)))
                return
            }

            guard let data else {
                completion(.failure(URLError(.zeroByteResource)))
                return
            }

            do {
                let decoded = try JSONDecoder().decode(OpenAIResponseDTO.self, from: data)
                if let text = Self.extractAnswerText(from: decoded) {
                    completion(.success(text))
                } else {
                    completion(.failure(ClientError.emptyAnswer))
                }
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    /// Extracts ONLY the assistant's answer text from the response:
    /// output[] -> first item where role == "assistant" -> content[] -> first where type == "output_text" -> text
    private static func extractAnswerText(from dto: OpenAIResponseDTO) -> String? {
        guard let output = dto.output else { return nil }

        // Find assistant message
        let assistantItem = output.first { item in
            (item.type == "message") && (item.role == "assistant")
        }

        // Find output_text in its content
        let answer = assistantItem?.content?.first { $0.type == "output_text" }?.text
        return answer?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Controller (MVC)

final class ChatViewController: UIViewController {

    // UI
    private let inputTextView: UITextView = {
        let tv = UITextView()
        tv.text = "Hello AI!"
        tv.font = .systemFont(ofSize: 16)
        tv.layer.borderWidth = 1
        tv.layer.borderColor = UIColor.systemGray4.cgColor
        tv.layer.cornerRadius = 10
        tv.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
        tv.translatesAutoresizingMaskIntoConstraints = false
        return tv
    }()

    private let sendButton: UIButton = {
        var config = UIButton.Configuration.filled()
        config.title = "send"
        config.cornerStyle = .medium
        let b = UIButton(configuration: config)
        b.translatesAutoresizingMaskIntoConstraints = false
        return b
    }()

    private let outputLabel: UILabel = {
        let l = UILabel()
        l.numberOfLines = 0
        l.font = .systemFont(ofSize: 16)
        l.textColor = .label
        l.text = "Response will appear here."
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    private let activity: UIActivityIndicatorView = {
        let a = UIActivityIndicatorView(style: .medium)
        a.hidesWhenStopped = true
        a.translatesAutoresizingMaskIntoConstraints = false
        return a
    }()

    // Model dependency
    private let client: OpenAIClient

    // MARK: Init

    /// - Parameters:
    ///   - apiBaseURL: Example: URL(string: "https://your-domain.com")!
    ///   - apiKey: Your API key string
    init(apiBaseURL: URL, apiKey: String) {
        self.client = OpenAIClient(baseURL: apiBaseURL, apiKey: apiKey)
        super.init(nibName: nil, bundle: nil)
        self.title = "UIKit MVC Chat"
    }

    required init?(coder: NSCoder) {
        fatalError("Use init(apiBaseURL:apiKey:) instead.")
    }

    // MARK: Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        layout()
        sendButton.addTarget(self, action: #selector(didTapSend), for: .touchUpInside)

        // Dismiss keyboard on tap
        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
    }

    // MARK: Layout

    private func layout() {
        let stack = UIStackView(arrangedSubviews: [inputTextView, sendButton, activity, outputLabel])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),

            inputTextView.heightAnchor.constraint(equalToConstant: 120),

            sendButton.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    // MARK: Actions

    @objc private func didTapSend() {
        dismissKeyboard()

        let text = inputTextView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            outputLabel.text = "Please enter some text."
            return
        }

        setLoading(true)
        outputLabel.text = "Sending..."

        client.sendText(text, model: "gpt-4o") { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.setLoading(false)

                switch result {
                case .success(let answerText):
                    self.outputLabel.text = answerText
                case .failure(let error):
                    self.outputLabel.text = "Error: \(error.localizedDescription)"
                }
            }
        }
    }

    private func setLoading(_ isLoading: Bool) {
        sendButton.isEnabled = !isLoading
        inputTextView.isEditable = !isLoading
        isLoading ? activity.startAnimating() : activity.stopAnimating()
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }
}
