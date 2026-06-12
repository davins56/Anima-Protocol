import express from 'express'
import { Webhook } from 'svix'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { characters } from '../db/schema'
const router = express.Router()

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET!

router.post('/clerk', express.raw({ type: 'application/json' }), async (req, res) => {
  const svixId = req.headers['svix-id'] as string
  const svixTimestamp = req.headers['svix-timestamp'] as string
  const svixSignature = req.headers['svix-signature'] as string

  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(400).json({ error: 'Missing Svix headers' })
  }

  const wh = new Webhook(CLERK_WEBHOOK_SECRET)

  let evt: any

  try {
    evt = wh.verify(req.body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    })
  } catch (err) {
    console.error('Webhook verification failed:', err)
    return res.status(400).json({ error: 'Invalid signature' })
  }

  const { type, data } = evt

  if (type === 'user.created') {
    const userId = data.id

    try {
      // Check if user already has characters (prevent duplicates)
      const existing = await db
        .select()
        .from(characters)
        .where(eq(characters.userId, userId))
        .limit(1)

      if (existing.length === 0) {
        await seedDefaultCharacters(userId)
        console.log(`✅ Characters seeded for new user: ${userId}`)
      }

      res.status(200).json({ success: true })
    } catch (error) {
      console.error('Seeding failed:', error)
      res.status(500).json({ error: 'Seeding failed' })
    }
  } else {
    res.status(200).json({ received: true })
  }
})

async function seedDefaultCharacters(userId: string) {
  const now = new Date()

  await db.insert(characters).values([
    {
      id: crypto.randomUUID(),
      userId: userId,
      name: 'Serenity',
      type: 'angelic_warrior',
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      userId: userId,
      name: 'Linda',
      type: 'sovereign_submissive',
      createdAt: now,
    },
  ])
}

export default router