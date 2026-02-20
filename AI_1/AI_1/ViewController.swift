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
    let temperature: Float
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

    func sendText(_ text: String, model: String = "gpt-4o", temperature: Float, completion: @escaping (Result<String, Error>) -> Void) {
        let endpoint = baseURL.appendingPathComponent("openai/v1/responses")

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let body = OpenAIRequestBody(model: model, input: text, temperature: temperature)

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

import UIKit

final class ChatViewController: UIViewController {

    // MARK: UI

    private let scrollView: UIScrollView = {
        let sv = UIScrollView()
        sv.keyboardDismissMode = .interactive
        sv.translatesAutoresizingMaskIntoConstraints = false
        return sv
    }()

    private let stackView: UIStackView = {
        let s = UIStackView()
        s.axis = .vertical
        s.spacing = 16
        s.translatesAutoresizingMaskIntoConstraints = false
        return s
    }()

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

    // ✅ NEW: temperature
    private let temperatureTextField: UITextField = {
        let tf = UITextField()
        tf.placeholder = "temperature (0.0 - 2.0)"
        tf.text = "1.0"
        tf.keyboardType = .decimalPad
        tf.borderStyle = .roundedRect
        tf.clearButtonMode = .whileEditing
        tf.translatesAutoresizingMaskIntoConstraints = false
        return tf
    }()

    private let sendButton: UIButton = {
        var config = UIButton.Configuration.filled()
        config.title = "send"
        config.cornerStyle = .medium
        let b = UIButton(configuration: config)
        b.translatesAutoresizingMaskIntoConstraints = false
        return b
    }()

    private let activity: UIActivityIndicatorView = {
        let a = UIActivityIndicatorView(style: .medium)
        a.hidesWhenStopped = true
        a.translatesAutoresizingMaskIntoConstraints = false
        return a
    }()

    /// ✅ Лучше чем UILabel для больших текстов
    private let outputTextView: UITextView = {
        let tv = UITextView()
        tv.isEditable = false
        tv.isScrollEnabled = false // важно: скроллим внешним scrollView
        tv.font = .systemFont(ofSize: 14)
        tv.textColor = .label
        tv.backgroundColor = .secondarySystemBackground
        tv.layer.cornerRadius = 12
        tv.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
        tv.text = "Response will appear here."
        tv.translatesAutoresizingMaskIntoConstraints = false
        return tv
    }()

    // MARK: Model

    private let client: OpenAIClient

    init(apiBaseURL: URL, apiKey: String) {
        self.client = OpenAIClient(baseURL: apiBaseURL, apiKey: apiKey)
        super.init(nibName: nil, bundle: nil)
        self.title = "UIKit MVC Chat"
    }

    required init?(coder: NSCoder) {
        fatalError("Use init(apiBaseURL:apiKey:)")
    }

    // MARK: Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        setupLayout()
        sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)

        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
    }

    // MARK: Layout (✅ правильный scroll layout)

    private func setupLayout() {
        view.addSubview(scrollView)
        scrollView.addSubview(stackView)

        stackView.addArrangedSubview(inputTextView)
        stackView.addArrangedSubview(temperatureTextField) // ✅ NEW
        stackView.addArrangedSubview(sendButton)
        stackView.addArrangedSubview(activity)
        stackView.addArrangedSubview(outputTextView)

        NSLayoutConstraint.activate([
            // scrollView
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            // stackView pinned to contentLayoutGuide
            stackView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 16),
            stackView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -16),
            stackView.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 16),
            stackView.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -16),

            // IMPORTANT: stackView width == scrollView frame width (minus insets)
            stackView.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -32),

            inputTextView.heightAnchor.constraint(equalToConstant: 200),
            temperatureTextField.heightAnchor.constraint(equalToConstant: 44), // ✅ NEW
            sendButton.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    // MARK: Actions

    @objc private func sendTapped() {
        dismissKeyboard()

        let text = inputTextView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            outputTextView.text = "Please enter some text."
            return
        }

        // ✅ NEW: validate temperature as string Float in 0.0...2.0
        let temperatureString = (temperatureTextField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        // Разрешим запятую, если юзер ввёл "0,7"
        let normalized = temperatureString.replacingOccurrences(of: ",", with: ".")

        guard let temp = Float(normalized), (0.0...2.0).contains(temp) else {
            outputTextView.text = "Temperature must be a Float string from 0.0 to 2.0 (e.g., 0.7, 1.0, 1.8)."
            return
        }

        setLoading(true)
        outputTextView.text = "Loading..."

        // ✅ NEW: передаём temperature строкой
        client.sendText(text, temperature: temp) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.setLoading(false)

                switch result {
                case .success(let answer):
                    self.outputTextView.text = answer
                    self.scrollToBottom()

                case .failure(let error):
                    self.outputTextView.text = "Error: \(error.localizedDescription)"
                    self.scrollToBottom()
                }
            }
        }
    }

    private func setLoading(_ loading: Bool) {
        sendButton.isEnabled = !loading
        inputTextView.isEditable = !loading
        temperatureTextField.isEnabled = !loading // ✅ NEW
        loading ? activity.startAnimating() : activity.stopAnimating()
    }

    private func scrollToBottom() {
        // важно: заставляем автолэйаут пересчитать высоты ДО измерения contentSize
        view.layoutIfNeeded()
        scrollView.layoutIfNeeded()

        let y = max(0, scrollView.contentSize.height - scrollView.bounds.height)
        scrollView.setContentOffset(CGPoint(x: 0, y: y), animated: true)
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }
}
