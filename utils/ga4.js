import { BetaAnalyticsDataClient } from '@google-analytics/data'

/**
 * GA4 Data API Client Utility - Enhanced with Diagnostics
 * Uses Service Account Credentials from Environment Variables
 */

const propertyId = process.env.GA4_PROPERTY_ID
const clientEmail = process.env.GA4_CLIENT_EMAIL
let privateKey = process.env.GA4_PRIVATE_KEY

// Enhanced Private Key Cleaning and Validation
const diagnostics = {
  envVars: {
    GA4_PROPERTY_ID: !!propertyId,
    GA4_CLIENT_EMAIL: !!clientEmail,
    GA4_PRIVATE_KEY: !!privateKey,
    GA4_PRIVATE_KEY_HAS_BEGIN: false,
    GA4_PRIVATE_KEY_HAS_END: false,
    errors: []
  },
  clientInitialization: {
    success: false,
    error: null
  }
}

// Diagnostics: Check and clean private key
if (privateKey) {
  // 1. Remove surrounding quotes if they exist
  privateKey = privateKey.trim().replace(/^["'](.+)["']$/s, '$1')
  // 2. Replace literal \n string with actual newline characters
  privateKey = privateKey.replace(/\\n/g, '\n')
  // Validate key structure
  diagnostics.envVars.GA4_PRIVATE_KEY_HAS_BEGIN = privateKey.includes('-----BEGIN PRIVATE KEY-----')
  diagnostics.envVars.GA4_PRIVATE_KEY_HAS_END = privateKey.includes('-----END PRIVATE KEY-----')
} else {
  diagnostics.envVars.errors.push('GA4_PRIVATE_KEY is missing or empty')
}

// Diagnostics: Check all env vars
if (!propertyId) diagnostics.envVars.errors.push('GA4_PROPERTY_ID is missing')
if (!clientEmail) diagnostics.envVars.errors.push('GA4_CLIENT_EMAIL is missing')

let analyticsDataClient = null
let isMockMode = true

// Initialize client with diagnostics
try {
  if (propertyId && clientEmail && privateKey && 
      diagnostics.envVars.GA4_PRIVATE_KEY_HAS_BEGIN && 
      diagnostics.envVars.GA4_PRIVATE_KEY_HAS_END) {
    analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      }
    })
    isMockMode = false
    diagnostics.clientInitialization.success = true
    console.log('✅ GA4 Analytics: Client initialized successfully!')
  } else {
    console.warn('⚠️ GA4 Analytics: Invalid or missing credentials. Running in Mock Mode.')
    console.warn('   Diagnostics:', JSON.stringify(diagnostics, null, 2))
  }
} catch (err) {
  console.error('❌ GA4 Analytics: Initialization failed!', err.message)
  diagnostics.clientInitialization.error = err.message
  isMockMode = true
}

// ── MOCK DATA GENERATORS (Fallback when GA4 isn't configured) ──
const getMockOverview = () => ({
  totalUsers: '12842',
  pageViews: '85420',
  sessions: '15632',
  activeUsers: '847',
  isMock: true
})

const getMockUsersOverTime = () => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return days.map(d => ({
    date: d,
    users: Math.floor(Math.random() * (1500 - 800) + 800)
  }))
}

const getMockPageViewsOverTime = () => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return days.map(d => ({
    date: d,
    views: Math.floor(Math.random() * (12000 - 5000) + 5000)
  }))
}

const getMockTopPages = () => [
  { url: '/home', views: 15420, users: 12340 },
  { url: '/shop', views: 12350, users: 9870 },
  { url: '/about', views: 4230, users: 3380 },
  { url: '/contact', views: 3450, users: 2760 },
  { url: '/checkout', views: 2890, users: 2310 }
]

// ── EXPORTED FUNCTIONS ──

// Diagnostic function to test full pipeline
export const testGA4Connection = async () => {
  const testResult = {
    success: false,
    isMockMode,
    diagnostics,
    data: null,
    error: null
  }

  try {
    if (isMockMode) {
      testResult.data = getMockOverview()
      testResult.success = true
      return testResult
    }

    // Test basic GA4 connection by fetching simple overview
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
    testResult.data = {
      totalUsers: values[0]?.value || '0',
      pageViews: values[1]?.value || '0',
      sessions: values[2]?.value || '0',
      activeUsers: values[3]?.value || '0',
      isMock: false
    }
    testResult.success = true
    console.log('✅ GA4 Test Connection: Successfully fetched data!')
    return testResult
  } catch (err) {
    console.error('❌ GA4 Test Connection: Failed!', err.message)
    testResult.error = err.message
    // Fallback to mock on error
    testResult.data = getMockOverview()
    testResult.isMockMode = true
    return testResult
  }
}

export const getGA4Overview = async () => {
  if (isMockMode || !analyticsDataClient) return getMockOverview()

  try {
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
  } catch (err) {
    console.error('GA4 Overview Error:', err.message)
    return getMockOverview()
  }
}

export const getGA4UsersOverTime = async () => {
  if (isMockMode || !analyticsDataClient) return getMockUsersOverTime()

  try {
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
    })) || getMockUsersOverTime()
  } catch (err) {
    console.error('GA4 Users Over Time Error:', err.message)
    return getMockUsersOverTime()
  }
}

export const getGA4PageViewsOverTime = async () => {
  if (isMockMode || !analyticsDataClient) return getMockPageViewsOverTime()

  try {
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
    })) || getMockPageViewsOverTime()
  } catch (err) {
    console.error('GA4 Page Views Error:', err.message)
    return getMockPageViewsOverTime()
  }
}

export const getGA4TopPages = async () => {
  if (isMockMode || !analyticsDataClient) return getMockTopPages()

  try {
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
    })) || getMockTopPages()
  } catch (err) {
    console.error('GA4 Top Pages Error:', err.message)
    return getMockTopPages()
  }
}

// Helper to format GA4 date (YYYYMMDD) to readable (Mon, Tue, etc.)
const formatDate = (dateStr) => {
  const year = dateStr.substring(0, 4)
  const month = dateStr.substring(4, 6)
  const day = dateStr.substring(6, 8)
  const date = new Date(`${year}-${month}-${day}`)
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}
