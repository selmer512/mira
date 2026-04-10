import React from 'react'

export interface InputProps {
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  name?: string
  type?: string
  disabled?: boolean
  className?: string
}

export function Input({ value, onChange, placeholder, name, type = 'text', disabled = false, className }: InputProps) {
  return (
    <input
      className={`aurora-input${className ? ` ${className}` : ''}`}
      type={type}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}
