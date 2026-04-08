from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.memory import Memory

from datetime import datetime
from random import randint
from typing import TypedDict


class Owner(TypedDict):
    name: str
    birth_date: str


def run(_params: ActionParams) -> None:
    """Mira greets you"""

    time = datetime.time(datetime.now())

    # 1/2 chance to get deeper greetings
    if randint(0, 1) != 0:
        if time.hour >= 5 and time.hour <= 10:
            return mira.answer({'key': 'morning_good_day'})
        if time.hour == 11:
            return mira.answer({'key': 'morning'})
        if time.hour >= 12 and time.hour <= 17:
            return mira.answer({'key': 'afternoon'})
        if time.hour >= 18 and time.hour <= 21:
            return mira.answer({'key': 'evening'})
        if time.hour >= 22 and time.hour <= 23:
            return mira.answer({'key': 'night'})

        return mira.answer({'key': 'too_late'})

    try:
        owner_memory = Memory({'name': 'mira:introduction:owner'})
        owner: Owner = owner_memory.read()
        mira.answer({
            'key': 'default_with_name',
            'data': {
                'owner_name': owner['name'],
            }
        })
    except BaseException:
        return mira.answer({'key': 'default'})
