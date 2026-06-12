import express, { Request, Response, NextFunction } from 'express'
import { clerkMiddleware } from '@clerk/express'

// Import webhook router
import clerkWebhookRouter from './webhooks/clerk'

const app = express()

// Body parsing middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Clerk middleware - must be early
app.use(clerkMiddleware())

// Webhook route (raw body handled inside the router)
app.use('/api/webhooks', clerkWebhookRouter)

// ====================== PUBLIC ROUTES ======================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ====================== PROTECTED ROUTES ======================
// Add your real app routes here

// Protected route example
// app.get('/api/protected', requireAuth(), (req, res) => { ... })

// Global error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled API error")
  if (!res.headersSent) {
    const message = err instanceof Error ? err.message : "Internal server error"
    const isConfig = message.includes("DATABASE_URL") || message.includes("connection")
    res.status(isConfig ? 503 : 500).json({
      error: isConfig
        ? "API is misconfigured on the server. Check environment variables."
        : "Internal server error",
    })
  }
})

export default app