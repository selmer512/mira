from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network

from typing import Union, Literal


def run(params: ActionParams) -> None:
    """Check if a website is down or not"""

    domains: list[str] = []

    # Find entities from the current utterance
    for item in params['current_entities']:
        if item['entity'] == 'url':
            domains.append(item['resolution']['value'].lower())

    if len(domains) == 0:
        # Find entities from the context
        for item in params['entities']:
            if item['entity'] == 'url':
                domains.append(item['resolution']['value'].lower())

    network = Network()

    for domain in domains:
        state: Union[Literal['up'], Literal['down']] = 'up'
        website_name = domain[:domain.find('.')].title()

        mira.answer({
            'key': 'checking',
            'data': {
                'website_name': website_name
            }
        })

        try:
            network.request({
                'url': 'https://' + domain,
                'method': 'GET'
            })
            state = 'up'
        except Exception as e:
            if network.is_network_error(e):
                state = 'down'
            else:
                mira.answer({
                    'key': 'errors',
                    'data': {
                        'website_name': website_name
                    }
                })
                continue

        mira.answer({
            'key': state,
            'data': {
                'website_name': website_name
            }
        })

        if len(domains) == 0:
            mira.answer({
                'key': 'invalid_domain_name',
                'data': {
                    'website_name': website_name
                }
            })
