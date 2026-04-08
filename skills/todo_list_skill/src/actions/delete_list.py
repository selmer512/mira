from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper
from ..lib import memory

from typing import Union


def run(params: ActionParams, params_helper: ParamsHelper) -> None:
    """Delete a to-do list"""

    list_name: Union[str, None] = None

    list_name = params_helper.get_action_argument('list_name').lower()

    if not memory.has_todo_list(list_name):
        return mira.answer({
            'key': 'list_does_not_exist',
            'data': {
                'list': list_name
            }
        })

    memory.delete_todo_list(list_name)

    mira.answer({
        'key': 'list_deleted',
        'data': {
            'list': list_name
        }
    })
