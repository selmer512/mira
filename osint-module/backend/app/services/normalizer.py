import re

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DOMAIN_RE = re.compile(r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+$")
IMAGE_RE = re.compile(r".*\.(png|jpg|jpeg|gif|webp|tiff)$", re.IGNORECASE)

def normalize_value(value: str) -> str:
    return value.strip()

def detect_input_type(value: str) -> str:
    value = normalize_value(value)
    if EMAIL_RE.match(value):
        return "email"
    if IMAGE_RE.match(value):
        return "image"
    if DOMAIN_RE.match(value):
        return "domain"
    return "username"
