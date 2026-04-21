import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const MODE_PRESETS = {
  identity: {
    lineOpacity: 0.92,
    haloOpacity: 0.16,
    ringOpacity: 0.04,
    pulseSpeed: 5.5,
    rippleScale: [0.98, 1.02, 0.98],
    shimmer: false,
    flare: false,
    ringCount: 1,
  },
  event: {
    lineOpacity: 1,
    haloOpacity: 0.34,
    ringOpacity: 0.18,
    pulseSpeed: 1.4,
    rippleScale: [0.94, 1.12, 1.18],
    shimmer: true,
    flare: true,
    ringCount: 2,
  },
  idle: {
    lineOpacity: 0.86,
    haloOpacity: 0.13,
    ringOpacity: 0.05,
    pulseSpeed: 6.8,
    rippleScale: [0.98, 1.04, 0.98],
    shimmer: false,
    flare: false,
    ringCount: 1,
  },
  listening: {
    lineOpacity: 0.9,
    haloOpacity: 0.2,
    ringOpacity: 0.08,
    pulseSpeed: 3.8,
    rippleScale: [0.98, 1.06, 1.01],
    shimmer: false,
    flare: false,
    ringCount: 2,
  },
  thinking: {
    lineOpacity: 0.94,
    haloOpacity: 0.24,
    ringOpacity: 0.1,
    pulseSpeed: 2.8,
    rippleScale: [0.96, 1.09, 1.02],
    shimmer: true,
    flare: false,
    ringCount: 2,
  },
  talking: {
    lineOpacity: 1,
    haloOpacity: 0.28,
    ringOpacity: 0.14,
    pulseSpeed: 1.8,
    rippleScale: [0.95, 1.1, 1.04],
    shimmer: true,
    flare: true,
    ringCount: 3,
  },
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return reduced
}

function useSimulatedAudio(enabled) {
  const [level, setLevel] = useState(0.12)

  useEffect(() => {
    if (!enabled) return
    let frame = 0
    let raf = 0

    const tick = () => {
      frame += 1
      const base = 0.15 + (Math.sin(frame / 12) + 1) * 0.12
      const detail = (Math.sin(frame / 4.5) + 1) * 0.05
      const spike = Math.random() > 0.92 ? Math.random() * 0.3 : 0
      setLevel(clamp(base + detail + spike, 0.05, 0.8))
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled])

  return level
}

export function MiraPresence({
  mode = 'idle',
  size = 240,
  animated = true,
  intensity = 1,
  responsiveToAudio = false,
  audioLevel,
  showBackground = true,
  onClick,
  'aria-label': ariaLabel = 'Mira presence',
}) {
  const reducedMotion = usePrefersReducedMotion()
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.idle
  const simulatedAudio = useSimulatedAudio(animated && responsiveToAudio)
  const resolvedAudio = clamp(audioLevel ?? simulatedAudio, 0, 1)
  const resolvedIntensity = clamp(intensity, 0.35, 1.6)
  const liveMotion = animated && !reducedMotion

  const dynamicBoost = useMemo(() => {
    if (!responsiveToAudio) return 0
    return resolvedAudio * 0.22
  }, [responsiveToAudio, resolvedAudio])

  const lineHeight = size * 0.64
  const auraSize = size * 0.74
  const lineWidth = Math.max(2, Math.round(size * 0.01))

  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={onClick ? 0 : -1}
      aria-label={ariaLabel}
      style={{
        position: 'relative',
        isolation: 'isolate',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: '2rem',
        border: showBackground ? '1px solid rgba(255,255,255,0.1)' : 'none',
        outline: 'none',
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: showBackground ? '#040404' : 'transparent',
        boxShadow: showBackground
          ? '0 25px 50px -12px rgba(0,0,0,0.5)'
          : 'none',
        width: size,
        height: size,
        padding: 0,
        flexShrink: 0,
      }}
    >
      {/* Background vignette */}
      <div
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            'radial-gradient(circle at center, rgba(80,92,108,0.08), rgba(0,0,0,0) 58%)',
          borderRadius: '2rem',
        }}
      />

      {/* Aura halo */}
      <motion.div
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          borderRadius: '50%',
          width: auraSize,
          height: auraSize,
          background:
            'radial-gradient(circle, rgba(224,232,240,0.12) 0%, rgba(150,168,184,0.06) 30%, rgba(90,104,120,0.02) 50%, rgba(0,0,0,0) 72%)',
          filter: `blur(${Math.max(12, size * 0.05)}px)`,
          opacity: (preset.haloOpacity + dynamicBoost) * resolvedIntensity,
        }}
        animate={
          liveMotion
            ? {
                scale: preset.rippleScale,
                opacity: [
                  (preset.haloOpacity + dynamicBoost * 0.7) * resolvedIntensity,
                  (preset.haloOpacity + 0.04 + dynamicBoost) *
                    resolvedIntensity,
                  (preset.haloOpacity + dynamicBoost * 0.7) * resolvedIntensity,
                ],
              }
            : undefined
        }
        transition={{
          duration: preset.pulseSpeed,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Orbital rings */}
      {Array.from({ length: preset.ringCount }).map((_, index) => {
        const delay = index * 0.55
        const scaleStart = 0.72 + index * 0.06
        const scaleEnd = 1.04 + index * 0.08 + dynamicBoost * 0.6
        return (
          <motion.div
            key={index}
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.1)',
              width: auraSize * (0.9 + index * 0.08),
              height: auraSize * (0.68 + index * 0.06),
              opacity: preset.ringOpacity * resolvedIntensity,
              filter: `blur(${Math.max(1.5, size * 0.004)}px)`,
              boxShadow: '0 0 40px rgba(200,210,220,0.04) inset',
            }}
            animate={
              liveMotion
                ? {
                    scale: [scaleStart, scaleEnd],
                    opacity: [preset.ringOpacity * resolvedIntensity, 0],
                  }
                : undefined
            }
            transition={{
              duration: preset.pulseSpeed * (mode === 'event' ? 0.75 : 1),
              repeat: Infinity,
              ease: 'easeOut',
              delay,
            }}
          />
        )
      })}

      {/* Vertical glow column */}
      <motion.div
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          borderRadius: '50%',
          width: Math.max(28, size * 0.16),
          height: lineHeight + size * 0.08,
          background:
            'radial-gradient(ellipse at center, rgba(190,205,220,0.18) 0%, rgba(115,130,148,0.08) 40%, rgba(0,0,0,0) 72%)',
          filter: `blur(${Math.max(16, size * 0.065)}px)`,
          opacity: (0.2 + dynamicBoost) * resolvedIntensity,
        }}
        animate={
          liveMotion
            ? {
                opacity: [
                  (0.18 + dynamicBoost) * resolvedIntensity,
                  (0.27 + dynamicBoost) * resolvedIntensity,
                  (0.18 + dynamicBoost) * resolvedIntensity,
                ],
              }
            : undefined
        }
        transition={{
          duration: preset.pulseSpeed * 0.9,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Vertical line */}
      <motion.div
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          borderRadius: '9999px',
          width: lineWidth,
          height: lineHeight,
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(214,222,230,0.9) 8%, rgba(255,255,255,1) 50%, rgba(214,222,230,0.9) 92%, rgba(255,255,255,0) 100%)',
          boxShadow: `0 0 ${Math.max(10, size * 0.05)}px rgba(255,255,255,0.3), 0 0 ${Math.max(28, size * 0.12)}px rgba(180,195,210,0.12)`,
          opacity: preset.lineOpacity,
        }}
        animate={
          liveMotion
            ? {
                scaleY:
                  mode === 'event'
                    ? [0.98, 1.04, 1]
                    : [1, 1.01 + dynamicBoost * 0.2, 1],
                opacity: [
                  preset.lineOpacity - 0.06,
                  preset.lineOpacity,
                  preset.lineOpacity - 0.04,
                ],
              }
            : undefined
        }
        transition={{
          duration: Math.max(1.15, preset.pulseSpeed * 0.72),
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Flare — event and talking modes */}
      <AnimatePresence>
        {preset.flare && (
          <motion.div
            key={mode + '-flare'}
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              width: Math.max(36, size * 0.18),
              height: lineHeight + size * 0.1,
              background:
                'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.45), rgba(255,255,255,0), rgba(255,255,255,0.45), rgba(255,255,255,0))',
              filter: `blur(${Math.max(10, size * 0.03)}px)`,
              mixBlendMode: 'screen',
            }}
            initial={{ opacity: 0, scaleY: 0.88 }}
            animate={
              liveMotion
                ? { opacity: [0.06, 0.26, 0.08], scaleY: [0.95, 1.06, 1] }
                : { opacity: 0.12 }
            }
            exit={{ opacity: 0 }}
            transition={{
              duration: mode === 'event' ? 0.9 : 1.6,
              repeat: liveMotion ? Infinity : 0,
              ease: 'easeInOut',
            }}
          />
        )}
      </AnimatePresence>

      {/* Shimmer — thinking and talking modes */}
      <AnimatePresence>
        {preset.shimmer && liveMotion && (
          <motion.div
            key={mode + '-shimmer'}
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              top: '18%',
              bottom: '18%',
              width: '40px',
              borderRadius: '9999px',
              background:
                'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0))',
              filter: 'blur(10px)',
              mixBlendMode: 'screen',
            }}
            initial={{ x: -size * 0.14, opacity: 0 }}
            animate={{ x: size * 0.14, opacity: [0, 0.22, 0] }}
            exit={{ opacity: 0 }}
            transition={{
              duration: mode === 'thinking' ? 2.1 : 1.4,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}
      </AnimatePresence>
    </button>
  )
}
