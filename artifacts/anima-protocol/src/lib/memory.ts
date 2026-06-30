import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export async function saveMemorySummary(userId: string, summary: string, affectionLevel: number) {
  await supabase.from('memory_summaries').insert({
    user_id: userId,
    summary,
    affection_level: affectionLevel,
    created_at: new Date().toISOString()
  });
}

export async function searchRelevantMemories(userId: string, query: string, limit = 10) {
  // pgvector semantic search (add extension if not already)
  const { data } = await supabase.rpc('match_memories', {
    query_text: query,
    match_count: limit,
    user_id: userId
  });
  return data || [];
}

export async function getUserMemoryContext(userId: string) {
  const { data } = await supabase
    .from('memory_summaries')
    .select('summary')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);
  return data?.map(m => m.summary).join('\n') || '';
}