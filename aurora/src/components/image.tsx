import React from 'react'

export interface ImageProps {
  path: string
  width?: string | number
  height?: string | number
  alt?: string
  className?: string
}

export function Image({ path, width, height, alt = '', className }: ImageProps) {
  return (
    <img
      src={path}
      width={width}
      height={height}
      alt={alt}
      className={`aurora-image${className ? ` ${className}` : ''}`}
    />
  )
}
