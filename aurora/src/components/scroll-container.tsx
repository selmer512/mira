import React from 'react'

export interface ScrollContainerProps {
  children?: React.ReactNode
  maxHeight?: string
  className?: string
}

export function ScrollContainer({ children, maxHeight = '300px', className }: ScrollContainerProps) {
  return (
    <div
      className={`aurora-scroll-container${className ? ` ${className}` : ''}`}
      style={{ overflowY: 'auto', maxHeight }}
    >
      {children}
    </div>
  )
}
