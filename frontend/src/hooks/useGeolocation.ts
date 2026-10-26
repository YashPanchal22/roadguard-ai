import { useCallback, useState } from 'react';

export interface GeoState {
  status: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  error: string | null;
}

/**
 * Browser geolocation with explicit permission handling.
 * The permission prompt is only triggered when the user presses the button —
 * manual map positioning always remains available.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({
    status: 'idle',
    lat: null,
    lng: null,
    accuracy: null,
    error: null,
  });

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'unavailable', lat: null, lng: null, accuracy: null, error: 'This browser does not expose a location API.' });
      return;
    }
    setState((prev) => ({ ...prev, status: 'requesting', error: null }));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          status: 'granted',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          error: null,
        });
      },
      (error) => {
        const messages: Record<number, string> = {
          1: 'Location permission was denied. You can still place the pin on the map manually.',
          2: 'Your position is currently unavailable. Please pick the location on the map.',
          3: 'The location request timed out. Please pick the location on the map.',
        };
        setState({
          status: error.code === 1 ? 'denied' : 'unavailable',
          lat: null,
          lng: null,
          accuracy: null,
          error: messages[error.code] ?? 'Location lookup failed.',
        });
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }, []);

  const reset = useCallback(() => setState({ status: 'idle', lat: null, lng: null, accuracy: null, error: null }), []);

  return { ...state, request, reset };
}
