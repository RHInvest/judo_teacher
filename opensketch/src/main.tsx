/** OWNERSHIP: Lead. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/ui/App'
import './app.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root fehlt in index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
