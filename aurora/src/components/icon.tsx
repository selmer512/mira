import React from 'react'

export interface IconProps {
  iconName: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
  type?: 'fill' | 'line'
  bgShape?: 'circle' | 'square'
  color?: string
  bgColor?: string
  className?: string
}

const SIZE_MAP: Record<string, string> = {
  sm: '14px',
  md: '18px',
  lg: '22px',
  xl: '28px',
  xxl: '36px'
}

export function Icon({
  iconName,
  size = 'md',
  type = 'line',
  bgShape,
  color,
  bgColor,
  className
}: IconProps) {
  const iconClass = `ri-${iconName}-${type}`
  const sz = SIZE_MAP[size]

  const wrapperStyle: React.CSSProperties = bgShape
    ? {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `calc(${sz} * 2)`,
        height: `calc(${sz} * 2)`,
        borderRadius: bgShape === 'circle' ? '50%' : '6px',
        backgroundColor: bgColor
          ? `var(--aurora-color-${bgColor}, ${bgColor})`
          : undefined
      }
    : {}

  const iconStyle: React.CSSProperties = {
    fontSize: sz,
    color: color ? `var(--aurora-color-${color}, ${color})` : 'currentColor',
    lineHeight: 1
  }

  return (
    <span
      className={`aurora-icon${bgShape ? ` aurora-icon--${bgShape}` : ''}${className ? ` ${className}` : ''}`}
      style={wrapperStyle}
    >
      <i className={iconClass} style={iconStyle} />
    </span>
  )
}
