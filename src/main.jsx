import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import './i18n/i18n.js'
import './index.css'
import App from './App.jsx'
import LoginPage from './pages/LoginPage.jsx'
import HomePage from './pages/HomePage.jsx'
import SharePage from './pages/SharePage.jsx'
import TsumePage from './pages/TsumePage.jsx'
import TsumeListPage from './pages/TsumeListPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import TermsPage from './pages/TermsPage.jsx'
import PrivacyPage from './pages/PrivacyPage.jsx'

function isPWAOrAPK() {
  // PWA standalone / fullscreen、またはAndroid APK (TWA) の判定
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

function RootPage() {
  const token = localStorage.getItem('shogi_jwt');
  if (token && isPWAOrAPK()) return <Navigate to="/app" replace />;
  return <HomePage />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<App />} />
        <Route path="/share/:token" element={<SharePage />} />
        <Route path="/tsume/category/:moves" element={<TsumeListPage />} />
        <Route path="/tsume/:token" element={<TsumePage />} />
        <Route path="/profile/:userId" element={<ProfilePage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
)
