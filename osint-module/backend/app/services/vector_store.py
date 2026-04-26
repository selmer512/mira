from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from app.core.config import settings
from app.models.osint import CorrelationResult
import hashlib
import random

COLLECTION = "osint_profiles"

def deterministic_stub_embedding(text: str, size: int = 384):
    # Replace with a real embedding model in production.
    seed = int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)
    return [rng.uniform(-1, 1) for _ in range(size)]

class VectorStore:
    def __init__(self):
        self.client = AsyncQdrantClient(url=settings.qdrant_url)

    async def ensure_collection(self):
        collections = await self.client.get_collections()
        names = [c.name for c in collections.collections]
        if COLLECTION not in names:
            await self.client.create_collection(
                collection_name=COLLECTION,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE),
            )

    async def upsert_profile(self, correlation: CorrelationResult):
        await self.ensure_collection()
        text = " ".join([f"{e.entity_type}:{e.value}" for e in correlation.entities])
        vector = deterministic_stub_embedding(text)
        point_id = int(hashlib.sha256(correlation.profile_id.encode("utf-8")).hexdigest()[:15], 16)

        await self.client.upsert(
            collection_name=COLLECTION,
            points=[
                PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=correlation.model_dump(),
                )
            ],
        )
