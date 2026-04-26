from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "Mira OSINT API"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "mira_osint_password"

    qdrant_url: str = "http://localhost:6333"
    redpanda_brokers: str = "localhost:9092"

    enable_network_collectors: bool = False

    class Config:
        env_file = ".env"

settings = Settings()
