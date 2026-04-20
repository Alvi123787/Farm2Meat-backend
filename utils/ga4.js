import { BetaAnalyticsDataClient } from '@google-analytics/data'

/**
 * GA4 Data API Client Utility
 * Uses Service Account Credentials from Environment Variables
 */

const propertyId = process.env.GA4_PROPERTY_ID
const clientEmail = process.env.GA4_CLIENT_EMAIL
const privateKey = process.env.GA4_PRIVATE_KEY ? process.env.GA4_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined

let analyticsDataClient

if (propertyId && clientEmail && privateKey) {
  analyticsDataClient = new BetaAnalyticsDataClient({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey
    }
  })
} else {
  console.warn('GA4 Analytics: Missing credentials in environment variables. Analytics will be disabled.')
}

export const getGA4Overview = async () => {
  if (!analyticsDataClient) return null

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
    activeUsers: values[3]?.value || '0'
  }
}

export const getGA4UsersOverTime = async () => {
  if (!analyticsDataClient) return []

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
  if (!analyticsDataClient) return []

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
  if (!analyticsDataClient) return []

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
