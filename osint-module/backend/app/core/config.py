from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Mira OSINT API"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "mira_osint_password"
    neo4j_db: str = "neo4j"

    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "osint_profiles"

    redpanda_brokers: str = "localhost:9092"
    kafka_client_id: str = "mira-osint"
    kafka_request_timeout_ms: int = 30000

    pipeline_workers: int = 2
    pipeline_queue_size: int = 512

    enable_network_collectors: bool = False

    class Config:
        env_file = ".env"


settings = Settings()
