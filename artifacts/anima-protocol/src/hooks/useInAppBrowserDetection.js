import { useState, useEffect } from 'react';

export function useInAppBrowserDetection() {
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    
    // Check for common in-app browsers
    const inAppBrowsers = [
      /FBAN|FBAV/, // Facebook
      /Instagram/, // Instagram
      /Messenger/, // Messenger
      /WhatsApp/, // WhatsApp
      /Twitter/, // Twitter
      /Line/, // LINE
      /TikTok/, // TikTok
      /Telegram/, // Telegram
      /SamsungBrowser/, // Samsung Internet (sometimes acts like in-app)
      /wv/, // WebView
      /Version.*Safari.*Mobile/ // Mobile Safari (but this is normal)
    ];

    const detected = inAppBrowsers.some(pattern => pattern.test(userAgent));
    setIsInAppBrowser(detected);
  }, []);

  return isInAppBrowser;
}