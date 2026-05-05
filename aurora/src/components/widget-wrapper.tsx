import React from 'react'

export interface WidgetWrapperProps {
  children?: React.ReactNode
  noPadding?: boolean
  className?: string
}

export function WidgetWrapper({ children, noPadding = false, className }: WidgetWrapperProps) {
  return (
    <div
      className={`aurora-widget-wrapper${noPadding ? ' aurora-widget-wrapper--no-padding' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}
