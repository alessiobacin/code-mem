#!/usr/bin/env python3
"""Run the Graphiti half of the CodeMem comparison in an isolated environment."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def normalized(text: str) -> str:
    return " ".join(tokens(text))


def expected_match(text: str, expected: list[list[str]]) -> bool:
    haystack = normalized(text)
    return any(all(normalized(term) in haystack for term in group) for group in expected)


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil((p / 100) * len(ordered)) - 1))
    return round(ordered[index], 3)


class HashEmbedder:
    """Deterministic local embedder: no remote embedding API in the comparison."""

    def __init__(self, dimensions: int = 256):
        self.dimensions = dimensions

    async def create(self, input_data):
        if isinstance(input_data, str):
            text = input_data
        else:
            text = " ".join(map(str, input_data))
        vector = [0.0] * self.dimensions
        for token in tokens(text):
            digest = hashlib.sha256(token.encode()).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            vector[index] += 1.0
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]

    async def create_batch(self, input_data_list):
        return [await self.create(input_data) for input_data in input_data_list]


class LexicalCrossEncoder:
    """Deterministic local reranker used only to keep the test reproducible."""

    async def rank(self, query: str, passages: list[str]):
        query_tokens = set(tokens(query))
        ranked = []
        for passage in passages:
            passage_tokens = set(tokens(passage))
            score = len(query_tokens & passage_tokens) / max(1, len(query_tokens))
            ranked.append((passage, score))
        return sorted(ranked, key=lambda item: item[1], reverse=True)


async def run(dataset_path: Path, output_path: Path) -> None:
    # Imports are intentionally inside the runner so the repository's Node-only
    # dependencies remain untouched. The benchmark venv supplies graphiti-core.
    from openai import AsyncOpenAI
    from graphiti_core import Graphiti
    from graphiti_core.cross_encoder.client import CrossEncoderClient
    from graphiti_core.driver.falkordb_driver import FalkorDriver
    from graphiti_core.embedder.client import EmbedderClient
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.llm_client.openai_client import OpenAIClient
    from graphiti_core.search.search_config_recipes import EDGE_HYBRID_SEARCH_RRF

    class LocalHashEmbedder(HashEmbedder, EmbedderClient):
        pass

    class LocalLexicalCrossEncoder(LexicalCrossEncoder, CrossEncoderClient):
        pass

    dataset = json.loads(dataset_path.read_text())
    started = time.perf_counter()
    result = {
        "system": "graphiti",
        "status": "running",
        "dataset": dataset["name"],
        "package": "graphiti-core==0.30.2",
        "llm": os.environ.get("GRAPHITI_MODEL", "llama3.1:8b"),
        "llm_base_url": os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1"),
        "embedding": "local-hash-256",
        "reranker": "local-lexical",
        "queries": [],
        "errors": [],
    }
    group_id = f"codemem-{hashlib.sha1(str(time.time_ns()).encode()).hexdigest()[:12]}"
    driver = None
    graphiti = None
    try:
        llm_config = LLMConfig(
            api_key=os.environ.get("OLLAMA_API_KEY", "ollama"),
            base_url=os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1"),
            model=os.environ.get("GRAPHITI_MODEL", "llama3.1:8b"),
            small_model=os.environ.get("GRAPHITI_SMALL_MODEL", "llama3.1:8b"),
            temperature=0,
            max_tokens=2048,
        )
        llm_client = OpenAIClient(config=llm_config, client=AsyncOpenAI(api_key=llm_config.api_key, base_url=llm_config.base_url), max_tokens=2048)
        driver = FalkorDriver(host=os.environ.get("FALKORDB_HOST", "127.0.0.1"), port=int(os.environ.get("FALKORDB_PORT", "6379")), database=f"bench_{group_id}")
        graphiti = Graphiti(
            llm_client=llm_client,
            embedder=LocalHashEmbedder(),
            cross_encoder=LocalLexicalCrossEncoder(),
            graph_driver=driver,
            max_coroutines=2,
        )
        await driver.build_indices_and_constraints()

        ingestion_latencies = []
        for memory in dataset["memories"]:
            start = time.perf_counter()
            await graphiti.add_episode(
                name=memory["id"],
                episode_body=memory["text"],
                source_description="CodeMem/Graphiti comparative E2E corpus",
                reference_time=datetime.fromisoformat(memory["reference_time"].replace("Z", "+00:00")),
                group_id=group_id,
                custom_extraction_instructions="Extract only facts explicitly stated in the episode. Keep dates and provider changes precise. Do not invent entities or relationships.",
            )
            ingestion_latencies.append((time.perf_counter() - start) * 1000)
        result["ingestion"] = {
            "episodes": len(dataset["memories"]),
            "latency_ms": {"p50": percentile(ingestion_latencies, 50), "p95": percentile(ingestion_latencies, 95), "total": round(sum(ingestion_latencies), 3)},
        }

        for query in dataset["queries"]:
            query_result = {"id": query["id"], "text": query["text"], "runs": [], "expected": query["expected"]}
            for _ in range(3):
                start = time.perf_counter()
                search_results = await graphiti.search_(query["text"], config=EDGE_HYBRID_SEARCH_RRF.model_copy(update={"limit": 8}), group_ids=[group_id])
                elapsed = (time.perf_counter() - start) * 1000
                rows = []
                for edge in search_results.edges:
                    rows.append({
                        "name": getattr(edge, "name", ""),
                        "fact": getattr(edge, "fact", ""),
                        "valid_at": str(getattr(edge, "valid_at", "") or ""),
                        "invalid_at": str(getattr(edge, "invalid_at", "") or ""),
                    })
                rank = next((index + 1 for index, row in enumerate(rows) if expected_match(f"{row['name']} {row['fact']}", query["expected"])), None)
                query_result["runs"].append({"latency_ms": round(elapsed, 3), "hit": rank is not None, "rank": rank, "rows": rows})
            result["queries"].append(query_result)
        result["status"] = "ok"
    except Exception as exc:  # the harness reports the exact limitation instead of faking parity
        result["status"] = "error"
        result["errors"].append({"type": type(exc).__name__, "message": str(exc)})
    finally:
        if graphiti is not None and driver is not None:
            try:
                await driver.close()
            except Exception as exc:
                result["errors"].append({"type": type(exc).__name__, "message": f"close: {exc}"})
    result["duration_ms"] = round((time.perf_counter() - started) * 1000, 3)
    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: graphiti_runner.py DATASET_JSON OUTPUT_JSON")
    asyncio.run(run(Path(sys.argv[1]), Path(sys.argv[2])))
