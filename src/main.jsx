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
import AdminTrainingPage from './pages/AdminTrainingPage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import OnlineLobbyPage from './pages/OnlineLobbyPage.jsx'
import TsumeGeneratorPage from './pages/TsumeGeneratorPage.jsx'
import WeaknessQuizPage from './pages/WeaknessQuizPage.jsx'

function isPWAOrAPK() {
  // PWA standalone / fullscreen、またはAndroid APK (TWA) の判定
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

function RootPage() {
  if (isPWAOrAPK()) return <Navigate to="/app" replace />;
  return <HomePage />;
}

function RequireNoActiveGame({ children }) {
  if (sessionStorage.getItem('shogi_online_game') === 'true') {
    return <Navigate to="/online" replace />;
  }
  return children;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<RequireNoActiveGame><App /></RequireNoActiveGame>} />
        <Route path="/share/:token" element={<RequireNoActiveGame><SharePage /></RequireNoActiveGame>} />
        <Route path="/tsume/category/:moves" element={<RequireNoActiveGame><TsumeListPage /></RequireNoActiveGame>} />
        <Route path="/tsume/:token" element={<RequireNoActiveGame><TsumePage /></RequireNoActiveGame>} />
        <Route path="/profile/:userId" element={<RequireNoActiveGame><ProfilePage /></RequireNoActiveGame>} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/admin/training" element={<AdminTrainingPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/online" element={<OnlineLobbyPage />} />
        <Route path="/tsume-generator" element={<RequireNoActiveGame><TsumeGeneratorPage /></RequireNoActiveGame>} />
        <Route path="/weakness-quiz" element={<RequireNoActiveGame><WeaknessQuizPage /></RequireNoActiveGame>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
)
