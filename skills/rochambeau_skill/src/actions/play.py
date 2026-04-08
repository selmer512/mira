from bridges.python.src.sdk.mira import mira
from bridges.python.src.sdk.types import ActionParams

import random


def run(params: ActionParams) -> None:
    """Define the winner"""

    handsigns = {
        'ROCK': {
            'superior_to': 'SCISSORS',
            'inferior_to': 'PAPER',
            'emoji': '✊'
        },
        'PAPER': {
            'superior_to': 'ROCK',
            'inferior_to': 'SCISSORS',
            'emoji': '✋'
        },
        'SCISSORS': {
            'superior_to': 'PAPER',
            'inferior_to': 'ROCK',
            'emoji': '✌'
        }
    }
    entities = params['entities']
    player = {
        'handsign': None,
        'points': 0
    }
    mira_player = {
        'handsign': random.choice(list(handsigns)),
        'points': 0
    }

    # Find entities
    for entity in entities:
        if entity['entity'] == 'handsign':
            player['handsign'] = entity['option']

    # Exit the loop if no handsign has been found
    if player['handsign'] is None:
        mira.answer({'core': {'is_in_action_loop': False}})

    mira_emoji = handsigns[mira_player['handsign']]['emoji']
    player_emoji = handsigns[player['handsign']]['emoji']

    mira.answer({'key': 'mira_emoji', 'data': {'mira_emoji': mira_emoji}})

    if mira_player['handsign'] == player['handsign']:
        mira.answer({'key': 'equal'})

    # Point for Mira
    elif handsigns[mira_player['handsign']]['superior_to'] == player['handsign']:
        mira.answer({
            'key': 'point_for_mira',
            'data': {
                'handsign_1': mira_player['handsign'].lower(),
                'handsign_2': player['handsign'].lower()
            }
        })

    else:
        mira.answer({
            'key': 'point_for_player',
            'data': {
                'handsign_1': player['handsign'].lower(),
                'handsign_2': mira_player['handsign'].lower()
            }
        })

    mira.answer({
        'key': 'ask_for_rematch',
        'core': {
            'is_in_action_loop': False
        }
    })
