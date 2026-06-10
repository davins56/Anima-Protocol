import { supabase } from './supabaseClient'; // your existing client (or create admin client for seeding)
import { starterCharacters } from '../data/starterCharacters';

export async function seedStarterCharacters() {
  // Check if any starters already exist
  const { count, error: countError } = await supabase
    .from('characters')
    .select('*', { count: 'exact', head: true })
    .eq('is_starter', true);

  if (countError) {
    console.error('Seed check failed:', countError);
    return { success: false, error: countError.message };
  }

  if ((count || 0) > 0) {
    console.log('Starter characters already seeded. Lattice stable.');
    return { success: true, skipped: true, count };
  }

  // Bulk insert (use service_role key in production Edge Function for reliability)
  const { data, error } = await supabase
    .from('characters')
    .insert(starterCharacters)
    .select();

  if (error) {
    console.error('Seed insert failed:', error);
    return { success: false, error: error.message };
  }

  console.log(`Successfully seeded ${data?.length} starter characters.`);
  return { success: true, seeded: data?.length, data };
}