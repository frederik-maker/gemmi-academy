import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const todayKey = () => new Date().toISOString().slice(0, 10)

const initialHearts = 5
const heartRefillMs = 15 * 60 * 1000 // 15 minutes per heart

export const useStore = create(
  persist(
    (set, get) => ({
      lang: null, // 'kk' | 'ru' | 'en'
      grade: null, // 1 = Beginner (K-2), 2 = Intermediate (3-4), 3 = Advanced (5-9)
      onboarded: false,
      profile: { name: '', avatar: '🐆' },
      xp: 0,
      gems: 50,
      streak: 0,
      lastActiveDay: null,
      hearts: initialHearts,
      lastHeartLostAt: null,
      completedLessons: {}, // { [lessonId]: { stars: 1|2|3, completedAt } }
      lessonAttempts: {}, // { [lessonId]: number }
      dailyGoal: 30, // XP per day
      dailyXp: {}, // { 'YYYY-MM-DD': xp }
      achievements: {}, // { [id]: unlockedAt }
      // Recent confusion log. Each entry: { subject, lessonId, lessonTitle,
      // question, options, wrongAnswer, correctAnswer, ts }. The tutor reads
      // this via get_student_state so it can reference what the student has
      // been struggling with ("you've missed two quadratic questions today").
      recentStruggles: [],

      setLang: (lang) => set({ lang }),
      setGrade: (grade) => set({ grade }),
      finishOnboarding: ({ name, avatar, lang, dailyGoal, grade }) => set((s) => ({
        onboarded: true,
        profile: { name: name || s.profile.name, avatar: avatar || s.profile.avatar },
        lang: lang || s.lang,
        grade: grade || s.grade || 2,
        dailyGoal: dailyGoal || s.dailyGoal,
      })),
      bumpStreak: () => set((s) => {
        const today = todayKey()
        if (s.lastActiveDay === today) return s
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        const newStreak = s.lastActiveDay === yesterday ? s.streak + 1 : 1
        return { streak: newStreak, lastActiveDay: today }
      }),
      addXp: (amount) => set((s) => {
        const k = todayKey()
        return {
          xp: s.xp + amount,
          dailyXp: { ...s.dailyXp, [k]: (s.dailyXp[k] || 0) + amount },
        }
      }),
      addGems: (n) => set((s) => ({ gems: s.gems + n })),
      loseHeart: () => set((s) => {
        const next = Math.max(0, s.hearts - 1)
        return { hearts: next, lastHeartLostAt: Date.now() }
      }),
      refillHearts: () => set({ hearts: initialHearts, lastHeartLostAt: null }),
      tickHearts: () => set((s) => {
        if (s.hearts >= initialHearts || !s.lastHeartLostAt) return s
        const elapsed = Date.now() - s.lastHeartLostAt
        const earned = Math.floor(elapsed / heartRefillMs)
        if (earned <= 0) return s
        const newHearts = Math.min(initialHearts, s.hearts + earned)
        const carry = elapsed - earned * heartRefillMs
        return {
          hearts: newHearts,
          lastHeartLostAt: newHearts >= initialHearts ? null : Date.now() - carry,
        }
      }),
      completeLesson: (lessonId, { stars, xp }) => set((s) => ({
        completedLessons: {
          ...s.completedLessons,
          [lessonId]: { stars: Math.max(stars, s.completedLessons[lessonId]?.stars || 0), completedAt: Date.now() },
        },
        lessonAttempts: {
          ...s.lessonAttempts,
          [lessonId]: (s.lessonAttempts[lessonId] || 0) + 1,
        },
      })),
      unlockAchievement: (id) => set((s) => ({
        achievements: s.achievements[id] ? s.achievements : { ...s.achievements, [id]: Date.now() },
      })),
      recordStruggle: (entry) => set((s) => ({
        recentStruggles: [{ ...entry, ts: Date.now() }, ...s.recentStruggles].slice(0, 20),
      })),
      clearStruggles: () => set({ recentStruggles: [] }),
      resetAll: () => set({
        lang: null, grade: null, onboarded: false, profile: { name: '', avatar: '🐆' },
        xp: 0, gems: 50, streak: 0, lastActiveDay: null,
        hearts: initialHearts, lastHeartLostAt: null,
        completedLessons: {}, lessonAttempts: {},
        dailyGoal: 30, dailyXp: {}, achievements: {},
        recentStruggles: [],
      }),
    }),
    { name: 'gemmi-academy-v3' }
  )
)
