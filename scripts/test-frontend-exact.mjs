// 用前端精确消息（带空格版"写 ABC"）测试
const msg = '帮我创建一个新的客户档案 这个客户的名字你就写 ABC';
console.log('Testing message:', JSON.stringify(msg));

fetch('https://jiangsupanda.com/bambook/api/ai/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Bambook-API-Key': 'd1db03db52e57b16b19ebb8803e38585009450dbec92bd90fed0ed44939db35f',
  },
  body: JSON.stringify({
    message: msg,
    userId: 'test-user',
    sessionId: 'e2e-space-' + Date.now(),
    history: [],
  }),
}).then(async r => {
  const text = await r.text();
  const blocks = text.split('\n\n').filter(b => b.trim());
  const blockStarts = blocks.filter(b => b.startsWith('event: block_start'));
  console.log('Total blocks:', blocks.length);
  console.log('block_start count:', blockStarts.length);
  for (const b of blockStarts) {
    const dm = b.match(/^data:\s*(.+)$/m);
    if (!dm) continue;
    try {
      const d = JSON.parse(dm[1]);
      console.log('  type=' + (d.block?.type || '?') + ' toolId=' + (d.block?.toolId || '?') + ' lifecycle=' + (d.block?.lifecycleStatus || '?') + ' approvalId=' + (d.block?.approvalId || ''));
    } catch {}
  }
  const finalBlock = blocks.find(b => b.startsWith('event: final'));
  if (finalBlock) {
    const dm = finalBlock.match(/^data:\s*(.+)$/m);
    if (dm) {
      const d = JSON.parse(dm[1]);
      console.log('\nLLM final text:', (d.text || '').slice(0, 500));
    }
  }
}).catch(e => console.error('Error:', e));
