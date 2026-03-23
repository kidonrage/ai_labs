from pathlib import Path
import json
import re

import requests


DOCS_DIR = Path("docs")
SUPPORTED_EXTENSIONS = {".md", ".txt", ".py", ".js", ".json"}
OLLAMA_URL = "http://localhost:11434/api/embed"
OLLAMA_MODEL = "embeddinggemma"
FIXED_CHUNK_SIZE = 800
FIXED_OVERLAP = 100
STRUCTURED_CHUNK_SIZE = 900
STRUCTURED_OVERLAP = 120
MIN_STRUCTURED_CHUNK_TEXT = 120
LOW_SIGNAL_SECTION_NAMES = {"table of contents", "contents", "toc"}
LIST_ITEM_RE = re.compile(r"^([-*+] |\d+[.)] )")


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


def compact_text(text):
    """Collapse whitespace to estimate useful text size."""
    return " ".join(str(text or "").split())


def chunk_plain_text(text, chunk_size):
    """Split plain text into bounded chunks, preferring whitespace boundaries."""
    chunks = []
    raw_text = str(text or "").strip()

    if not raw_text:
        return chunks

    start = 0

    while start < len(raw_text):
        end = min(len(raw_text), start + chunk_size)

        if end < len(raw_text):
            boundary = raw_text.rfind(" ", start + max(1, chunk_size // 2), end)
            if boundary > start:
                end = boundary

        chunk_text = raw_text[start:end].strip()
        if chunk_text:
            chunks.append(chunk_text)

        start = end
        while start < len(raw_text) and raw_text[start].isspace():
            start += 1

    return chunks


def split_large_block(text, chunk_size):
    """Split one oversized block by lines, sentences, or plain text fallback."""
    block_text = str(text or "").strip()

    if not block_text:
        return []

    if len(block_text) <= chunk_size:
        return [block_text]

    lines = [line.strip() for line in block_text.splitlines() if line.strip()]
    if len(lines) > 1:
        units = lines
        separator = "\n"
    else:
        sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", block_text) if part.strip()]
        if len(sentences) > 1:
            units = sentences
            separator = " "
        else:
            return chunk_plain_text(block_text, chunk_size)

    chunks = []
    current = []

    for unit in units:
        candidate = separator.join(current + [unit]).strip() if current else unit
        if current and len(candidate) > chunk_size:
            chunks.append(separator.join(current).strip())
            current = [unit]
        else:
            current.append(unit)

    if current:
        chunks.append(separator.join(current).strip())

    normalized = []
    for chunk_text in chunks:
        if len(chunk_text) <= chunk_size:
            normalized.append(chunk_text)
        else:
            normalized.extend(chunk_plain_text(chunk_text, chunk_size))

    return normalized


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


def strip_leading_markdown_heading(text):
    """Remove the first markdown heading from a section body."""
    lines = str(text or "").splitlines()
    if not lines:
        return ""

    first_non_empty_index = None
    for index, line in enumerate(lines):
        if line.strip():
            first_non_empty_index = index
            break

    if first_non_empty_index is None:
        return ""

    if lines[first_non_empty_index].lstrip().startswith("#"):
        lines = lines[first_non_empty_index + 1 :]
    else:
        lines = lines[first_non_empty_index:]

    return "\n".join(lines).strip()


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


def split_text_blocks(text):
    """Split text into semantic blocks: paragraphs, list items, and code fences."""
    blocks = []
    current_lines = []
    current_kind = None
    in_code_block = False

    def flush_current():
        nonlocal current_lines, current_kind
        if current_lines:
            block_text = "\n".join(current_lines).strip()
            if block_text:
                blocks.append(block_text)
        current_lines = []
        current_kind = None

    for line in str(text or "").splitlines():
        stripped = line.strip()

        if stripped.startswith("```"):
            if not in_code_block:
                flush_current()
                current_lines = [line]
                current_kind = "code"
                in_code_block = True
            else:
                current_lines.append(line)
                flush_current()
                in_code_block = False
            continue

        if in_code_block:
            current_lines.append(line)
            continue

        if not stripped:
            flush_current()
            continue

        is_list_item = bool(LIST_ITEM_RE.match(stripped))

        if is_list_item:
            flush_current()
            current_lines = [line]
            current_kind = "list"
            continue

        if current_kind == "list":
            current_lines.append(line)
            continue

        if current_kind == "paragraph":
            current_lines.append(line)
            continue

        flush_current()
        current_lines = [line]
        current_kind = "paragraph"

    flush_current()
    return blocks


def take_overlap_blocks(blocks, overlap_chars):
    """Keep a small tail from the previous chunk to stabilize retrieval."""
    overlap = []
    total_length = 0

    for block in reversed(blocks):
        added_length = len(block) + (2 if overlap else 0)
        overlap.insert(0, block)
        total_length += added_length
        if total_length >= overlap_chars:
            break

    return overlap


def pack_blocks_into_chunks(blocks, chunk_size, overlap_chars):
    """Assemble bounded chunks from semantic blocks."""
    chunks = []
    current = []

    def joined_length(items):
        if not items:
            return 0
        return len("\n\n".join(items))

    for block in blocks:
        block_text = str(block or "").strip()
        if not block_text:
            continue

        candidate = "\n\n".join(current + [block_text]).strip() if current else block_text
        if current and len(candidate) > chunk_size:
            chunks.append("\n\n".join(current).strip())
            current = take_overlap_blocks(current, overlap_chars)

            while current and len("\n\n".join(current + [block_text])) > chunk_size:
                current.pop(0)

        if current and len("\n\n".join(current + [block_text])) <= chunk_size:
            current.append(block_text)
        elif not current:
            current = [block_text]
        else:
            chunks.append("\n\n".join(current).strip())
            current = [block_text]

    if current:
        chunks.append("\n\n".join(current).strip())

    if len(chunks) > 1 and joined_length([chunks[-1]]) < MIN_STRUCTURED_CHUNK_TEXT:
        chunks[-2] = f"{chunks[-2]}\n\n{chunks[-1]}".strip()
        chunks.pop()

    return chunks


def should_skip_markdown_section(section_name, text):
    """Drop noisy markdown sections that mostly hurt retrieval quality."""
    normalized_name = str(section_name or "").strip().lower()
    compact = compact_text(text)

    if normalized_name in LOW_SIGNAL_SECTION_NAMES:
        return True

    if len(compact) < MIN_STRUCTURED_CHUNK_TEXT:
        return True

    return False


def build_structured_parts(section_name, text, is_markdown):
    """Split one logical section into retrieval-friendly subchunks."""
    raw_text = str(text or "").strip()
    if not raw_text:
        return []

    heading_prefix = ""
    body_text = raw_text

    if is_markdown:
        heading_prefix = f"## {section_name}".strip()
        body_text = strip_leading_markdown_heading(raw_text)
        if should_skip_markdown_section(section_name, body_text):
            return []
    elif len(compact_text(raw_text)) < 40:
        return []

    payload_text = body_text or raw_text
    max_payload_size = STRUCTURED_CHUNK_SIZE - (len(heading_prefix) + 2 if heading_prefix else 0)
    max_payload_size = max(200, max_payload_size)

    blocks = split_text_blocks(payload_text)
    expanded_blocks = []

    for block in blocks if blocks else [payload_text]:
        expanded_blocks.extend(split_large_block(block, max_payload_size))

    payload_chunks = pack_blocks_into_chunks(
        expanded_blocks,
        max_payload_size,
        STRUCTURED_OVERLAP,
    )

    parts = []
    for index, payload_chunk in enumerate(payload_chunks, start=1):
        chunk_text = (
            f"{heading_prefix}\n\n{payload_chunk}".strip()
            if heading_prefix
            else payload_chunk.strip()
        )
        if len(compact_text(chunk_text)) < MIN_STRUCTURED_CHUNK_TEXT:
            continue
        parts.append(
            {
                "section": section_name if len(payload_chunks) == 1 else f"{section_name} / part_{index}",
                "text": chunk_text,
            }
        )

    return parts


def build_structured_chunks(documents):
    """Create structure-aware chunks with hard size limits."""
    chunks = []
    chunk_number = 1

    for document in documents:
        is_markdown = document["path"].suffix.lower() == ".md"
        raw_parts = (
            parse_markdown_sections(document["text"])
            if is_markdown
            else [{"section": "full_document", "text": document["text"]}]
        )

        for part in raw_parts:
            structured_parts = build_structured_parts(
                part.get("section", "full_document"),
                part.get("text", ""),
                is_markdown,
            )

            for structured_part in structured_parts:
                if not structured_part["text"].strip():
                    continue

                chunks.append(
                    {
                        "chunk_id": f"structured_{chunk_number}",
                        "source": document["source"],
                        "file": document["name"],
                        "section": structured_part["section"],
                        "strategy": "structured",
                        "text": structured_part["text"],
                    }
                )
                chunk_number += 1

    return chunks


def save_index_outputs(file_name, data):
    """Save generated indexes to the local project and shared app static folder."""
    targets = [Path(file_name)]
    shared_static_path = Path("..") / "static" / file_name

    if shared_static_path.parent.exists():
        targets.append(shared_static_path)

    for target in targets:
        save_json(target, data)


def print_chunk_statistics(name, chunks):
    """Print simple chunk size diagnostics to spot retrieval problems early."""
    sizes = sorted(len(compact_text(chunk.get("text", ""))) for chunk in chunks if chunk.get("text"))

    if not sizes:
        print(f"{name}: no chunks")
        return

    def pick(percentile):
        index = min(len(sizes) - 1, int((len(sizes) - 1) * percentile))
        return sizes[index]

    print(
        f"{name}: count={len(sizes)} min={pick(0):d} "
        f"p50={pick(0.5):d} p90={pick(0.9):d} max={pick(1):d}"
    )


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
    print_chunk_statistics("Fixed chunks", fixed_chunks)
    print_chunk_statistics("Structured chunks", structured_chunks)

    print("Building embeddings for fixed chunks...")
    fixed_index = attach_embeddings(fixed_chunks)
    save_index_outputs("index_fixed.json", fixed_index)

    print("Building embeddings for structured chunks...")
    structured_index = attach_embeddings(structured_chunks)
    save_index_outputs("index_structured.json", structured_index)

    print("")
    print("Done.")
    print(f"Files processed: {len(documents)}")
    print(f"Fixed chunks created: {len(fixed_chunks)}")
    print(f"Structured chunks created: {len(structured_chunks)}")
    print(f"Fixed chunks saved: {len(fixed_index)}")
    print(f"Structured chunks saved: {len(structured_index)}")


if __name__ == "__main__":
    main()
