//
//  ViewController.swift
//  AI_1
//
//  Created by Vlad Eliseev on 16.02.2026.
//

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

    private let modelSegmentedControl: UISegmentedControl = {
        let items = ["gpt-5.2", "gpt-4.1", "gpt-3.5-turbo"]
        let sc = UISegmentedControl(items: items)
        sc.selectedSegmentIndex = 0 // default: gpt-5.2
        sc.translatesAutoresizingMaskIntoConstraints = false
        return sc
    }()

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

    private let statsLabel: UILabel = {
        let l = UILabel()
        l.numberOfLines = 0
        l.textColor = .secondaryLabel
        l.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        l.text = "Tokens: —\nCost: —\nDuration: —"
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

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

    // MARK: Layout

    private func setupLayout() {
        view.addSubview(scrollView)
        scrollView.addSubview(stackView)

        stackView.addArrangedSubview(inputTextView)
        stackView.addArrangedSubview(modelSegmentedControl)
        stackView.addArrangedSubview(temperatureTextField)
        stackView.addArrangedSubview(sendButton)
        stackView.addArrangedSubview(activity)
        stackView.addArrangedSubview(statsLabel)
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
            modelSegmentedControl.heightAnchor.constraint(equalToConstant: 34),
            temperatureTextField.heightAnchor.constraint(equalToConstant: 44),
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

        let model: String = {
            switch modelSegmentedControl.selectedSegmentIndex {
            case 0: return "gpt-5.2"
            case 1: return "gpt-4.1"
            case 2: return "gpt-3.5-turbo"
            default: return "gpt-5.2"
            }
        }()

        let temperatureString = (temperatureTextField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = temperatureString.replacingOccurrences(of: ",", with: ".")

        guard let temp = Float(normalized), (0.0...2.0).contains(temp) else {
            outputTextView.text = "Temperature must be a Float string from 0.0 to 2.0 (e.g., 0.7, 1.0, 1.8)."
            return
        }

        setLoading(true)
        outputTextView.text = "Loading..."
        statsLabel.text = "Tokens: —\nCost: —\nDuration: —"

        client.sendText(text, model: model, temperature: temp) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.setLoading(false)

                switch result {
                case .success(let response):
                    self.outputTextView.text = response.answer

                    // Stats UI
                    let tokensLine: String = {
                        if let usage = response.usage {
                            return "Tokens: in \(usage.inputTokens), out \(usage.outputTokens), total \(usage.totalTokens)"
                        } else {
                            return "Tokens: —"
                        }
                    }()

                    let costLine: String = {
                        if let cost = response.costRub, let costStr = Self.formatRub(cost) {
                            return "Cost: \(costStr)"
                        } else {
                            return "Cost: —"
                        }
                    }()

                    let durationLine: String = {
                        if let duration = response.durationSeconds {
                            return "Duration: \(duration)s"
                        } else {
                            return "Duration: —"
                        }
                    }()

                    self.statsLabel.text = [tokensLine, costLine, durationLine].joined(separator: "\n")

                    self.scrollToBottom()

                case .failure(let error):
                    self.outputTextView.text = "Error: \(error.localizedDescription)"
                    self.statsLabel.text = "Tokens: —\nCost: —\nDuration: —"
                    self.scrollToBottom()
                }
            }
        }
    }

    private static func formatRub(_ value: Double) -> String? {
        let nf = NumberFormatter()
        nf.numberStyle = .currency
        nf.currencySymbol = "₽"
        nf.maximumFractionDigits = 4
        nf.minimumFractionDigits = 0
        nf.locale = Locale(identifier: "ru_RU")
        return nf.string(from: NSNumber(value: value))
    }

    private func setLoading(_ loading: Bool) {
        sendButton.isEnabled = !loading
        inputTextView.isEditable = !loading
        modelSegmentedControl.isEnabled = !loading
        temperatureTextField.isEnabled = !loading
        loading ? activity.startAnimating() : activity.stopAnimating()
    }

    private func scrollToBottom() {
        view.layoutIfNeeded()
        scrollView.layoutIfNeeded()

        let y = max(0, scrollView.contentSize.height - scrollView.bounds.height)
        scrollView.setContentOffset(CGPoint(x: 0, y: y), animated: true)
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }
}
