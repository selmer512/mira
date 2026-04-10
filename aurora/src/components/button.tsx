import React from 'react'

export interface ButtonProps {
  children?: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit' | 'reset'
  name?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  className?: string
}

export function Button({
  children,
  onClick,
  type = 'button',
  name,
  size = 'md',
  variant = 'primary',
  disabled = false,
  className
}: ButtonProps) {
  return (
    <button
      type={type}
      name={name}
      onClick={onClick}
      disabled={disabled}
      className={`aurora-button aurora-button--${size} aurora-button--${variant}${className ? ` ${className}` : ''}`}
    >
      {children}
    </button>
  )
}
