import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

export function useUserContext() {
  const [contextPrompt, setContextPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [documentCount, setDocumentCount] = useState(0);

  useEffect(() => {
    loadUserContext();
  }, []);

  const loadUserContext = async () => {
    try {
      const result = await base44.functions.invoke('buildUserContextPrompt', {});
      setContextPrompt(result.data?.context_prompt || '');
      setDocumentCount(result.data?.context_count || 0);
    } catch (err) {
      console.warn('Failed to load user context:', err);
      setContextPrompt('');
      setDocumentCount(0);
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    setLoading(true);
    loadUserContext();
  };

  return {
    contextPrompt,
    loading,
    documentCount,
    refresh,
  };
}