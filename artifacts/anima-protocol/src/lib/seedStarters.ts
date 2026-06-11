import { supabase } from './supabaseClient'
import { starterCharacters } from '../data/starterCharacters'

export async function seed() {
  console.log('Checking for existing starters...')

  const { count, error: countError } = await supabase
    .from('characters')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    console.error('Count check failed:', countError)
    process.exit(1)
  }

  if ((count || 0) > 0) {
    console.log(`Table already has ${count} characters. Skipping seed.`)
    return
  }

  console.log('Uploading starter characters...')

  const { data, error } = await supabase
    .from('characters')
    .insert(starterCharacters)
    .select()

  if (error) {
    console.error('Upload failed:', error)
    process.exit(1)
  }

  console.log(`✅ Successfully uploaded ${data.length} starter characters!`)
}

seed().catch(console.error)