import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  // Look at one order: DEMO-PO-2601001
  const links = await (prisma as any).entityLink.findMany({
    where: { fromType: 'order', fromId: 'DEMO-PO-2601001', deletedAt: null },
    select: { id: true, linkKind: true, toType: true, toId: true, source: true },
  });
  console.log('Links for DEMO-PO-2601001:');
  for (const l of links) console.log('  ' + l.id + ' [' + l.linkKind + '→' + l.toType + ':' + l.toId + '] src=' + l.source);
  await prisma.$disconnect();
})();
