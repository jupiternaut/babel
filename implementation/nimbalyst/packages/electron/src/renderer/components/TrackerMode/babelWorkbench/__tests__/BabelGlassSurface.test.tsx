// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiquidGlassProps } from 'simple-liquid-glass';

const optics = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn() }));

vi.mock('simple-liquid-glass', () => ({
  LiquidGlass: (props: LiquidGlassProps) => {
    optics.render(props);
    useEffect(() => () => optics.dispose(), []);
    return <div data-testid="test-optics" />;
  },
}));

import { BabelGlassSurface } from '../BabelGlassSurface';

const preferences = new Set<string>();
const queries = new Map<string, EventTarget & { matches: boolean; media: string }>();

function changePreference(preference: string, enabled: boolean) {
  if (enabled) preferences.add(preference);
  else preferences.delete(preference);
  act(() => {
    for (const query of queries.values()) {
      query.matches = [...preferences].some((value) => query.media.includes(value));
      query.dispatchEvent(new Event('change'));
    }
  });
}

beforeEach(() => {
  preferences.clear();
  queries.clear();
  optics.render.mockClear();
  optics.dispose.mockClear();
  vi.stubEnv('VITE_BABEL_GLASS_REFRACTION', 'false');
  vi.stubGlobal('matchMedia', vi.fn((media: string) => {
    if (!queries.has(media)) {
      queries.set(media, Object.assign(new EventTarget(), { media, matches: false }));
    }
    return queries.get(media);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('BabelGlassSurface', () => {
  it.each([
    '(prefers-reduced-motion: reduce)',
    '(prefers-reduced-transparency: reduce)',
    '(forced-colors: active)',
  ])('unmounts optics on %s without replacing the focused draft', (preference) => {
    const save = vi.fn();
    render(
      <BabelGlassSurface refractive>
        <input aria-label="任务草稿" defaultValue="初始内容" />
        <button type="button" onClick={save}>保存</button>
      </BabelGlassSurface>,
    );
    const draft = screen.getByRole('textbox', { name: '任务草稿' }) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: '中文输入草稿' } });
    draft.focus();
    draft.setSelectionRange(2, 4);
    screen.getByTestId('test-optics');

    changePreference(preference, true);
    expect(screen.queryByTestId('test-optics')).toBeNull();
    expect(optics.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: '任务草稿' })).toBe(draft);
    expect(draft.value).toBe('中文输入草稿');
    expect(document.activeElement).toBe(draft);
    expect([draft.selectionStart, draft.selectionEnd]).toEqual([2, 4]);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(save).toHaveBeenCalledTimes(1);

    changePreference(preference, false);
    screen.getByTestId('test-optics');
    expect(screen.getByRole('textbox', { name: '任务草稿' })).toBe(draft);
    expect(document.activeElement).toBe(draft);
  });

  it('uses CSS by default and lets an explicit prop override the opt-in flag', () => {
    const { rerender, unmount } = render(<BabelGlassSurface><button>任务看板</button></BabelGlassSurface>);
    expect(optics.render).not.toHaveBeenCalled();
    vi.stubEnv('VITE_BABEL_GLASS_REFRACTION', 'true');
    rerender(<BabelGlassSurface><button>任务看板</button></BabelGlassSurface>);
    expect(optics.render).toHaveBeenLastCalledWith(expect.objectContaining({
      renderer: 'svg', mirror: false, liquid: false, autoTextColor: false, quality: 'low',
    }));
    const props = optics.render.mock.lastCall![0] as LiquidGlassProps;
    expect(props.children).toBeUndefined();
    expect(props.backdropRef).toBeUndefined();
    expect(props.backdropSelector).toBeUndefined();
    rerender(<BabelGlassSurface refractive={false}><button>任务看板</button></BabelGlassSurface>);
    expect(screen.queryByTestId('test-optics')).toBeNull();

    const query = [...queries.values()][0];
    const remove = vi.spyOn(query, 'removeEventListener');
    unmount();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('keeps iOS on CSS because the library overrides SVG with WebGL there', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)');
    render(<BabelGlassSurface refractive><button>任务看板</button></BabelGlassSurface>);
    expect(optics.render).not.toHaveBeenCalled();
    screen.getByRole('button', { name: '任务看板' });
  });
});
