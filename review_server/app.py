import os
from typing import Any, List

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="AI PR Review Service")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:1.7b")
OLLAMA_TIMEOUT_SECONDS = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "300"))


class PullRequestInfo(BaseModel):
    number: str
    title: str
    body: str = ""
    author: str = ""
    base_ref: str = ""
    head_ref: str = ""


class ReviewRequest(BaseModel):
    repository: str
    pull_request: PullRequestInfo
    diff: str = Field(..., min_length=1)
    changed_files: List[str]


class ReviewResponse(BaseModel):
    review: str


def retrieve_context(payload: ReviewRequest) -> str:
    """
    Временная заглушка под RAG.

    Потом сюда можно встроить:
    - README
    - docs/
    - релевантные чанки кода по changed_files
    - поиск по символам из diff
    """
    if payload.changed_files:
        files_preview = ", ".join(payload.changed_files[:10])
    else:
        files_preview = "no changed files provided"

    return (
        "Project documentation and code context are not connected yet. "
        f"Changed files received: {files_preview}."
    )


def build_system_prompt() -> str:
    return """
You are a senior software engineer performing pull request review.

Your job is to analyze the pull request changes and produce a grounded markdown review.

Rules:
- Focus only on issues supported by the diff and project context.
- Do not invent problems without evidence.
- Prefer concrete, practical feedback over generic advice.
- Mention file names when possible.
- If confidence is limited, say so explicitly.
- Keep the review concise but useful.

Return markdown with exactly these sections:

## AI PR Review

### Summary
A short overall assessment.

### Potential bugs
Bullet list of likely bugs or risky logic issues.
If none are visible, say "- No concrete bugs found in the provided diff."

### Architectural concerns
Bullet list of maintainability / layering / duplication / abstraction issues.
If none are visible, say "- No major architectural concerns found in the provided diff."

### Recommendations
Bullet list of improvements, tests, or follow-up checks.
If none are needed, say "- No additional recommendations."

### Confidence
High / Medium / Low with one short explanation.
""".strip()


def build_user_prompt(payload: ReviewRequest, rag_context: str) -> str:
    changed_files_str = "\n".join(f"- {path}" for path in payload.changed_files) or "- none"

    diff_limit = 100_000
    diff_text = payload.diff[:diff_limit]
    truncated_note = ""
    if len(payload.diff) > diff_limit:
        truncated_note = "\nNOTE: The diff was truncated due to context limits."

    return f"""
Repository: {payload.repository}

PR number: {payload.pull_request.number}
PR title: {payload.pull_request.title}
PR body: {payload.pull_request.body}
Author: {payload.pull_request.author}
Base branch: {payload.pull_request.base_ref}
Head branch: {payload.pull_request.head_ref}

Changed files:
{changed_files_str}

Project context:
{rag_context}

PR diff:
{diff_text}{truncated_note}
""".strip()


def call_ollama_chat(system_prompt: str, user_prompt: str) -> str:
    payload: dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "think": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "options": {
            "temperature": 0.2,
        },
    }

    response = requests.post(
        OLLAMA_URL,
        json=payload,
        timeout=OLLAMA_TIMEOUT_SECONDS,
    )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama returned status {response.status_code}: {response.text[:1000]}",
        )

    data = response.json()
    message = data.get("message", {})
    content = message.get("content", "").strip()

    if not content:
        raise HTTPException(status_code=502, detail="Ollama returned empty content")

    return content


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/review-pr", response_model=ReviewResponse)
def review_pr(payload: ReviewRequest) -> ReviewResponse:
    if not payload.diff.strip():
        raise HTTPException(status_code=400, detail="Diff is empty")

    rag_context = retrieve_context(payload)
    system_prompt = build_system_prompt()
    user_prompt = build_user_prompt(payload, rag_context)

    review_text = call_ollama_chat(system_prompt, user_prompt)

    return ReviewResponse(review=review_text)