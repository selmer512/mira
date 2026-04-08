from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory


def run(params: ActionParams) -> None:
    """Mira introduces herself and ask about you if he does not know you yet"""
    owner = memory.get_owner()
    is_owner_saved = owner is not None

    if not is_owner_saved:
        return mira.answer({'key': 'mira_introduction_with_question'})

    return mira.answer({'key': 'mira_introduction'})
