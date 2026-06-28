// @ts-ignore: Express types may not be available in this environment
import express from 'express'
import { db } from '../db'
import { characters } from '../db/schema'
import { eq } from 'drizzle-orm'

interface AuthPayload {
  userId?: string
}

interface AuthRequest extends express.Request {
  auth?: AuthPayload
}

interface SeedCharacter {
  id: string
  userId: string
  name: string
  type: 'angelic_warrior' | 'sovereign_submissive'
  createdAt: Date
}

const requireAuth = () => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = (req as any).auth
    const userId = auth?.userId
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    next()
  }
}

const router = express.Router()

router.post('/seed-characters', requireAuth(), async (req: AuthRequest, res: express.Response) => {
  const userId = req.auth!.userId

  try {
    const existing = await db
      .select()
      .from(characters)
      .where(eq(characters.userId, userId))
      .limit(1)

    if (existing.length === 0) {
      await db.insert(characters).values([
        {
          id: crypto.randomUUID(),
          userId,
          name: 'Serenity',
          type: 'angelic_warrior',
          createdAt: new Date(),
        },
        {
          id: crypto.randomUUID(),
          userId,
          name: 'Linda',
          type: 'sovereign_submissive',
          createdAt: new Date(),
        },
      ])
      console.log(`✅ Seeded characters for user: ${userId}`)
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Seeding error:', error)
    res.status(500).json({ error: 'Seeding failed' })
  }
})

export default router