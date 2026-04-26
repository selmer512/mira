from typing import Optional

from neo4j import AsyncGraphDatabase

from app.core.config import settings
from app.models.osint import CorrelationResult, ProfileResponse


class GraphStore:
    def __init__(self):
        self.driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )

    async def close(self):
        await self.driver.close()

    async def healthcheck(self) -> bool:
        async with self.driver.session(database=settings.neo4j_db) as session:
            res = await session.run("RETURN 1 AS ok")
            row = await res.single()
        return bool(row and row.get("ok") == 1)

    async def upsert_correlation(self, correlation: CorrelationResult):
        async with self.driver.session(database=settings.neo4j_db) as session:
            await session.execute_write(self._upsert_profile_tx, correlation)

    @staticmethod
    async def _upsert_profile_tx(tx, correlation: CorrelationResult):
        await tx.run(
            """
            MERGE (p:Profile {id: $profile_id})
            SET p.confidence = $confidence,
                p.updated_at = datetime()
            """,
            profile_id=correlation.profile_id,
            confidence=correlation.confidence,
        )

        for entity in correlation.entities:
            await tx.run(
                """
                MERGE (e:Entity {type: $type, value: $value})
                SET e.attributes = $attributes,
                    e.updated_at = datetime()
                WITH e
                MATCH (p:Profile {id: $profile_id})
                MERGE (p)-[r:HAS_ENTITY]->(e)
                SET r.confidence = $confidence
                """,
                profile_id=correlation.profile_id,
                type=entity.entity_type,
                value=entity.value,
                attributes=entity.attributes,
                confidence=correlation.confidence,
            )

    async def get_profile(self, profile_id: str) -> Optional[ProfileResponse]:
        async with self.driver.session(database=settings.neo4j_db) as session:
            rows = await session.execute_read(self._get_profile_tx, profile_id)
        if not rows:
            return None

        aliases, emails, domains, websites, locations, sources = [], [], [], [], [], []
        confidence = rows[0]["confidence"] or 0.0

        for row in rows:
            etype = row["type"]
            value = row["value"]
            if etype == "username":
                aliases.append(value)
            elif etype == "email":
                emails.append(value)
            elif etype == "domain":
                domains.append(value)
            elif etype == "website":
                websites.append(value)
            elif etype == "location":
                locations.append(value)

        return ProfileResponse(
            profile_id=profile_id,
            confidence=confidence,
            aliases=aliases,
            emails=emails,
            domains=domains,
            websites=websites,
            locations=locations,
            timeline=[],
            sources=sources,
        )

    @staticmethod
    async def _get_profile_tx(tx, profile_id: str):
        result = await tx.run(
            """
            MATCH (p:Profile {id: $profile_id})-[r:HAS_ENTITY]->(e:Entity)
            RETURN p.confidence AS confidence, e.type AS type, e.value AS value, e.attributes AS attributes
            """,
            profile_id=profile_id,
        )
        return [record async for record in result]

    async def safe_query(self, payload: dict):
        profile_id = payload.get("profile_id")
        entity_value = payload.get("entity_value")
        if profile_id:
            return await self.get_profile(profile_id)
        if entity_value:
            async with self.driver.session(database=settings.neo4j_db) as session:
                result = await session.run(
                    """
                    MATCH (p:Profile)-[:HAS_ENTITY]->(e:Entity {value: $value})
                    RETURN p.id AS profile_id
                    LIMIT 25
                    """,
                    value=entity_value,
                )
                return {"profiles": [r["profile_id"] async for r in result]}
        return {"error": "Allowed keys: profile_id or entity_value"}
