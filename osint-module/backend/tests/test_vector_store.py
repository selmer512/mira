import pytest

from app.services.vector_store import LocalEmbeddingModel


class FakeSentenceTransformer:
    def __init__(self, model_name):
        self.model_name = model_name

    def encode(self, text, normalize_embeddings=True):
        assert normalize_embeddings is True
        return [0.1, 0.2, 0.3]


@pytest.mark.asyncio
async def test_local_embedding_model_uses_sentence_transformer(monkeypatch):
    monkeypatch.setattr("app.services.vector_store.SentenceTransformer", FakeSentenceTransformer)
    embedder = LocalEmbeddingModel(model_name="local-test-model")

    vector = await embedder.embed("hello")

    assert vector == [0.1, 0.2, 0.3]
