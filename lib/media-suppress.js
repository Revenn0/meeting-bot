/**
 * Chat-only media suppression.
 * Denies local camera/mic capture and immediately stops remote tracks so
 * Meet can still establish a guest session / be admitted, without decode
 * or recording. Does not wrap RTCPeerConnection construction (Meet needs it).
 */
export const MEDIA_SUPPRESS_SOURCE = `(() => {
  if (window.__chatOnlyMediaSuppressInstalled) return;
  window.__chatOnlyMediaSuppressInstalled = true;
  window.__stoppedRemoteTracks = 0;

  const deny = (label) =>
    Promise.reject(new DOMException(label + ' denied in chat-only mode', 'NotAllowedError'));

  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = () => deny('getUserMedia');
    navigator.mediaDevices.getDisplayMedia = () => deny('getDisplayMedia');
    if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
      const originalEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async () => {
        const devices = await originalEnumerate().catch(() => []);
        return devices.map((device) => ({
          deviceId: device.deviceId,
          groupId: device.groupId,
          kind: device.kind,
          label: '',
        }));
      };
    }
  }

  if (window.RTCPeerConnection) {
    const proto = window.RTCPeerConnection.prototype;
    const originalAddEventListener = proto.addEventListener;
    proto.addEventListener = function (type, listener, options) {
      if (type === 'track' && typeof listener === 'function') {
        const wrapped = (event) => {
          try {
            event.track?.stop?.();
            event.streams?.forEach((stream) => {
              stream.getTracks?.().forEach((track) => track.stop());
            });
            window.__stoppedRemoteTracks += 1;
          } catch {}
          return listener.call(this, event);
        };
        return originalAddEventListener.call(this, type, wrapped, options);
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
  }
})();`;

export async function installMediaSuppression(page) {
  await page.evaluateOnNewDocument(MEDIA_SUPPRESS_SOURCE);
}

export async function getStoppedRemoteTrackCount(page) {
  return page.evaluate(() => window.__stoppedRemoteTracks || 0);
}
