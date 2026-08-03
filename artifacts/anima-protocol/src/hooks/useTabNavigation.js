import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export const useTabNavigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const stackRef = useRef({
    '/': ['/', '/chat'],
    '/characters': ['/characters'],
    '/animas': ['/animas'],
    '/meditation': ['/meditation'],
    '/settings': ['/settings'],
  });

  const getActiveTab = (pathname) => {
    if (pathname === '/' || pathname.startsWith('/chat')) return '/';
    if (pathname.startsWith('/characters')) return '/characters';
    if (pathname.startsWith('/animas')) return '/animas';
    if (pathname.startsWith('/meditation')) return '/meditation';
    if (pathname.startsWith('/settings')) return '/settings';
    return '/';
  };

  useEffect(() => {
    const activeTab = getActiveTab(location.pathname);
    const stack = stackRef.current[activeTab];

    if (stack && stack[stack.length - 1] !== location.pathname) {
      stack.push(location.pathname);
    }
  }, [location.pathname]);

  const handleTabClick = (targetTab, currentPath) => {
    const stack = stackRef.current[targetTab];
    const isReselect = getActiveTab(currentPath) === targetTab;

    if (isReselect) {
      // Reset to root on reselect
      stackRef.current[targetTab] = [stack[0]];
      navigate(stack[0], { replace: true });
    } else {
      // Navigate to current position in target tab
      navigate(stack[stack.length - 1] || stack[0]);
    }
  };

  return { handleTabClick, getActiveTab };
};