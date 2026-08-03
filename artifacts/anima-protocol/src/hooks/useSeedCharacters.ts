import { useEffect } from 'react'
import { useUser, useAuth } from '@clerk/react'

export function useSeedCharacters() {
  const { isLoaded, isSignedIn, user } = useUser()
  const { getToken } = useAuth()

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return

    const seed = async () => {
      try {
        const token = await getToken()

        const res = await fetch('/api/seed-characters', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId: user.id }),
        })

        if (res.ok) {
          console.log('✅ Characters seeded successfully')
        }
      } catch (err) {
        console.error('Seeding failed:', err)
      }
    }

    // Run only once per user (using localStorage flag)
    const seededKey = `seeded_${user.id}`
    if (!localStorage.getItem(seededKey)) {
      seed()
      localStorage.setItem(seededKey, 'true')
    }
  }, [isLoaded, isSignedIn, user?.id])
}