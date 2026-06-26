import { BetaAnalyticsDataClient } from '@google-analytics/data'

/**
 * GA4 Data API Client Utility - Enhanced with comprehensive metrics
 * Uses Service Account Credentials from Environment Variables
 */

let propertyId, clientEmail, privateKey
let diagnostics, analyticsDataClient, isMockMode
let initialized = false

function initializeGA4() {
  if (initialized) return

  propertyId = process.env.GA4_PROPERTY_ID
  clientEmail = process.env.GA4_CLIENT_EMAIL
  privateKey = process.env.GA4_PRIVATE_KEY

  // Enhanced Private Key Cleaning and Validation
  diagnostics = {
    envVars: {
      GA4_PROPERTY_ID: false,
      GA4_CLIENT_EMAIL: false,
      GA4_PRIVATE_KEY: false,
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
    diagnostics.envVars.GA4_PRIVATE_KEY = true
  } else {
    diagnostics.envVars.errors.push('GA4_PRIVATE_KEY is missing or empty')
  }

  // Diagnostics: Check all env vars
  diagnostics.envVars.GA4_PROPERTY_ID = !!propertyId
  diagnostics.envVars.GA4_CLIENT_EMAIL = !!clientEmail
  if (!propertyId) diagnostics.envVars.errors.push('GA4_PROPERTY_ID is missing')
  if (!clientEmail) diagnostics.envVars.errors.push('GA4_CLIENT_EMAIL is missing')

  analyticsDataClient = null
  isMockMode = true

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

  initialized = true
}

// ── MOCK DATA GENERATORS (Fallback when GA4 isn't configured)
const getMockOverview = () => ({
  totalUsers: '0',
  pageViews: '0',
  sessions: '0',
  activeUsers: '0',
  isMock: true
})

const getMockUsersOverTime = () => []

const getMockPageViewsOverTime = () => []

const getMockTopPages = () => []

const getMockTrafficSources = () => []

const getMockDeviceTypes = () => []

const getMockGeographicData = () => []

// ── EXPORTED FUNCTIONS

// Diagnostic function to test full pipeline
export const testGA4Connection = async () => {
  initializeGA4()
  
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
  initializeGA4()
  
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
  initializeGA4()
  
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
  initializeGA4()
  
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
  initializeGA4()
  
  if (isMockMode || !analyticsDataClient) return getMockTopPages()

  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'activeUsers' },
        { name: 'userEngagementDuration' },
        { name: 'conversions' },
        { name: 'engagementRate' }
      ],
      limit: 10
    })

    return response.rows?.map(row => {
      const views = parseInt(row.metricValues[0].value, 10)
      const users = parseInt(row.metricValues[1].value, 10)
      const avgTimeOnPage = parseInt(row.metricValues[2].value, 10) / Math.max(users, 1)
      const conversions = parseInt(row.metricValues[3].value, 10)
      const conversionRate = (conversions / Math.max(users, 1)) * 100
      const engagementRate = parseFloat(row.metricValues[4].value) * 100

      return {
        url: row.dimensionValues[0].value,
        views: views,
        users: users,
        avgTimeOnPage: Math.round(avgTimeOnPage),
        conversionRate: parseFloat(conversionRate.toFixed(2)),
        engagementRate: parseFloat(engagementRate.toFixed(1))
      }
    }) || getMockTopPages()
  } catch (err) {
    console.error('GA4 Top Pages Error:', err.message)
    return getMockTopPages()
  }
}

export const getGA4TrafficSources = async () => {
  initializeGA4()
  
  if (isMockMode || !analyticsDataClient) return getMockTrafficSources()

  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 10
    })

    const rows = response.rows || []
    const totalUsers = rows.reduce((sum, row) => sum + parseInt(row.metricValues[0].value, 10), 0)

    return rows.map(row => {
      const users = parseInt(row.metricValues[0].value, 10)
      return {
        source: mapSourceName(row.dimensionValues[0].value),
        users: users,
        percentage: parseFloat(((users / Math.max(totalUsers, 1)) * 100).toFixed(1))
      }
    }).sort((a, b) => b.users - a.users) || getMockTrafficSources()
  } catch (err) {
    console.error('GA4 Traffic Sources Error:', err.message)
    return getMockTrafficSources()
  }
}

export const getGA4DeviceTypes = async () => {
  initializeGA4()
  
  if (isMockMode || !analyticsDataClient) return getMockDeviceTypes()

  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'activeUsers' }]
    })

    const rows = response.rows || []
    const totalUsers = rows.reduce((sum, row) => sum + parseInt(row.metricValues[0].value, 10), 0)

    return rows.map(row => {
      const users = parseInt(row.metricValues[0].value, 10)
      return {
        device: capitalizeFirst(row.dimensionValues[0].value),
        users: users,
        percentage: parseFloat(((users / Math.max(totalUsers, 1)) * 100).toFixed(1))
      }
    }).sort((a, b) => b.users - a.users) || getMockDeviceTypes()
  } catch (err) {
    console.error('GA4 Device Types Error:', err.message)
    return getMockDeviceTypes()
  }
}

export const getGA4GeographicData = async () => {
  initializeGA4()
  
  if (isMockMode || !analyticsDataClient) return getMockGeographicData()

  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'city' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 10
    })

    const rows = response.rows || []
    const totalUsers = rows.reduce((sum, row) => sum + parseInt(row.metricValues[0].value, 10), 0)

    return rows.map(row => {
      const users = parseInt(row.metricValues[0].value, 10)
      return {
        city: row.dimensionValues[0].value || '(not set)',
        users: users,
        percentage: parseFloat(((users / Math.max(totalUsers, 1)) * 100).toFixed(1))
      }
    }).sort((a, b) => b.users - a.users)
      .filter(item => item.city !== '(not set)') || getMockGeographicData()
  } catch (err) {
    console.error('GA4 Geographic Data Error:', err.message)
    return getMockGeographicData()
  }
}

// Helper functions
const formatDate = (dateStr) => {
  const year = dateStr.substring(0, 4)
  const month = dateStr.substring(4, 6)
  const day = dateStr.substring(6, 8)
  const date = new Date(`${year}-${month}-${day}`)
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

const mapSourceName = (source) => {
  if (!source) return 'Direct'
  const lower = source.toLowerCase()
  if (lower.includes('google') || lower.includes('bing') || lower.includes('yahoo')) return 'Organic Search'
  if (lower.includes('facebook') || lower.includes('instagram') || lower.includes('twitter') || lower.includes('social')) return 'Social Media'
  if (lower.includes('referral')) return 'Referral'
  if (lower.includes('cpc') || lower.includes('paid') || lower.includes('ad')) return 'Paid Campaigns'
  return source
}

const capitalizeFirst = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
