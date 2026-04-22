import axios from 'axios'
import '@mira-ai/aurora/style.css'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import MiraLogo, { MiraVoicePresence } from './mira-logo.jsx'

window.miraInitStatusEvent = new EventTarget()

import './init'
import Client from './client'
import Recorder from './recorder'
import { onkeydownstartrecording, onkeydowninput } from './onkeydown'

const config = {
  app: 'webapp',
  server_host: import.meta.env.VITE_MIRA_HOST,
  server_port: import.meta.env.VITE_MIRA_PORT,
  min_decibels: -40, // Noise detection sensitivity
  max_blank_time: 1_000 // Maximum time to consider a blank (ms)
}
const serverUrl =
  import.meta.env.VITE_MIRA_NODE_ENV === 'production'
    ? ''
    : `${config.server_host}:${config.server_port}`

document.addEventListener('DOMContentLoaded', async () => {
  const logoEl = document.querySelector('#mira-logo-root')
  if (logoEl) {
    createRoot(logoEl).render(createElement(MiraLogo))
  }

  const voiceEl = document.querySelector('#voice-presence-root')
  if (voiceEl) {
    createRoot(voiceEl).render(createElement(MiraVoicePresence))
  }

  try {
    const response = await axios.get(`${serverUrl}/api/v1/info`)
    const input = document.querySelector('#utterance')
    const mic = document.querySelector('#mic-button')
    const v = document.querySelector('#version small')
    const infoButton = document.querySelector('#info')
    const client = new Client(config.app, serverUrl, input)
    let chunks = []

    window.miraConfigInfo = response.data
    const infoKeys = [
      'timeZone',
      'telemetry',
      'gpu',
      'graphicsComputeAPI',
      'totalVRAM',
      'freeVRAM',
      'usedVRAM',
      'llm',
      'shouldWarmUpLLMDuties',
      'isLLMActionRecognitionEnabled',
      'isLLMNLGEnabled',
      'stt',
      'tts',
      'mood',
      'version'
    ]
    const infoToDisplay = {}
    infoKeys.forEach((key) => {
      infoToDisplay[key] = window.miraConfigInfo[key]
    })

    v.textContent += window.miraConfigInfo.version

    client.updateMood(window.miraConfigInfo.mood)
    client.init()

    const infoPanel = document.querySelector('#info-panel')
    const infoPanelContent = document.querySelector('#info-panel-content')
    const infoPanelBackdrop = document.querySelector('#info-panel-backdrop')
    const infoPanelClose = document.querySelector('#info-panel-close')

    function openInfoPanel() {
      infoPanelContent.textContent = JSON.stringify(infoToDisplay, null, 2)
      infoPanel.classList.add('open')
      infoPanelBackdrop.classList.add('visible')
    }
    function closeInfoPanel() {
      infoPanel.classList.remove('open')
      infoPanelBackdrop.classList.remove('visible')
    }

    infoButton.addEventListener('click', openInfoPanel)
    infoPanelClose.addEventListener('click', closeInfoPanel)
    infoPanelBackdrop.addEventListener('click', closeInfoPanel)

    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          if (typeof MediaRecorder !== 'undefined') {
            const rec = new Recorder(stream, mic, window.miraConfigInfo)
            client.recorder = rec

            rec.ondataavailable((e) => {
              chunks.push(e.data)
            })

            rec.onstop(() => {
              const blob = new Blob(chunks)
              chunks = []
              rec.enabled = false

              if (blob.size >= 1_000) {
                client.socket.emit('recognize', blob)
              }
            })
          } else {
            console.warn('MediaRecorder is not supported on this browser.')
          }
        })
        .catch((err) => {
          console.warn('Microphone access denied or unavailable:', err)
        })
    }

    document.addEventListener('keydown', (e) => {
      onkeydownstartrecording(e, () => {
        client.asrStartRecording()
        /*if (rec.enabled === false) {
          input.value = ''
          rec.start()
          rec.enabled = true
        } else {
          rec.stop()
          rec.enabled = false
        }*/
      })
    })

    input.addEventListener('keydown', (e) => {
      onkeydowninput(e, client)
    })

    mic.addEventListener('click', (e) => {
      e.preventDefault()

      client.asrStartRecording()

      /*if (rec.enabled === false) {
        rec.start()
        rec.enabled = true
      } else {
        rec.stop()
        rec.enabled = false
      }*/
    })
  } catch (e) {
    alert(`Error: ${e.message}; ${JSON.stringify(e.response?.data)}`)
    console.error(e)
  }
})
