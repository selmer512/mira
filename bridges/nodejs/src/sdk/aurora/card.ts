import { type CardProps } from '@mira-ai/aurora'

import { WidgetComponent } from '../widget-component'

export class Card extends WidgetComponent<CardProps> {
  constructor(props: CardProps) {
    super(props)
  }
}
