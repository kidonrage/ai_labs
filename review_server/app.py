from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="AI PR Review Service")


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


def build_prompt(payload: ReviewRequest, rag_context: str) -> str:
    changed_files_str = "\n".join(f"- {path}" for path in payload.changed_files) or "- none"

    prompt = f"""
You are a senior software engineer reviewing a pull request.

Your task:
- analyze the PR diff
- use the provided project context
- produce a concise markdown review

Focus on:
1. potential bugs
2. architectural concerns
3. recommendations

Be grounded. Do not invent issues without evidence.
If confidence is limited, explicitly say so.

Repository:
{payload.repository}

PR number:
{payload.pull_request.number}

PR title:
{payload.pull_request.title}

PR body:
{payload.pull_request.body}

Author:
{payload.pull_request.author}

Base branch:
{payload.pull_request.base_ref}

Head branch:
{payload.pull_request.head_ref}

Changed files:
{changed_files_str}

Project context:
{rag_context}

Diff:
{payload.diff[:120000]}
""".strip()

    return prompt


def retrieve_context(payload: ReviewRequest) -> str:
    """
    Заглушка под RAG.

    Потом здесь можно:
    - подмешивать README
    - искать релевантные куски в docs/
    - искать релевантные чанки кода по changed_files и diff
    """
    if payload.changed_files:
        files_preview = ", ".join(payload.changed_files[:10])
    else:
        files_preview = "no changed files provided"

    return (
        "Project documentation and code context are not connected yet. "
        f"Changed files received: {files_preview}."
    )


def call_llm(prompt: str, payload: ReviewRequest) -> str:
    """
    Временная заглушка.

    Потом сюда подставишь:
    - вызов Ollama
    - либо вызов твоего текущего backend / LLM gateway
    - либо RAG + LLM pipeline
    """
    changed_files_section = "\n".join(f"- `{file}`" for file in payload.changed_files) or "- No files detected"

    return f"""## AI PR Review

### Summary
PR received and parsed successfully. The current server is running in stub mode, so the review below is heuristic and meant to prove the pipeline works end-to-end.

### Potential bugs
- Review model is not connected yet, so no grounded bug analysis was performed.
- If the diff is very large, it may need chunking before sending to a real LLM.

### Architectural concerns
- RAG context is not connected yet, so architectural feedback does not yet use real project documentation or codebase context.
- You should later add retrieval for README, docs, and relevant code chunks near changed files.

### Recommendations
- Connect this endpoint to your existing RAG pipeline.
- Add retrieval based on changed files and symbols from the diff.
- Add a real LLM call and keep the output in this markdown structure.
- Add tests for empty diffs, huge diffs, and malformed payloads.

### Files in PR
{changed_files_section}

### Confidence
Low — this is a stub response proving transport, parsing, and response formatting.
"""


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/review-pr", response_model=ReviewResponse)
def review_pr(payload: ReviewRequest) -> ReviewResponse:
    if not payload.diff.strip():
        raise HTTPException(status_code=400, detail="Diff is empty")

    rag_context = retrieve_context(payload)
    prompt = build_prompt(payload, rag_context)
    review_text = call_llm(prompt, payload)

    return ReviewResponse(review=review_text)