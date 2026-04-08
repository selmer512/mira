from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams


def run(params: ActionParams) -> None:
    """Ask for a retry"""

    resolvers = params['resolvers']
    decision = False

    for resolver in resolvers:
        if resolver['name'] == 'affirmation_denial':
            decision = resolver['value']

    if decision:
        return mira.answer({
            'key': 'confirm_retry',
            'core': {
                'isInActionLoop': False,
                'restart': True
            }
        })

    mira.answer({
        'key': 'deny_retry',
        'core': {
            'isInActionLoop': False
        }
    })
