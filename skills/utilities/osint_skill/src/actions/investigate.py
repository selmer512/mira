from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network, NetworkError
from bridges.python.src.sdk.settings import Settings
from time import sleep

settings = Settings()


def _get_network() -> Network:
    return Network({'base_url': settings.get('osint_service_url') or 'http://localhost:8000'})


def _format_profile(profile: dict) -> str:
    lines = []
    for field, label in [
        ('aliases', 'Aliases'),
        ('emails', 'Emails'),
        ('domains', 'Domains'),
        ('websites', 'Websites'),
        ('locations', 'Locations'),
    ]:
        values = profile.get(field, [])
        if values:
            lines.append(f"{label}: {', '.join(values)}")
    sources = [s.get('name', '?') for s in profile.get('sources', [])]
    if sources:
        lines.append(f"Sources: {', '.join(sources)}")
    return '\n'.join(lines)


def run(params: ActionParams) -> None:
    """Investigate a target via the OSINT service."""

    target = None
    for item in params['current_entities']:
        if item['entity'] == 'target':
            target = item['resolution']['value']
            break

    if not target:
        return mira.answer({'key': 'no_target'})

    network = _get_network()
    try:
        network.request({'url': '/health', 'method': 'GET'})
    except Exception:
        return mira.answer({'key': 'service_unavailable'})

    mira.answer({'key': 'investigating', 'data': {'target': target}})

    # Attempt synchronous ingest first
    try:
        resp = network.request({
            'url': '/api/osint/ingest',
            'method': 'POST',
            'data': {'type': 'auto', 'value': target, 'source_label': 'mira'}
        })
        profile = resp['data']
        return mira.answer({
            'key': 'investigation_complete',
            'data': {
                'target': target,
                'profile_id': profile.get('profile_id', ''),
                'summary': _format_profile(profile)
            }
        })
    except NetworkError as e:
        # 4xx means bad input or auth — don't fall through to async
        if e.response['status_code'] < 500:
            return mira.answer({'key': 'investigation_failed', 'data': {'target': target}})
    except Exception:
        pass

    # Async fallback for transient 5xx or connection errors
    mira.answer({'key': 'queuing_investigation', 'data': {'target': target}})
    try:
        q = network.request({
            'url': '/api/osint/ingest/async',
            'method': 'POST',
            'data': {'type': 'auto', 'value': target, 'source_label': 'mira'}
        })
        job_id = q['data'].get('job_id')
    except Exception:
        return mira.answer({'key': 'investigation_failed', 'data': {'target': target}})

    poll_interval = settings.get('async_poll_interval_seconds') or 2
    max_attempts = settings.get('async_poll_max_attempts') or 15

    for _ in range(max_attempts):
        sleep(poll_interval)
        try:
            job = network.request({'url': f'/api/osint/jobs/{job_id}', 'method': 'GET'})['data']
            status = job.get('status')
            if status == 'completed':
                profile = job.get('result') or {}
                return mira.answer({
                    'key': 'investigation_complete',
                    'data': {
                        'target': target,
                        'profile_id': profile.get('profile_id', ''),
                        'summary': _format_profile(profile)
                    }
                })
            elif status == 'failed':
                return mira.answer({'key': 'investigation_failed', 'data': {'target': target}})
        except Exception:
            break

    return mira.answer({'key': 'investigation_timeout', 'data': {'target': target}})
