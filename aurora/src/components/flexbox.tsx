import React from 'react'

export interface FlexboxProps {
  children?: React.ReactNode
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  alignItems?: 'center' | 'flex-start' | 'flex-end' | 'stretch' | 'baseline'
  justifyContent?:
    | 'center'
    | 'flex-start'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  wrap?: 'wrap' | 'nowrap' | 'wrap-reverse'
  className?: string
}

const GAP_MAP: Record<string, string> = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px'
}

export function Flexbox({
  children,
  flexDirection = 'row',
  alignItems,
  justifyContent,
  gap,
  wrap,
  className
}: FlexboxProps) {
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection,
    alignItems,
    justifyContent,
    gap: gap ? GAP_MAP[gap] : undefined,
    flexWrap: wrap
  }

  return (
    <div className={`aurora-flexbox${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  )
}
