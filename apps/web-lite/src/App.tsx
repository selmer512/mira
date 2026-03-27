/** @jsxImportSource preact */
import { Header } from './components/Header.js'
import { Chat } from './components/Chat.js'
import { QuickActions } from './components/QuickActions.js'
import './App.css'

export function App() {
  return (
    <div class="app-shell">
      <Header />
      <Chat />
      <QuickActions />
    </div>
  )
}
