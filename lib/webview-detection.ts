/**
 * WebView Detection Utilities
 *
 * Detects if the user is browsing in an in-app browser (WKWebView)
 * vs a full browser like Safari or Chrome.
 *
 * Focus: Detect environments where passkeys may not work due to isolated context.
 * Ported from: v0-agent-trading-platform/lib/webview-detection.ts
 */

export interface WebViewEnvironment {
  isWebView: boolean;
  isWKWebView: boolean;
  platform: 'x-twitter' | 'facebook' | 'instagram' | 'linkedin' | 'telegram' | 'unknown-webview' | 'browser';
  isStandalone: boolean;
  userAgent: string;
}

export function detectWebViewEnvironment(): WebViewEnvironment {
  if (typeof window === 'undefined') {
    return {
      isWebView: false,
      isWKWebView: false,
      platform: 'browser',
      isStandalone: false,
      userAgent: '',
    };
  }

  const ua = navigator.userAgent;

  // Detect specific in-app browsers
  const isXApp = /Twitter for iPhone/i.test(ua) || /Twitter for iPad/i.test(ua);
  const isFacebook = /FBAN|FBAV/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const isLinkedIn = /LinkedInApp/i.test(ua);
  const isTelegram = /Telegram/i.test(ua) ||
    (window as any).Telegram?.WebApp !== undefined ||
    (window as any).TelegramWebviewProxy !== undefined;

  // Detect standalone mode (PWA)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  // Detect WKWebView (iOS in-app browser)
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const hasWebKit = /AppleWebKit/i.test(ua);
  const hasSafari = /Safari/i.test(ua);
  const hasVersion = /Version\/[\d.]+/i.test(ua);
  const isWKWebView = isIOS && hasWebKit && !hasSafari && !hasVersion && !isStandalone;

  // Generic WebView detection (Android or other)
  const isGenericWebView = !isStandalone &&
    (/wv|WebView/i.test(ua) || (hasWebKit && !hasSafari && !hasVersion));

  const isWebView = isXApp || isFacebook || isInstagram || isLinkedIn || isTelegram ||
    isWKWebView || isGenericWebView;

  let platform: WebViewEnvironment['platform'] = 'browser';
  if (isXApp) platform = 'x-twitter';
  else if (isFacebook) platform = 'facebook';
  else if (isInstagram) platform = 'instagram';
  else if (isLinkedIn) platform = 'linkedin';
  else if (isTelegram) platform = 'telegram';
  else if (isWKWebView || isGenericWebView) platform = 'unknown-webview';

  return { isWebView, isWKWebView, platform, isStandalone, userAgent: ua };
}

export function getWebViewPlatformName(env: WebViewEnvironment): string {
  switch (env.platform) {
    case 'x-twitter': return 'X (Twitter)';
    case 'facebook': return 'Facebook';
    case 'instagram': return 'Instagram';
    case 'linkedin': return 'LinkedIn';
    case 'telegram': return 'Telegram';
    case 'unknown-webview': return 'this app';
    case 'browser': return 'browser';
  }
}

/** True if passkeys likely won't work (WKWebView in-app browsers) */
export function shouldShowPasskeyWarning(env: WebViewEnvironment): boolean {
  return env.isWKWebView || env.platform !== 'browser';
}
