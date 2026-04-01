import os
from typing import Any, List

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="AI PR Review Service")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_TIMEOUT_SECONDS = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))


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
    files_preview = ", ".join(payload.changed_files[:10]) if payload.changed_files else "no changed files"
    return f"Changed files: {files_preview}. Project RAG is not connected yet."


def build_system_prompt() -> str:
    return """
You are a senior software engineer reviewing a pull request.

Be concise and grounded.
Use only the provided diff and context.
Do not invent issues without evidence.

Return markdown with exactly these sections:

## AI PR Review

### Summary
### Potential bugs
### Architectural concerns
### Recommendations
### Confidence
""".strip()


def build_user_prompt(payload: ReviewRequest, rag_context: str) -> str:
    limited_files = payload.changed_files[:15]
    changed_files_str = "\n".join(f"- {path}" for path in limited_files) or "- none"

    diff_limit = 20000
    diff_text = payload.diff[:diff_limit]
    truncated_note = ""
    if len(payload.diff) > diff_limit:
        truncated_note = "\nNOTE: Diff was truncated due to size limits."

    return f"""
Repository: {payload.repository}
PR title: {payload.pull_request.title}

Changed files:
{changed_files_str}

Context:
{rag_context}

Diff:
{diff_text}{truncated_note}
""".strip()


def fallback_review(reason: str, payload: ReviewRequest) -> str:
    files_md = "\n".join(f"- `{f}`" for f in payload.changed_files[:15]) or "- No files detected"

    return f"""## AI PR Review

### Summary
The automated review pipeline ran, but the local LLM did not finish in time.

### Potential bugs
- Full model-based review was not completed because Ollama timed out.
- Large diffs may overload the current local model setup.

### Architectural concerns
- No grounded architectural review was produced for this run.

### Recommendations
- Split the PR into smaller changes if possible.
- Reduce the diff size sent to the model.
- Upgrade to a stronger/faster model or increase server resources.
- Add RAG and review files in chunks instead of one large prompt.

### Confidence
Low — fallback response returned because: {reason}

### Files in PR
{files_md}
"""


def call_ollama_chat(system_prompt: str, user_prompt: str, payload: ReviewRequest) -> str:
    body: dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "think": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "options": {
            "temperature": 0.1,
            "num_predict": 700,
        },
    }

    print(f"Ollama model: {OLLAMA_MODEL}")
    print(f"Prompt length: {len(system_prompt) + len(user_prompt)}")
    print(f"Diff length: {len(payload.diff)}")
    print(f"Changed files count: {len(payload.changed_files)}")

    try:
        response = requests.post(
            OLLAMA_URL,
            json=body,
            timeout=OLLAMA_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.exceptions.Timeout:
        return fallback_review("Ollama request timed out", payload)
    except requests.exceptions.RequestException as exc:
        return fallback_review(f"Ollama request failed: {exc}", payload)

    data = response.json()
    content = data.get("message", {}).get("content", "").strip()

    if not content:
        return fallback_review("Ollama returned empty content", payload)

    return content


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "ollama-timeout-safe-v1"}


@app.post("/api/review-pr", response_model=ReviewResponse)
def review_pr(payload: ReviewRequest) -> ReviewResponse:
    if not payload.diff.strip():
        raise HTTPException(status_code=400, detail="Diff is empty")

    rag_context = retrieve_context(payload)
    system_prompt = build_system_prompt()
    user_prompt = build_user_prompt(payload, rag_context)

    review_text = call_ollama_chat(system_prompt, user_prompt, payload)
    return ReviewResponse(review=review_text)