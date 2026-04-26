import hashlib
import random

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.core.config import settings
from app.models.osint import CorrelationResult


def deterministic_stub_embedding(text: str, size: int = 384):
    seed = int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)
    return [rng.uniform(-1, 1) for _ in range(size)]


class VectorStore:
    def __init__(self):
        self.client = AsyncQdrantClient(url=settings.qdrant_url)

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
                vectors_config=VectorParams(size=384, distance=Distance.COSINE),
            )

    async def upsert_profile(self, correlation: CorrelationResult):
        await self.ensure_collection()
        text = " ".join([f"{e.entity_type}:{e.value}" for e in correlation.entities])
        vector = deterministic_stub_embedding(text)
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
        vector = deterministic_stub_embedding(text)
        return await self.client.query_points(
            collection_name=settings.qdrant_collection,
            query=vector,
            limit=limit,
            with_payload=True,
        )
