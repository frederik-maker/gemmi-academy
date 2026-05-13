import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useStore } from '../store.js'
import Onboarding from './Onboarding.jsx'
import Home from './Home.jsx'
import SubjectMap from './SubjectMap.jsx'
import LessonPlayer from './LessonPlayer.jsx'
import LessonComplete from './LessonComplete.jsx'
import Profile from './Profile.jsx'
import Stats from './Stats.jsx'
import Teacher from './Teacher.jsx'
import ModelSetup from './ModelSetup.jsx'
import VoiceSetup from './VoiceSetup.jsx'
import Topbar from '../components/Topbar.jsx'
import BottomNav from '../components/BottomNav.jsx'
import TutorButton from '../components/TutorButton.jsx'
import OfflineBanner from '../components/OfflineBanner.jsx'
import LangSwitcher from '../components/LangSwitcher.jsx'
import { t } from '../i18n.js'
import { motion, AnimatePresence } from 'framer-motion'

export default function Learn() {
  const onboarded = useStore((s) => s.onboarded)
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const location = useLocation()
  const [langOpen, setLangOpen] = useState(false)
  const isLessonPlayer = /\/learn\/lesson\//.test(location.pathname)
  const isComplete = /\/learn\/complete\//.test(location.pathname)

  if (!onboarded) {
    return <Onboarding />
  }

  return (
    <div className="min-h-screen bg-ink-100/40 text-ink-900">
      {!isLessonPlayer && !isComplete && (
        <Topbar onLangClick={() => setLangOpen(true)} currentLang={lang} />
      )}
      {!isLessonPlayer && !isComplete && <OfflineBanner />}
      {/* LessonPlayer + LessonComplete manage their own width and own
          background — wrap-in-a-card looks wrong on the celebration screen
          (left/right white bars showing the page bg through the gradient).
          For those routes drop the max-w-md cap entirely. */}
      <main className={isLessonPlayer || isComplete
        ? ''
        : 'max-w-md mx-auto px-4 pb-24 pt-4'}>
        <Routes>
          <Route index element={<Home />} />
          <Route path="subject/:subjectId" element={<SubjectMap />} />
          <Route path="lesson/:lessonId" element={<LessonPlayer />} />
          <Route path="complete/:lessonId" element={<LessonComplete />} />
          <Route path="stats" element={<Stats />} />
          <Route path="profile" element={<Profile />} />
          <Route path="teacher" element={<Teacher />} />
          <Route path="model-setup" element={<ModelSetup />} />
          <Route path="voice-setup" element={<VoiceSetup />} />
          <Route path="*" element={<Navigate to="/learn" replace />} />
        </Routes>
      </main>
      {!isLessonPlayer && !isComplete && <BottomNav />}
      {!isLessonPlayer && !isComplete && <TutorButton context={{ path: location.pathname }} />}

      <AnimatePresence>
        {langOpen && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLangOpen(false)}
          >
            <motion.div
              className="w-full max-w-md bg-white rounded-3xl p-6"
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-extrabold text-ink-900 mb-2">{t('changeLang', lang)}</h3>
              <LangSwitcher value={lang} onChange={(v) => { setLang(v); setLangOpen(false) }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
