import { useNavigate, useParams } from 'react-router-dom';
import { useSwipeGestures } from './useSwipeGestures';

export function useSwipeSessionNav(sessions) {
  const navigate = useNavigate();
  const { sessionId } = useParams();

  useSwipeGestures({
    onSwipeLeft: () => {
      const currentIdx = sessions.findIndex(s => s.id === sessionId);
      if (currentIdx < sessions.length - 1) {
        navigate(`/chat/${sessions[currentIdx + 1].id}`);
      }
    },
    onSwipeRight: () => {
      const currentIdx = sessions.findIndex(s => s.id === sessionId);
      if (currentIdx > 0) {
        navigate(`/chat/${sessions[currentIdx - 1].id}`);
      }
    },
    excludeSelector: 'input, textarea, [data-no-swipe]',
  });
}