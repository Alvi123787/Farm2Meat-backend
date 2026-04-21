import { BetaAnalyticsDataClient } from '@google-analytics/data'

/**
 * GA4 Data API Client Utility
 * Uses Service Account Credentials from Environment Variables
 */

const propertyId = process.env.GA4_PROPERTY_ID
const clientEmail = process.env.GA4_CLIENT_EMAIL
const privateKey = process.env.GA4_PRIVATE_KEY ? process.env.GA4_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined

let analyticsDataClient
let isMockMode = false

if (propertyId && clientEmail && privateKey) {
  try {
    analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      }
    })
    console.log('✅ GA4 Analytics: Live client initialized.')
  } catch (err) {
    console.error('❌ GA4 Analytics: Initialization failed. Switching to Mock Mode.', err.message)
    isMockMode = true
  }
} else {
  console.warn('GA4 Analytics: Missing credentials in environment variables. Running in Mock Mode.')
  isMockMode = true
}

export const getGA4Overview = async () => {
  if (isMockMode) {
    return {
      totalUsers: '12842',
      pageViews: '85420',
      sessions: '15632',
      activeUsers: '847',
      isMock: true
    }
  }

  const [response] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'activeUsers' }
    ]
  })

  const values = response.rows?.[0]?.metricValues || []
  return {
    totalUsers: values[0]?.value || '0',
    pageViews: values[1]?.value || '0',
    sessions: values[2]?.value || '0',
    activeUsers: values[3]?.value || '0',
    isMock: false
  }
}

export const getGA4UsersOverTime = async () => {
  if (isMockMode) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return days.map(d => ({
      date: d,
      users: Math.floor(Math.random() * (1500 - 800) + 800)
    }))
  }

  const [response] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }]
  })

  return response.rows?.map(row => ({
    date: formatDate(row.dimensionValues[0].value),
    users: parseInt(row.metricValues[0].value, 10)
  })) || []
}

export const getGA4PageViewsOverTime = async () => {
  if (isMockMode) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return days.map(d => ({
      date: d,
      views: Math.floor(Math.random() * (12000 - 5000) + 5000)
    }))
  }

  const [response] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'screenPageViews' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }]
  })

  return response.rows?.map(row => ({
    date: formatDate(row.dimensionValues[0].value),
    views: parseInt(row.metricValues[0].value, 10)
  })) || []
}

export const getGA4TopPages = async () => {
  if (isMockMode) {
    return [
      { url: '/home', views: 15420, users: 12340 },
      { url: '/shop', views: 12350, users: 9870 },
      { url: '/about', views: 4230, users: 3380 },
      { url: '/contact', views: 3450, users: 2760 },
      { url: '/checkout', views: 2890, users: 2310 }
    ]
  }

  const [response] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'activeUsers' }
    ],
    limit: 10
  })

  return response.rows?.map(row => ({
    url: row.dimensionValues[0].value,
    views: parseInt(row.metricValues[0].value, 10),
    users: parseInt(row.metricValues[1].value, 10)
  })) || []
}

// Helper to format GA4 date (YYYYMMDD) to readable (Mon, Tue, etc.)
const formatDate = (dateStr) => {
  const year = dateStr.substring(0, 4)
  const month = dateStr.substring(4, 6)
  const day = dateStr.substring(6, 8)
  const date = new Date(`${year}-${month}-${day}`)
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}
