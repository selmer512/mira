from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network, NetworkError
from bridges.python.src.sdk.settings import Settings

settings = Settings()


def _get_network() -> Network:
    return Network({'base_url': settings.get('osint_service_url') or 'http://localhost:8000'})


def run(params: ActionParams) -> None:
    """Vector similarity search across stored OSINT profiles."""

    query = None
    for item in params['current_entities']:
        if item['entity'] == 'query':
            query = item['resolution']['value']
            break

    if not query:
        return mira.answer({'key': 'no_query'})

    network = _get_network()
    try:
        network.request({'url': '/health', 'method': 'GET'})
    except Exception:
        return mira.answer({'key': 'service_unavailable'})

    try:
        resp = network.request({
            'url': '/api/osint/search',
            'method': 'POST',
            'data': {'query': query, 'limit': 5}
        })
        hits = resp['data'].get('hits', [])

        if not hits:
            return mira.answer({'key': 'no_results', 'data': {'query': query}})

        result_lines = []
        for hit in hits:
            payload = hit.get('payload') or {}
            pid = payload.get('profile_id', hit.get('id', '?'))
            score = hit.get('score', 0.0)
            result_lines.append(f"• {pid} (score: {score:.2f})")

        return mira.answer({
            'key': 'search_results',
            'data': {
                'query': query,
                'count': len(hits),
                'results': '\n'.join(result_lines)
            }
        })
    except NetworkError:
        return mira.answer({'key': 'search_failed', 'data': {'query': query}})
