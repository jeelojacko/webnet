import { useEffect } from 'react';

export const useMapViewTransformAvailability = ({
  available,
  effectiveMode,
  setShowTransformedCoordinates,
}: {
  available: boolean;
  effectiveMode: '2d' | '3d';
  setShowTransformedCoordinates: (_value: boolean) => void;
}) => {
  useEffect(() => {
    if (!available || effectiveMode !== '2d') {
      setShowTransformedCoordinates(false);
    }
  }, [available, effectiveMode, setShowTransformedCoordinates]);
};
