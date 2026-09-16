import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { filterTrackerRecords } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerRowData';
import {
  filterTrackerItems,
  sortBoardColumnItems,
  type FilterContext,
  type SavedViewDefinition,
} from '@nimbalyst/collab-client/trackers';
import { projectExecutionBoardItems } from './babelExecutionStage';

export interface BabelExecutionFilterOptions extends FilterContext {
  searchTerm?: string;
  sourceFilter?: string[];
  listedIds?: ReadonlySet<string> | null;
}

export function filterBabelExecutionItems(
  items: TrackerRecord[],
  definition: SavedViewDefinition,
  options: BabelExecutionFilterOptions = {},
): TrackerRecord[] {
  // The execution lifecycle includes archive by default. An explicit archive
  // chip still selects only archived records, as it does on native surfaces.
  const source = definition.activeFilters.includes('archived')
    ? items.filter((item) => item.archived)
    : items;
  const projected = projectExecutionBoardItems(source, {
    selectedType: definition.selectedType,
  });
  const rows = filterTrackerRecords(
    filterTrackerItems(projected, { ...definition, sourceFilter: options.sourceFilter }, options),
    { searchTerm: options.searchTerm },
  );
  const { listedIds } = options;
  return sortBoardColumnItems(
    listedIds ? rows.filter((item) => listedIds.has(item.id)) : rows,
    definition.ordering,
  );
}
