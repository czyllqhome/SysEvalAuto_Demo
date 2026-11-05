import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { LocaleProvider } from './i18n'
import App from './App'
import './interface.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={client}><LocaleProvider><BrowserRouter><App /></BrowserRouter></LocaleProvider></QueryClientProvider></React.StrictMode>,
)
