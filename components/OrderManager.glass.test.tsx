import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const orderSource = readFileSync(new URL('./OrderManager.tsx', import.meta.url), 'utf8');
const clusterSource = readFileSync(new URL('./order/OrderClusterBlock.tsx', import.meta.url), 'utf8');

describe('OrderManager glass edge masks', () => {
  it('keeps order glass sections out of masked scroll parents', () => {
    expect(orderSource).toContain("import { useGlassSurfaceEdgeMasks } from './ui/useGlassSurfaceEdgeMasks'");
    expect(orderSource).not.toContain("import ScrollEdgeFades from './ui/ScrollEdgeFades'");
    expect(orderSource).not.toContain('renderMode="content-mask"');
    expect(orderSource).toContain('scrollRef: orderDetailScrollRef');
    expect(orderSource).toContain('enabled: !!selectedOrder && !showAddModal');
    expect(orderSource).toContain('scrollRef: orderEntryScrollRef');
    expect(orderSource).toContain('enabled: showAddModal');
    expect(clusterSource).toContain('edgeFadeItem');
  });
});
