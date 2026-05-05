import React from 'react'

export interface TextProps {
  children?: React.ReactNode
  fontSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
  fontWeight?: 'regular' | 'semi-bold' | 'bold'
  secondary?: boolean
  className?: string
}

const FONT_SIZE_MAP: Record<string, string> = {
  xs: '11px',
  sm: '13px',
  md: '15px',
  lg: '18px',
  xl: '22px',
  xxl: '28px'
}

const FONT_WEIGHT_MAP: Record<string, string> = {
  regular: '400',
  'semi-bold': '600',
  bold: '700'
}

export function Text({
  children,
  fontSize = 'md',
  fontWeight = 'regular',
  secondary = false,
  className
}: TextProps) {
  const style: React.CSSProperties = {
    fontSize: FONT_SIZE_MAP[fontSize],
    fontWeight: FONT_WEIGHT_MAP[fontWeight],
    color: secondary ? 'var(--aurora-text-secondary-color)' : 'var(--aurora-text-color)',
    margin: 0
  }

  return (
    <span
      className={`aurora-text${secondary ? ' aurora-text--secondary' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {children}
    </span>
  )
}
