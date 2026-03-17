from pathlib import Path
import json

import requests


DOCS_DIR = Path("docs")
SUPPORTED_EXTENSIONS = {".md", ".txt", ".py", ".js", ".json"}
OLLAMA_URL = "http://localhost:11434/api/embed"
OLLAMA_MODEL = "embeddinggemma"
FIXED_CHUNK_SIZE = 800
FIXED_OVERLAP = 100


def find_document_files(docs_dir):
    """Find all supported files inside the docs folder."""
    files = []

    if not docs_dir.exists():
        print(f"Folder not found: {docs_dir}")
        return files

    for path in sorted(docs_dir.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(path)

    return files


def read_text_file(path):
    """Read a text file as UTF-8 and return its content or None on error."""
    try:
        return path.read_text(encoding="utf-8")
    except Exception as error:
        print(f"Skipping unreadable file: {path} ({error})")
        return None


def load_documents(docs_dir):
    """Load all supported documents and keep only successfully read files."""
    documents = []

    for path in find_document_files(docs_dir):
        text = read_text_file(path)
        if text is None:
            continue

        documents.append(
            {
                "path": path,
                "name": path.name,
                "source": path.as_posix(),
                "text": text,
            }
        )

    return documents


def split_fixed_text(text, chunk_size, overlap):
    """Split text into overlapping fixed-size parts."""
    chunks = []

    if not text:
        return chunks

    step = chunk_size - overlap
    start = 0
    part_number = 1

    while start < len(text):
        end = start + chunk_size
        chunk_text = text[start:end]

        if not chunk_text.strip():
            start += step
            part_number += 1
            continue

        chunks.append(
            {
                "section": f"part_{part_number}",
                "text": chunk_text,
            }
        )

        start += step
        part_number += 1

    return chunks


def build_fixed_chunks(documents):
    """Create fixed-size chunks for every loaded document."""
    chunks = []
    chunk_number = 1

    for document in documents:
        parts = split_fixed_text(document["text"], FIXED_CHUNK_SIZE, FIXED_OVERLAP)

        for part in parts:
            chunks.append(
                {
                    "chunk_id": f"fixed_{chunk_number}",
                    "source": document["source"],
                    "file": document["name"],
                    "section": part["section"],
                    "strategy": "fixed",
                    "text": part["text"],
                }
            )
            chunk_number += 1

    return chunks


def parse_markdown_sections(text):
    """Split markdown text by headings and keep heading titles as section names."""
    lines = text.splitlines()
    sections = []
    current_title = None
    current_lines = []

    for line in lines:
        stripped_line = line.strip()

        if stripped_line.startswith(("# ", "## ", "### ")):
            if current_lines:
                section_text = "\n".join(current_lines).strip()
                if section_text:
                    sections.append(
                        {
                            "section": current_title or "full_document",
                            "text": section_text,
                        }
                    )

            current_title = stripped_line.lstrip("#").strip()
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        section_text = "\n".join(current_lines).strip()
        if section_text:
            sections.append(
                {
                    "section": current_title or "full_document",
                    "text": section_text,
                }
            )

    heading_sections = [section for section in sections if section["section"] != "full_document"]

    if heading_sections:
        return sections

    return [{"section": "full_document", "text": text}]


def build_structured_chunks(documents):
    """Create structure-based chunks: markdown by headings, others as one chunk."""
    chunks = []
    chunk_number = 1

    for document in documents:
        if document["path"].suffix.lower() == ".md":
            parts = parse_markdown_sections(document["text"])
        else:
            parts = [{"section": "full_document", "text": document["text"]}]

        for part in parts:
            if not part["text"].strip():
                continue

            chunks.append(
                {
                    "chunk_id": f"structured_{chunk_number}",
                    "source": document["source"],
                    "file": document["name"],
                    "section": part["section"],
                    "strategy": "structured",
                    "text": part["text"],
                }
            )
            chunk_number += 1

    return chunks


def get_embedding(text):
    """Request one embedding from Ollama for the given chunk text."""
    payload = {
        "model": OLLAMA_MODEL,
        "input": text,
    }

    try:
        response = requests.post(OLLAMA_URL, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as error:
        print(f"Failed to get embedding from Ollama: {error}")
        return None
    except ValueError as error:
        print(f"Failed to parse Ollama response: {error}")
        return None

    embedding = data.get("embeddings")

    # Ollama /api/embed usually returns a list of embeddings.
    # Because we send one input string, we expect the first item.
    if isinstance(embedding, list) and embedding and isinstance(embedding[0], list):
        return embedding[0]

    print("Ollama returned an unexpected embedding format.")
    return None


def attach_embeddings(chunks):
    """Add embeddings to chunks and skip chunks that failed to embed."""
    indexed_chunks = []

    for chunk in chunks:
        print(f"Embedding {chunk['chunk_id']} from {chunk['source']}")
        embedding = get_embedding(chunk["text"])

        if embedding is None:
            print(f"Skipping chunk without embedding: {chunk['chunk_id']}")
            continue

        indexed_chunk = dict(chunk)
        indexed_chunk["embedding"] = embedding
        indexed_chunks.append(indexed_chunk)

    return indexed_chunks


def save_json(path, data):
    """Save Python data to a JSON file with UTF-8 and readable formatting."""
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main():
    """Run the whole indexing pipeline from reading files to saving indexes."""
    documents = load_documents(DOCS_DIR)

    if not documents:
        print("No readable documents were found in the docs folder.")
        return

    fixed_chunks = build_fixed_chunks(documents)
    structured_chunks = build_structured_chunks(documents)

    print("Building embeddings for fixed chunks...")
    fixed_index = attach_embeddings(fixed_chunks)
    save_json(Path("index_fixed.json"), fixed_index)

    print("Building embeddings for structured chunks...")
    structured_index = attach_embeddings(structured_chunks)
    save_json(Path("index_structured.json"), structured_index)

    print("")
    print("Done.")
    print(f"Files processed: {len(documents)}")
    print(f"Fixed chunks created: {len(fixed_chunks)}")
    print(f"Structured chunks created: {len(structured_chunks)}")
    print(f"Fixed chunks saved: {len(fixed_index)}")
    print(f"Structured chunks saved: {len(structured_index)}")


if __name__ == "__main__":
    main()
