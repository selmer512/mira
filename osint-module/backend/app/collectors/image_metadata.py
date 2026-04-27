from pathlib import Path
from typing import List, Dict, Any

from PIL import Image
import imagehash

from app.collectors.base import BaseCollector
from app.models.osint import Entity, SourceRecord


class ImageMetadataCollector(BaseCollector):
    async def collect(self, value: str, source_label: str = "manual") -> List[Entity]:
        path = Path(value).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise ValueError("Image input must be a valid local file path")

        metadata = self._extract_metadata(path)
        source = SourceRecord(name=source_label, method="image_file_metadata")

        return [
            Entity(
                entity_type="image",
                value=str(path),
                attributes=metadata,
                sources=[source],
            )
        ]

    def _extract_metadata(self, path: Path) -> Dict[str, Any]:
        with Image.open(path) as img:
            exif_raw = img.getexif() or {}
            exif = {str(k): str(v) for k, v in exif_raw.items()}
            phash = str(imagehash.phash(img))
            return {
                "filename": path.name,
                "format": img.format,
                "size": {"width": img.width, "height": img.height},
                "exif": exif,
                "phash": phash,
            }
