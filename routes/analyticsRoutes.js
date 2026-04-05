import express from 'express'
import Inquiry from '../models/Inquiry.js'
import Animal from '../models/Animal.js'
import { adminMiddleware, authMiddleware } from '../middleware/authMiddleware.js'

const router = express.Router()

router.use(authMiddleware, adminMiddleware)

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_HOUR = 60 * 60 * 1000

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

const addDays = (d, days) => {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

const addHours = (d, hours) => {
  const next = new Date(d)
  next.setHours(next.getHours() + hours)
  return next
}

const addMonths = (d, months) => {
  const next = new Date(d)
  next.setMonth(next.getMonth() + months)
  return next
}

const toDateKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const toMonthKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

const toHourKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}`
}

const dayLabel = (d) =>
  d.toLocaleDateString('en-US', { weekday: 'short' }).replace('.', '')

const monthLabel = (d) =>
  d.toLocaleDateString('en-US', { month: 'short' }).replace('.', '')

const hourLabel = (d) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric' })

const aggregateByKey = async ({ start, end, keyFormat }) => {
  const rows = await Inquiry.aggregate([
    {
      $match: {
        date: { $gte: start, $lte: end },
        status: { $in: ['Completed', 'Delivered'] }
      }
    },
    {
      $group: {
        _id: { $dateToString: { format: keyFormat, date: '$date' } },
        revenue: { $sum: '$totalAmount' },
        quantity: { $sum: '$quantity' }
      }
    }
  ])

  const map = new Map()
  for (const row of rows) {
    map.set(row._id, { revenue: row.revenue || 0, quantity: row.quantity || 0 })
  }
  return map
}

const periodWindowDays = (period) => {
  if (period === 'today') return 1
  if (period === 'week') return 7
  if (period === 'month') return 30
  if (period === 'quarter') return 180
  return 365
}

const pctChange = (current, previous) => {
  if (previous <= 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

const trendObj = (current, previous) => {
  const pct = pctChange(current, previous)
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  return { pct, direction, current, previous }
}

router.get('/dashboard', async (req, res) => {
  try {
    const period = String(req.query.period || 'month')
    if (!['today', 'week', 'month', 'year'].includes(period)) {
      return res.status(400).json({ success: false, message: 'Invalid period' })
    }

    const now = new Date()
    const days = periodWindowDays(period)
    const currentStart = period === 'today' ? startOfDay(now) : startOfDay(addDays(now, -(days - 1)))
    const currentEnd = now
    const previousStart = addDays(currentStart, -days)
    const previousEnd = new Date(currentStart.getTime() - 1)

    const [
      totalAnimals,
      pendingInquiries,
      newAnimalsCurrent,
      newAnimalsPrevious,
      completedCurrent,
      completedPrevious,
      pendingCreatedCurrent,
      pendingCreatedPrevious
    ] = await Promise.all([
      Animal.countDocuments(),
      Inquiry.countDocuments({ status: 'Pending' }),
      Animal.countDocuments({ createdAt: { $gte: currentStart, $lte: currentEnd } }),
      Animal.countDocuments({ createdAt: { $gte: previousStart, $lte: previousEnd } }),
      Inquiry.aggregate([
        { $match: { status: { $in: ['Completed', 'Delivered'] }, date: { $gte: currentStart, $lte: currentEnd } } },
        { $group: { _id: null, revenue: { $sum: '$totalAmount' }, quantity: { $sum: '$quantity' } } }
      ]),
      Inquiry.aggregate([
        { $match: { status: { $in: ['Completed', 'Delivered'] }, date: { $gte: previousStart, $lte: previousEnd } } },
        { $group: { _id: null, revenue: { $sum: '$totalAmount' }, quantity: { $sum: '$quantity' } } }
      ]),
      Inquiry.countDocuments({ status: 'Pending', date: { $gte: currentStart, $lte: currentEnd } }),
      Inquiry.countDocuments({ status: 'Pending', date: { $gte: previousStart, $lte: previousEnd } })
    ])

    const curAgg = completedCurrent?.[0] || { revenue: 0, quantity: 0 }
    const prevAgg = completedPrevious?.[0] || { revenue: 0, quantity: 0 }

    return res.json({
      success: true,
      period,
      updatedAt: new Date().toISOString(),
      stats: {
        totalAnimals,
        animalsSold: curAgg.quantity || 0,
        totalRevenue: curAgg.revenue || 0,
        pendingInquiries
      },
      trends: {
        totalAnimals: trendObj(newAnimalsCurrent, newAnimalsPrevious),
        animalsSold: trendObj(curAgg.quantity || 0, prevAgg.quantity || 0),
        totalRevenue: trendObj(curAgg.revenue || 0, prevAgg.revenue || 0),
        pendingInquiries: trendObj(pendingCreatedCurrent, pendingCreatedPrevious)
      }
    })
  } catch (error) {
    console.error('Error building dashboard analytics:', error.message)
    return res.status(500).json({ success: false, message: error.message || 'Failed to load dashboard' })
  }
})

router.get('/revenue', async (req, res) => {
  try {
    const period = String(req.query.period || 'year')
    const now = new Date()

    if (!['today', 'week', 'month', 'quarter', 'year'].includes(period)) {
      return res.status(400).json({ success: false, message: 'Invalid period' })
    }

    if (period === 'today') {
      const currentStart = startOfDay(now)
      const currentEnd = now
      const previousStart = startOfDay(addDays(now, -1))
      const previousEnd = new Date(currentStart.getTime() - 1)

      const [cur, prev] = await Promise.all([
        aggregateByKey({ start: currentStart, end: currentEnd, keyFormat: '%Y-%m-%dT%H' }),
        aggregateByKey({ start: previousStart, end: previousEnd, keyFormat: '%Y-%m-%dT%H' })
      ])

      const points = []
      for (let i = 0; i < 24; i++) {
        const d = addHours(currentStart, i)
        const dPrev = addHours(previousStart, i)
        const curKey = toHourKey(d)
        const prevKey = toHourKey(dPrev)
        points.push({
          label: hourLabel(d),
          revenue: cur.get(curKey)?.revenue || 0,
          previous: prev.get(prevKey)?.revenue || 0
        })
      }

      return res.json({ success: true, period, points })
    }

    if (period === 'week') {
      const currentStart = startOfDay(addDays(now, -6))
      const currentEnd = new Date(currentStart.getTime() + 7 * MS_PER_DAY - 1)
      const previousStart = addDays(currentStart, -7)
      const previousEnd = new Date(previousStart.getTime() + 7 * MS_PER_DAY - 1)

      const [cur, prev] = await Promise.all([
        aggregateByKey({ start: currentStart, end: currentEnd, keyFormat: '%Y-%m-%d' }),
        aggregateByKey({ start: previousStart, end: previousEnd, keyFormat: '%Y-%m-%d' })
      ])

      const points = []
      for (let i = 0; i < 7; i++) {
        const d = addDays(currentStart, i)
        const dPrev = addDays(previousStart, i)
        const curKey = toDateKey(d)
        const prevKey = toDateKey(dPrev)
        points.push({
          label: dayLabel(d),
          revenue: cur.get(curKey)?.revenue || 0,
          previous: prev.get(prevKey)?.revenue || 0
        })
      }

      return res.json({ success: true, period, points })
    }

    if (period === 'month') {
      const weeks = 4
      const days = weeks * 7
      const currentStart = startOfDay(addDays(now, -(days - 1)))
      const currentEnd = new Date(currentStart.getTime() + days * MS_PER_DAY - 1)
      const previousStart = addDays(currentStart, -days)
      const previousEnd = new Date(previousStart.getTime() + days * MS_PER_DAY - 1)

      const [curDaily, prevDaily] = await Promise.all([
        aggregateByKey({ start: currentStart, end: currentEnd, keyFormat: '%Y-%m-%d' }),
        aggregateByKey({ start: previousStart, end: previousEnd, keyFormat: '%Y-%m-%d' })
      ])

      const points = []
      for (let w = 0; w < weeks; w++) {
        let revenue = 0
        let previous = 0
        for (let d = 0; d < 7; d++) {
          const curDate = addDays(currentStart, w * 7 + d)
          const prevDate = addDays(previousStart, w * 7 + d)
          revenue += curDaily.get(toDateKey(curDate))?.revenue || 0
          previous += prevDaily.get(toDateKey(prevDate))?.revenue || 0
        }
        points.push({ label: `Week ${w + 1}`, revenue, previous })
      }

      return res.json({ success: true, period, points })
    }

    const monthsCount = period === 'quarter' ? 6 : 12
    const currentStart = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1)
    const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

    const previousStart = addMonths(currentStart, -monthsCount)
    const previousEnd = new Date(currentStart.getTime() - 1)

    const [curMonthly, prevMonthly] = await Promise.all([
      aggregateByKey({ start: currentStart, end: currentEnd, keyFormat: '%Y-%m' }),
      aggregateByKey({ start: previousStart, end: previousEnd, keyFormat: '%Y-%m' })
    ])

    const points = []
    for (let i = 0; i < monthsCount; i++) {
      const m = addMonths(currentStart, i)
      const mPrev = addMonths(previousStart, i)
      const key = toMonthKey(m)
      const prevKey = toMonthKey(mPrev)
      points.push({
        label: monthLabel(m),
        revenue: curMonthly.get(key)?.revenue || 0,
        previous: prevMonthly.get(prevKey)?.revenue || 0
      })
    }

    return res.json({ success: true, period, points })
  } catch (error) {
    console.error('Error building revenue analytics:', error.message)
    return res.status(500).json({ success: false, message: error.message || 'Failed to load analytics' })
  }
})

router.get('/sales', async (req, res) => {
  try {
    const period = req.query.period ? String(req.query.period) : ''
    const now = new Date()

    if (period) {
      if (!['today', 'week', 'month', 'year'].includes(period)) {
        return res.status(400).json({ success: false, message: 'Invalid period' })
      }

      if (period === 'today') {
        const currentStart = startOfDay(now)
        const currentEnd = now
        const daily = await aggregateByKey({ start: currentStart, end: currentEnd, keyFormat: '%Y-%m-%dT%H' })
        const points = []
        for (let i = 0; i < 24; i++) {
          const d = addHours(currentStart, i)
          points.push({ label: hourLabel(d), goats: daily.get(toHourKey(d))?.quantity || 0 })
        }
        return res.json({ success: true, period, points })
      }

      if (period === 'week') {
        const start = startOfDay(addDays(now, -6))
        const end = new Date(start.getTime() + 7 * MS_PER_DAY - 1)
        const daily = await aggregateByKey({ start, end, keyFormat: '%Y-%m-%d' })
        const points = []
        for (let i = 0; i < 7; i++) {
          const d = addDays(start, i)
          points.push({ label: dayLabel(d), goats: daily.get(toDateKey(d))?.quantity || 0 })
        }
        return res.json({ success: true, period, points })
      }

      if (period === 'month') {
        const weeks = 4
        const days = weeks * 7
        const start = startOfDay(addDays(now, -(days - 1)))
        const end = new Date(start.getTime() + days * MS_PER_DAY - 1)
        const daily = await aggregateByKey({ start, end, keyFormat: '%Y-%m-%d' })
        const points = []
        for (let w = 0; w < weeks; w++) {
          let goats = 0
          for (let d = 0; d < 7; d++) {
            const curDate = addDays(start, w * 7 + d)
            goats += daily.get(toDateKey(curDate))?.quantity || 0
          }
          points.push({ label: `Week ${w + 1}`, goats })
        }
        return res.json({ success: true, period, points })
      }

      const monthsCount = 12
      const currentStart = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1)
      const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      const monthly = await aggregateByKey({ start: currentStart, end: currentEnd, keyFormat: '%Y-%m' })

      const points = []
      for (let i = 0; i < monthsCount; i++) {
        const m = addMonths(currentStart, i)
        points.push({ label: monthLabel(m), goats: monthly.get(toMonthKey(m))?.quantity || 0 })
      }
      return res.json({ success: true, period, points })
    }

    const weeks = Math.max(1, Math.min(52, parseInt(req.query.weeks || '6', 10) || 6))
    const days = weeks * 7

    const start = startOfDay(addDays(now, -(days - 1)))
    const end = new Date(start.getTime() + days * MS_PER_DAY - 1)

    const daily = await aggregateByKey({ start, end, keyFormat: '%Y-%m-%d' })

    const points = []
    for (let w = 0; w < weeks; w++) {
      let goats = 0
      for (let d = 0; d < 7; d++) {
        const curDate = addDays(start, w * 7 + d)
        goats += daily.get(toDateKey(curDate))?.quantity || 0
      }
      points.push({ week: `Week ${w + 1}`, goats })
    }

    return res.json({ success: true, weeks, points })
  } catch (error) {
    console.error('Error building sales analytics:', error.message)
    return res.status(500).json({ success: false, message: error.message || 'Failed to load analytics' })
  }
})

export default router
