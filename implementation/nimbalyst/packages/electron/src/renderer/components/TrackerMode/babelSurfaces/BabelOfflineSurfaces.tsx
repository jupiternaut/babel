import React from 'react';
import { BabelNodesSettings } from './BabelNodesSettings';
import { BabelOpsSettings } from './BabelOpsSettings';
import { BabelPdfSettings } from './BabelPdfSettings';
import { projectOfflineSurfaces, type OfflineSurfacesInput } from './babelSurfaceProjection';

export type BabelOfflineSurfacesProps = OfflineSurfacesInput;

/**
 * Sidebar cluster for later offline modules. Stays left of the board.
 * Does not create a second product page or squeeze the four columns.
 */
export const BabelOfflineSurfaces: React.FC<BabelOfflineSurfacesProps> = (props) => {
  const view = projectOfflineSurfaces(props);

  return (
    <div
      className="flex min-h-0 flex-col"
      data-testid="babel-offline-surfaces"
      data-board-layout={view.boardLayoutMode}
      data-board-breakpoint={String(view.boardBreakpointPx)}
    >
      <p className="px-3.5 pb-1 pt-2 text-[11px] text-nim-faint" data-testid="babel-surfaces-layout">
        {view.boardLayoutNote}
      </p>
      <p className="px-3.5 pb-1 text-[11px] text-nim-faint">{view.placementNote}</p>
      <BabelOpsSettings {...props} />
      <BabelNodesSettings {...props} />
      <BabelPdfSettings {...props} />
    </div>
  );
};
