from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network, NetworkError
from bridges.python.src.sdk.settings import Settings

settings = Settings()


def _get_network() -> Network:
    return Network({'base_url': settings.get('osint_service_url') or 'http://localhost:8000'})


def run(params: ActionParams) -> None:
    """Retrieve a stored OSINT profile by ID."""

    profile_id = None
    for item in params['current_entities']:
        if item['entity'] == 'profile_id':
            profile_id = item['resolution']['value']
            break

    if not profile_id:
        return mira.answer({'key': 'no_profile_id'})

    network = _get_network()
    try:
        network.request({'url': '/health', 'method': 'GET'})
    except Exception:
        return mira.answer({'key': 'service_unavailable'})

    try:
        resp = network.request({
            'url': f'/api/osint/profile/{profile_id}',
            'method': 'GET'
        })
        profile = resp['data']

        aliases = ', '.join(profile.get('aliases', [])) or 'none'
        emails = ', '.join(profile.get('emails', [])) or 'none'
        domains = ', '.join(profile.get('domains', [])) or 'none'
        sources = ', '.join(s.get('name', '?') for s in profile.get('sources', [])) or 'none'
        confidence = f"{profile.get('confidence', 0):.0%}"

        return mira.answer({
            'key': 'profile_found',
            'data': {
                'profile_id': profile_id,
                'confidence': confidence,
                'aliases': aliases,
                'emails': emails,
                'domains': domains,
                'sources': sources
            }
        })
    except NetworkError as e:
        if e.response['status_code'] == 404:
            return mira.answer({'key': 'profile_not_found', 'data': {'profile_id': profile_id}})
        return mira.answer({'key': 'profile_fetch_failed', 'data': {'profile_id': profile_id}})
