from cx_Freeze import setup, Executable
import requests.certs
import os

from version import __version__

options = {
    'build_exe': {
        # Add common dependencies for skills
        'includes': [
            'bs4',
            'requests',
            'timeit',
            'dataclasses',
            'abc',
            'platform',
            'pypdl'
        ],
        'include_files': [(requests.certs.where(), 'cacert.pem')]
    }
}

executables = [
    Executable(
        script=os.path.join('bridges', 'python', 'src', 'main.py'),
        target_name='mira-python-bridge'
    )
]

setup(
    name='mira-python-bridge',
    version=__version__,
    executables=executables,
    options=options
)
