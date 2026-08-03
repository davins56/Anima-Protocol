import { useEffect, useCallback } from 'react';

/**
 * Native iOS Bridge Hook
 * Listens for events dispatched by the WKWebView native wrapper and exposes
 * functions to send messages back to the native layer.
 *
 * Native → Web events (dispatched via evaluateJavaScript):
 *   - 'siri-shortcut'   : { action: 'start-chat' | 'open-quests' | 'open-chronicles' | 'check-in' }
 *   - 'native-speech'   : { text: string }
 *   - 'biometric-result': { success: boolean }
 *
 * Web → Native messages (via window.webkit.messageHandlers.*):
 *   - speakText         : string  — ask native to speak text via AVSpeechSynthesizer
 *   - stopSpeaking      : null    — stop native TTS
 *   - requestBiometric  : null    — trigger Face ID / Touch ID
 */
export function useNativeBridge({
  onSiriAction,
  onNativeSpeech,
  onBiometricResult,
} = {}) {

  // ── Detect if we're running inside a WKWebView ──────────────────────────
  const isNative = typeof window !== 'undefined' &&
    window.webkit?.messageHandlers !== undefined;

  // ── Web → Native helpers ─────────────────────────────────────────────────
  const speakNative = useCallback((text) => {
    if (!isNative) return false;
    window.webkit.messageHandlers.speakText?.postMessage(String(text));
    return true;
  }, [isNative]);

  const stopNativeSpeaking = useCallback(() => {
    if (!isNative) return false;
    window.webkit.messageHandlers.stopSpeaking?.postMessage(null);
    return true;
  }, [isNative]);

  const requestBiometric = useCallback(() => {
    if (!isNative) return false;
    window.webkit.messageHandlers.requestBiometric?.postMessage(null);
    return true;
  }, [isNative]);

  // ── Native → Web listeners ───────────────────────────────────────────────
  useEffect(() => {
    const handleSiri = (e) => {
      const action = e.detail?.action;
      if (action && onSiriAction) onSiriAction(action);
    };

    const handleSpeech = (e) => {
      const text = e.detail?.text;
      if (text && onNativeSpeech) onNativeSpeech(text);
    };

    const handleBiometric = (e) => {
      const success = !!e.detail?.success;
      if (onBiometricResult) onBiometricResult(success);
    };

    window.addEventListener('siri-shortcut', handleSiri);
    window.addEventListener('native-speech', handleSpeech);
    window.addEventListener('biometric-result', handleBiometric);

    return () => {
      window.removeEventListener('siri-shortcut', handleSiri);
      window.removeEventListener('native-speech', handleSpeech);
      window.removeEventListener('biometric-result', handleBiometric);
    };
  }, [onSiriAction, onNativeSpeech, onBiometricResult]);

  return {
    isNative,
    speakNative,
    stopNativeSpeaking,
    requestBiometric,
  };
}