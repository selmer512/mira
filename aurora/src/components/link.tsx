import React from 'react'

export interface LinkProps {
  href: string
  children?: React.ReactNode
  target?: string
  rel?: string
  className?: string
}

export function Link({ href, children, target = '_blank', rel = 'noopener noreferrer', className }: LinkProps) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      className={`aurora-link${className ? ` ${className}` : ''}`}
    >
      {children}
    </a>
  )
}
