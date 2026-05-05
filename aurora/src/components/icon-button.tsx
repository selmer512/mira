import React from 'react'

export interface IconButtonProps {
  iconName: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  className?: string
}

const SIZE_MAP: Record<string, string> = {
  sm: '14px',
  md: '18px',
  lg: '22px'
}

export function IconButton({ iconName, onClick, size = 'md', type = 'button', disabled = false, className }: IconButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`aurora-icon-button aurora-icon-button--${size}${className ? ` ${className}` : ''}`}
    >
      <i className={`ri-${iconName}-line`} style={{ fontSize: SIZE_MAP[size] }} />
    </button>
  )
}
