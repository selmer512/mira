from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper


def run(_params: ActionParams, params_helper: ParamsHelper) -> None:
    """Mira tells about partner assistants"""

    try:
        assistant_name = params_helper.get_action_argument('assistant_name').lower()
        mira.answer({
            'key': assistant_name
        })
    except BaseException:
        return mira.answer({'key': 'not_found'})
