import React from 'react'

export interface FormProps {
  children?: React.ReactNode
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void
  className?: string
}

export function Form({ children, onSubmit, className }: FormProps) {
  return (
    <form
      className={`aurora-form${className ? ` ${className}` : ''}`}
      onSubmit={onSubmit}
    >
      {children}
    </form>
  )
}
