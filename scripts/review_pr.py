import base64
import json
import os
from pathlib import Path

import requests


def read_text_file(path: str) -> str:
    file_path = Path(path)
    if not file_path.exists():
        return ""
    return file_path.read_text(encoding="utf-8", errors="ignore")


def build_basic_auth_header(login: str, password: str) -> str:
    raw = f"{login}:{password}".encode("utf-8")
    encoded = base64.b64encode(raw).decode("utf-8")
    return f"Basic {encoded}"


def main() -> None:
    review_api_url = os.environ["REVIEW_API_URL"]
    basic_auth_login = os.environ["BASIC_AUTH_LOGIN"]
    basic_auth_password = os.environ["BASIC_AUTH_PASSWORD"]

    diff_text = read_text_file("pr.diff")
    changed_files_raw = read_text_file("changed_files.txt")
    changed_files = [line.strip() for line in changed_files_raw.splitlines() if line.strip()]

    payload = {
        "repository": os.environ.get("GITHUB_REPOSITORY", ""),
        "pull_request": {
            "number": os.environ.get("PR_NUMBER", ""),
            "title": os.environ.get("PR_TITLE", ""),
            "body": os.environ.get("PR_BODY", "") or "",
            "author": os.environ.get("PR_AUTHOR", ""),
            "base_ref": os.environ.get("BASE_REF", ""),
            "head_ref": os.environ.get("HEAD_REF", ""),
        },
        "diff": diff_text,
        "changed_files": changed_files,
    }

    auth_header = build_basic_auth_header(basic_auth_login, basic_auth_password)

    response = requests.post(
        review_api_url,
        headers={
            "Authorization": auth_header,
            "Content-Type": "application/json",
        },
        data=json.dumps(payload),
        timeout=300,
    )

    response.raise_for_status()

    response_json = response.json()
    review_text = response_json.get("review", "").strip()

    if not review_text:
        review_text = (
            "## AI PR Review\n\n"
            "Не удалось получить осмысленный review от backend.\n"
        )

    Path("review.md").write_text(review_text, encoding="utf-8")
    print("Review saved to review.md")


if __name__ == "__main__":
    main()