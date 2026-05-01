from app.api.osint import osint_ui


async def _html() -> str:
    response = await osint_ui()
    return response


def test_osint_ui_contains_required_workflows():
    import asyncio

    html = asyncio.run(_html())

    assert 'id="ingest"' in html
    assert 'id="ingest-async"' in html
    assert 'id="load-profile"' in html
    assert 'id="run-query"' in html
    assert 'id="run-search"' in html
    assert 'id="load-job"' in html
    assert 'id="error"' in html
    assert "/api/osint/query" in html
    assert "/api/osint/search" in html
    assert "/api/osint/jobs/" in html
