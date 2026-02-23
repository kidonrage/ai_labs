//
//  OpenAIClient.swift
//  AI_1
//
//  Created by Vlad Eliseev on 23.02.2026.
//

import Foundation

// MARK: - Model (DTOs)

struct OpenAIResponseDTO: Decodable {
    let createdAt: Int?
    let completedAt: Int?
    let model: String?
    let usage: UsageDTO?
    let output: [OutputItemDTO]?

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case completedAt = "completed_at"
        case model
        case usage
        case output
    }
}

struct UsageDTO: Decodable {
    let inputTokens: Int?
    let outputTokens: Int?
    let totalTokens: Int?

    enum CodingKeys: String, CodingKey {
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case totalTokens = "total_tokens"
    }
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

// MARK: - Model (Result for VC)

struct OpenAIChatUsage {
    let inputTokens: Int
    let outputTokens: Int
    let totalTokens: Int
}

struct OpenAIChatResponse {
    let answer: String
    let model: String?
    let usage: OpenAIChatUsage?
    let durationSeconds: Int?
    let costRub: Double?
}

// MARK: - Model (Pricing)

enum OpenAIModelPricing {
    // ₽ per 1M tokens
    static let rates: [String: (input: Double, output: Double)] = [
        "gpt-5.2": (input: 531.0, output: 4245.0),
        "gpt-4.1": (input: 516.0, output: 2062.0),
        "gpt-3.5-turbo": (input: 129.0, output: 387.0)
    ]

    static func key(for model: String?) -> String? {
        guard let model else { return nil }
        // match by prefix, so "gpt-4.1-xxxx" тоже сработает
        if model.hasPrefix("gpt-5.2") { return "gpt-5.2" }
        if model.hasPrefix("gpt-4.1") { return "gpt-4.1" }
        if model.hasPrefix("gpt-3.5-turbo") { return "gpt-3.5-turbo" }
        return nil
    }

    static func costRub(model: String?, inputTokens: Int, outputTokens: Int) -> Double? {
        guard let k = key(for: model), let r = rates[k] else { return nil }
        let inCost = (Double(inputTokens) / 1_000_000.0) * r.input
        let outCost = (Double(outputTokens) / 1_000_000.0) * r.output
        return inCost + outCost
    }
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

    func sendText(
        _ text: String,
        model: String,
        temperature: Float,
        completion: @escaping (Result<OpenAIChatResponse, Error>) -> Void
    ) {
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

                guard let answerText = Self.extractAnswerText(from: decoded) else {
                    completion(.failure(ClientError.emptyAnswer))
                    return
                }

                let usage: OpenAIChatUsage? = {
                    guard
                        let u = decoded.usage,
                        let inTok = u.inputTokens,
                        let outTok = u.outputTokens,
                        let totalTok = u.totalTokens
                    else { return nil }
                    return OpenAIChatUsage(inputTokens: inTok, outputTokens: outTok, totalTokens: totalTok)
                }()

                let durationSeconds: Int? = {
                    guard let c = decoded.createdAt, let d = decoded.completedAt else { return nil }
                    return d - c
                }()

                let costRub: Double? = {
                    guard let usage else { return nil }
                    // ВАЖНО: считаем по имени модели из ответа, если оно есть.
                    // Если вдруг API вернёт nil model, можно fallback'нуться на "model" из запроса.
                    let modelName = decoded.model ?? model
                    return OpenAIModelPricing.costRub(model: modelName, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens)
                }()

                let result = OpenAIChatResponse(
                    answer: answerText,
                    model: decoded.model ?? model,
                    usage: usage,
                    durationSeconds: durationSeconds,
                    costRub: costRub
                )

                completion(.success(result))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    /// Extracts ONLY the assistant's answer text from the response:
    /// output[] -> first item where role == "assistant" -> content[] -> first where type == "output_text" -> text
    private static func extractAnswerText(from dto: OpenAIResponseDTO) -> String? {
        guard let output = dto.output else { return nil }

        let assistantItem = output.first { item in
            (item.type == "message") && (item.role == "assistant")
        }

        let answer = assistantItem?.content?.first { $0.type == "output_text" }?.text
        return answer?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
