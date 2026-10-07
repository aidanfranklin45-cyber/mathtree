import { describe, it, expect } from 'vitest';
import { canBulkMarkOwned, canBulkMovePipeline } from './bulkActions';

describe('bulkActions contextual rules', () => {
  const ownedDeal = { status: 'owned' as const };
  const pipelineDeal = { status: 'prospect' as const };

  describe('canBulkMovePipeline', () => {
    it('disallows moving to pipeline when status filter is prospect (pipeline view)', () => {
      expect(canBulkMovePipeline('prospect', [pipelineDeal])).toBe(false);
      expect(canBulkMovePipeline('prospect', [ownedDeal])).toBe(false);
      expect(canBulkMovePipeline('prospect', [])).toBe(false);
    });

    it('allows moving to pipeline when in owned view if owned deals are selected', () => {
      expect(canBulkMovePipeline('owned', [ownedDeal])).toBe(true);
      expect(canBulkMovePipeline('owned', [pipelineDeal])).toBe(false);
    });

    it('allows moving to pipeline in "all" view only if at least one selected deal is currently owned', () => {
      expect(canBulkMovePipeline('all', [pipelineDeal])).toBe(false);
      expect(canBulkMovePipeline('all', [ownedDeal])).toBe(true);
      expect(canBulkMovePipeline('all', [pipelineDeal, ownedDeal])).toBe(true);
    });
  });

  describe('canBulkMarkOwned', () => {
    it('disallows marking owned when status filter is owned (owned portfolio view)', () => {
      expect(canBulkMarkOwned('owned', [ownedDeal])).toBe(false);
      expect(canBulkMarkOwned('owned', [pipelineDeal])).toBe(false);
      expect(canBulkMarkOwned('owned', [])).toBe(false);
    });

    it('allows marking owned when in pipeline view if pipeline deals are selected', () => {
      expect(canBulkMarkOwned('prospect', [pipelineDeal])).toBe(true);
      expect(canBulkMarkOwned('prospect', [ownedDeal])).toBe(false);
    });

    it('allows marking owned in "all" view only if at least one selected deal is not yet owned', () => {
      expect(canBulkMarkOwned('all', [ownedDeal])).toBe(false);
      expect(canBulkMarkOwned('all', [pipelineDeal])).toBe(true);
      expect(canBulkMarkOwned('all', [ownedDeal, pipelineDeal])).toBe(true);
    });
  });
});
