import json
from typing import Any, Optional

from neo4j import AsyncGraphDatabase

from app.core.config import settings
from app.models.osint import CorrelationResult, ProfileResponse, SourceRecord


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

    async def ensure_schema(self) -> None:
        constraints = [
            "CREATE CONSTRAINT profile_id IF NOT EXISTS FOR (p:Profile) REQUIRE p.id IS UNIQUE",
            "CREATE CONSTRAINT entity_identity IF NOT EXISTS FOR (e:Entity) REQUIRE (e.type, e.value) IS UNIQUE",
            "CREATE CONSTRAINT ip_value IF NOT EXISTS FOR (ip:IpAddress) REQUIRE ip.value IS UNIQUE",
            "CREATE CONSTRAINT website_url IF NOT EXISTS FOR (w:Website) REQUIRE w.url IS UNIQUE",
            "CREATE CONSTRAINT image_hash_value IF NOT EXISTS FOR (h:ImageHash) REQUIRE h.value IS UNIQUE",
            "CREATE CONSTRAINT image_dimension_value IF NOT EXISTS FOR (d:ImageDimension) REQUIRE d.value IS UNIQUE",
            "CREATE CONSTRAINT exif_tag_identity IF NOT EXISTS FOR (t:ExifTag) REQUIRE (t.key, t.value) IS UNIQUE",
            "CREATE CONSTRAINT source_identity IF NOT EXISTS FOR (s:Source) REQUIRE (s.name, s.url, s.method) IS UNIQUE",
        ]
        async with self.driver.session(database=settings.neo4j_db) as session:
            for query in constraints:
                await session.run(query)

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
            scalar_attributes = GraphStore._scalar_attributes(entity.attributes)
            await tx.run(
                """
                MERGE (e:Entity {type: $type, value: $value})
                SET e.attributes_json = $attributes_json,
                    e.updated_at = datetime()
                WITH e
                MATCH (p:Profile {id: $profile_id})
                MERGE (p)-[r:HAS_ENTITY]->(e)
                SET r.confidence = $confidence
                """,
                profile_id=correlation.profile_id,
                type=entity.entity_type,
                value=entity.value,
                attributes_json=json.dumps(scalar_attributes, sort_keys=True),
                confidence=correlation.confidence,
            )
            await GraphStore._upsert_sources_tx(tx, correlation.profile_id, entity)
            await GraphStore._upsert_attribute_nodes_tx(tx, entity)

    @staticmethod
    def _scalar_attributes(attributes: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value
            for key, value in attributes.items()
            if value is None or isinstance(value, (str, int, float, bool))
        }

    @staticmethod
    async def _upsert_sources_tx(tx, profile_id: str, entity: Any) -> None:
        for source in entity.sources:
            await tx.run(
                """
                MATCH (p:Profile {id: $profile_id})
                MATCH (e:Entity {type: $type, value: $value})
                MERGE (s:Source {name: $name, url: $url, method: $method})
                SET s.collected_at = $collected_at
                MERGE (e)-[:OBSERVED_IN]->(s)
                MERGE (p)-[:HAS_SOURCE]->(s)
                """,
                profile_id=profile_id,
                type=entity.entity_type,
                value=entity.value,
                name=source.name,
                url=source.url or "",
                method=source.method,
                collected_at=source.collected_at,
            )

    @staticmethod
    async def _upsert_attribute_nodes_tx(tx, entity: Any) -> None:
        if entity.entity_type == "domain":
            for ip in entity.attributes.get("dns_records", []):
                await tx.run(
                    """
                    MATCH (e:Entity {type: $type, value: $value})
                    MERGE (ip:IpAddress {value: $ip})
                    MERGE (e)-[:RESOLVES_TO]->(ip)
                    """,
                    type=entity.entity_type,
                    value=entity.value,
                    ip=ip,
                )

        platform_candidates = entity.attributes.get("platform_candidates", {})
        for platform, url in platform_candidates.items():
            await tx.run(
                """
                MATCH (e:Entity {type: $type, value: $value})
                MERGE (candidate:Website {url: $url})
                SET candidate.platform = $platform
                MERGE (e)-[:HAS_PLATFORM_CANDIDATE]->(candidate)
                """,
                type=entity.entity_type,
                value=entity.value,
                platform=platform,
                url=url,
            )

        if entity.entity_type == "website":
            hostname = entity.attributes.get("hostname")
            if hostname:
                await tx.run(
                    """
                    MATCH (e:Entity {type: $type, value: $value})
                    MERGE (site:Website {url: $value})
                    SET site.hostname = $hostname
                    MERGE (e)-[:REPRESENTS_WEBSITE]->(site)
                    """,
                    type=entity.entity_type,
                    value=entity.value,
                    hostname=hostname,
                )

        if entity.entity_type == "image":
            phash = entity.attributes.get("phash")
            if phash:
                await tx.run(
                    """
                    MATCH (e:Entity {type: $type, value: $value})
                    MERGE (hash:ImageHash {value: $phash})
                    SET hash.algorithm = 'phash'
                    MERGE (e)-[:HAS_IMAGE_HASH]->(hash)
                    """,
                    type=entity.entity_type,
                    value=entity.value,
                    phash=phash,
                )

            size = entity.attributes.get("size")
            if isinstance(size, dict) and "width" in size and "height" in size:
                dimension_value = f"{size['width']}x{size['height']}"
                await tx.run(
                    """
                    MATCH (e:Entity {type: $type, value: $value})
                    MERGE (dim:ImageDimension {value: $dimension_value})
                    SET dim.width = $width,
                        dim.height = $height
                    MERGE (e)-[:HAS_DIMENSION]->(dim)
                    """,
                    type=entity.entity_type,
                    value=entity.value,
                    dimension_value=dimension_value,
                    width=int(size["width"]),
                    height=int(size["height"]),
                )

            exif = entity.attributes.get("exif", {})
            for key, value in exif.items():
                await tx.run(
                    """
                    MATCH (e:Entity {type: $type, value: $entity_value})
                    MERGE (tag:ExifTag {key: $key, value: $value})
                    MERGE (e)-[:HAS_EXIF_TAG]->(tag)
                    """,
                    type=entity.entity_type,
                    entity_value=entity.value,
                    key=str(key),
                    value=str(value),
                )

    async def get_profile(self, profile_id: str) -> Optional[ProfileResponse]:
        async with self.driver.session(database=settings.neo4j_db) as session:
            rows = await session.execute_read(self._get_profile_tx, profile_id)
        if not rows:
            return None

        aliases, emails, domains, websites, locations, sources = [], [], [], [], [], []
        seen_sources = set()
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
            for source in row.get("sources") or []:
                source_data = dict(source)
                source_key = (source_data.get("name"), source_data.get("url"), source_data.get("method"))
                if source_key in seen_sources or not source_data.get("name"):
                    continue
                seen_sources.add(source_key)
                sources.append(
                    SourceRecord(
                        name=source_data.get("name"),
                        url=source_data.get("url") or None,
                        method=source_data.get("method") or "public_lookup",
                        collected_at=source_data.get("collected_at"),
                    )
                )

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
            OPTIONAL MATCH (e)-[:OBSERVED_IN]->(s:Source)
            RETURN p.confidence AS confidence,
                   e.type AS type,
                   e.value AS value,
                   e.attributes_json AS attributes_json,
                   collect(DISTINCT s) AS sources
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
