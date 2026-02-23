//
//  OpenAIClient.swift
//  AI_1
//
//  Created by Vlad Eliseev on 23.02.2026.
//

import Foundation

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

    func sendText(_ text: String, model: String, temperature: Float, completion: @escaping (Result<String, Error>) -> Void) {
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
