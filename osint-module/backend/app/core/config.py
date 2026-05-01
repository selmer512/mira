from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Mira OSINT API"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "mira_osint_password"
    neo4j_db: str = "neo4j"

    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "osint_profiles"
    embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384

    redpanda_brokers: str = "localhost:9092"
    kafka_client_id: str = "mira-osint"
    kafka_request_timeout_ms: int = 30000
    kafka_publish_retries: int = 5
    kafka_publish_backoff_seconds: float = 0.25
    kafka_publish_backoff_max_seconds: float = 5.0

    pipeline_workers: int = 2
    pipeline_queue_size: int = 512
    collector_timeout_seconds: float = 10.0

    enable_network_collectors: bool = False

    class Config:
        env_file = ".env"


settings = Settings()
