import hashlib
import asyncio
from typing import Any, Optional

try:
    from sentence_transformers import SentenceTransformer
except ImportError:  # pragma: no cover - exercised only when deployment deps are missing
    SentenceTransformer = None

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.core.config import settings
from app.models.osint import CorrelationResult


class LocalEmbeddingModel:
    def __init__(self, model_name: str = settings.embedding_model_name):
        self.model_name = model_name
        self._model: Optional[Any] = None
        self._lock = asyncio.Lock()

    async def _get_model(self) -> Any:
        if self._model is not None:
            return self._model
        async with self._lock:
            if self._model is None:
                if SentenceTransformer is None:
                    raise RuntimeError("sentence-transformers is required for local OSINT embeddings")
                self._model = await asyncio.to_thread(SentenceTransformer, self.model_name)
        return self._model

    async def embed(self, text: str) -> list[float]:
        model = await self._get_model()
        vector = await asyncio.to_thread(model.encode, text, normalize_embeddings=True)
        return [float(value) for value in vector]


class VectorStore:
    def __init__(self, embedder: Optional[LocalEmbeddingModel] = None):
        self.client = AsyncQdrantClient(url=settings.qdrant_url)
        self.embedder = embedder or LocalEmbeddingModel()

    async def close(self):
        await self.client.close()

    async def healthcheck(self) -> bool:
        await self.client.get_collections()
        return True

    async def ensure_collection(self):
        collections = await self.client.get_collections()
        names = [c.name for c in collections.collections]
        if settings.qdrant_collection not in names:
            await self.client.create_collection(
                collection_name=settings.qdrant_collection,
                vectors_config=VectorParams(size=settings.embedding_dimension, distance=Distance.COSINE),
            )

    async def upsert_profile(self, correlation: CorrelationResult):
        await self.ensure_collection()
        text = " ".join([f"{e.entity_type}:{e.value}" for e in correlation.entities])
        vector = await self.embedder.embed(text)
        point_id = int(hashlib.sha256(correlation.profile_id.encode("utf-8")).hexdigest()[:15], 16)

        await self.client.upsert(
            collection_name=settings.qdrant_collection,
            points=[
                PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=correlation.model_dump(),
                )
            ],
        )

    async def search_profiles(self, text: str, limit: int = 5):
        await self.ensure_collection()
        vector = await self.embedder.embed(text)
        return await self.client.query_points(
            collection_name=settings.qdrant_collection,
            query=vector,
            limit=limit,
            with_payload=True,
        )
