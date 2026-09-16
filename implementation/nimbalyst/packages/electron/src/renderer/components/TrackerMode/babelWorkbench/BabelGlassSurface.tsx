import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { LiquidGlass } from 'simple-liquid-glass';
import './BabelGlassSurface.css';

const STATIC_SURFACE_QUERY = '(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (forced-colors: active)';

export interface BabelGlassSurfaceProps {
  children: React.ReactNode;
  className?: string;
  refractive?: boolean;
}

export function BabelGlassSurface({
  children,
  className = '',
  refractive = import.meta.env.VITE_BABEL_GLASS_REFRACTION === 'true',
}: BabelGlassSurfaceProps) {
  const [media] = useState(() => typeof window.matchMedia === 'function'
    ? window.matchMedia(STATIC_SURFACE_QUERY)
    : null);
  const subscribe = useCallback((notify: () => void) => {
    media?.addEventListener('change', notify);
    return () => media?.removeEventListener('change', notify);
  }, [media]);
  const staticSurface = useSyncExternalStore(subscribe, () => media?.matches ?? true, () => true);

  // The package forces WebGL on iOS even with renderer="svg". Keep that path unmounted.
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const showOptics = refractive && !staticSurface && !isIOS;

  return (
    <div
      className={`babel-glass-surface ${className}`.trim()}
      data-glass-mode={staticSurface ? 'static' : showOptics ? 'refractive' : 'frosted'}
    >
      <div className="babel-glass-surface-backdrop" aria-hidden="true">
        {showOptics ? (
          <LiquidGlass
            className="babel-glass-surface-optics"
            renderer="svg"
            mirror={false}
            liquid={false}
            autoTextColor={false}
            quality="low"
            lensProfile="track"
            displacementScale={6}
            radius={8}
            frost={0}
            blur={0}
            saturation={105}
            borderColor="var(--nim-border)"
            background="color-mix(in srgb, var(--nim-bg) 16%, transparent)"
            style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
          />
        ) : null}
      </div>
      <div className="babel-glass-surface-content">{children}</div>
    </div>
  );
}
