from typing import List
from app.collectors.base import BaseCollector
from app.models.osint import Entity, SourceRecord

class ImageMetadataCollector(BaseCollector):
    async def collect(self, value: str, source_label: str = "manual") -> List[Entity]:
        # Starter stub. Production can support uploaded files and EXIF extraction.
        # Do not infer sensitive identity attributes from faces or biometrics.
        source = SourceRecord(name=source_label, method="image_reference_input")
        return [
            Entity(
                entity_type="image",
                value=value,
                attributes={
                    "metadata_status": "not_extracted_in_stub",
                    "note": "Add EXIF extraction for user-provided files only.",
                },
                sources=[source],
            )
        ]
